import { clamp } from "../core/math";
import { fillImpulse } from "./impulse";
import type { Score } from "../score/types";
import type { ParamSpec } from "../settings/types";
import { percent } from "../settings/types";
import { banksNeeded, sustains, TIMBRES, WAVETABLE_CDN, WAVETABLE_LOCAL } from "./instruments";
import { startAt } from "./scheduling";
import { decodeWavetable, parseWavetable, zoneFor } from "./wavetable";
import type { Voiceable } from "./wavetable";

export interface SamplerOptions {
    enabled: boolean;
    /** Общая громкость, 0…1. */
    volume: number;
    /** Доля отражённого звука, 0…1. */
    reverb: number;
    /** Идентификатор тембра из каталога. */
    timbre: string;
}

interface Bank {
    zones: Voiceable[];
    /** Тянуть ли звук петлёй, пока клавишу держат. */
    sustaining: boolean;
}

interface Voice {
    source: AudioBufferSourceNode;
    gain: GainNode;
    midi: number;
    /** Время начала — по нему выбираем, кого снять при переполнении. */
    at: number;
    /** На сколько нота была сдвинута вперёд: отпускать её нужно так же. */
    delay: number;
}

/** Больше одновременных голосов слабая машина не потянет, а слух не заметит. */
const MAX_VOICES = 48;
const ATTACK = 0.004;
const RELEASE = 0.09;

/**
 * Сэмплерный движок на Web Audio. Инструменты берутся из звуковых таблиц
 * WebAudioFont: на клавишу натягивается ближайший сэмпл и подстраивается
 * скоростью воспроизведения.
 *
 * Педаль отдельно не обрабатывается: сцена сама держит ноту, пока нажата
 * педаль, и присылает `noteOff` только когда она действительно отпущена.
 */
export class Sampler {
    readonly options: SamplerOptions;
    /** Куда сообщать о загрузке и ошибках; подключает HUD. */
    onStatus: ((text: string) => void) | null = null;

    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private wet: GainNode | null = null;
    private convolver: ConvolverNode | null = null;
    private readonly banks = new Map<string, Bank>();
    private readonly loading = new Map<string, Promise<Bank | null>>();
    /** Инструмент партии в режиме «как в файле». */
    private readonly parts = new Map<number, string>();
    private score: Score | null = null;
    private voices: Voice[] = [];
    /** Номер последней затеянной загрузки: по нему отсеиваем устаревшие. */
    private generation = 0;

    constructor(options: Partial<SamplerOptions> = {}) {
        this.options = { enabled: true, volume: 0.7, reverb: 0.25, timbre: "piano", ...options };
    }

    params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "boolean",
                key: "enabled",
                label: "Звук",
                group: "sound",
                get: () => o.enabled,
                set: (value) => {
                    o.enabled = value;
                    if (value) void this.prepare();
                    else this.panic();
                }
            },
            {
                type: "number",
                key: "volume",
                label: "Громкость",
                group: "sound",
                min: 0,
                max: 1,
                step: 0.05,
                format: percent,
                get: () => o.volume,
                set: (value) => {
                    o.volume = value;
                    this.applyVolume();
                }
            },
            {
                type: "enum",
                key: "timbre",
                label: "Тембр",
                group: "sound",
                variants: TIMBRES.map((timbre) => ({ value: timbre.id, title: timbre.title })),
                get: () => o.timbre,
                set: (value) => {
                    o.timbre = value;
                    this.panic();
                    void this.prepare();
                }
            },
            {
                type: "number",
                key: "reverb",
                label: "Реверберация",
                group: "sound",
                min: 0,
                max: 1,
                step: 0.05,
                format: percent,
                get: () => o.reverb,
                set: (value) => {
                    o.reverb = value;
                    this.applyVolume();
                }
            }
        ];
    }

    /** Первое касание страницы: браузер разрешает звук только после жеста. */
    unlock(): void {
        if (!this.options.enabled) return;
        void this.prepare();
    }

    /** Новая партитура: в режиме «как в файле» подгружаем инструменты партий. */
    useScore(score: Score | null): void {
        this.score = score;
        this.parts.clear();
        if (this.options.enabled) void this.prepare();
    }

    noteOn(midi: number, velocity: number, part = -1, age: number | null = null): void {
        const ctx = this.ctx;
        const master = this.master;
        if (!this.options.enabled || !ctx || !master) return;
        if (ctx.state === "suspended") void ctx.resume();

        const bank = this.bankFor(part);
        if (!bank) return;
        const zone = zoneFor(bank.zones, midi);
        if (!zone) return;

        this.release(midi, 0.02);
        if (this.voices.length >= MAX_VOICES) this.retire();

        const now = ctx.currentTime;
        // Нота файла возвращается в свой музыкальный момент, живая звучит сразу.
        const when = startAt(now, age);
        const source = ctx.createBufferSource();
        source.buffer = zone.buffer;
        source.playbackRate.value = Math.pow(2, (100 * midi - zone.detune) / 1200);
        if (bank.sustaining && zone.loopable) {
            source.loop = true;
            source.loopStart = zone.loopStart;
            source.loopEnd = zone.loopEnd;
        }

        const gain = ctx.createGain();
        // Громкость по velocity: на слух отклик ближе к квадрату, чем к прямой.
        const level = Math.pow(clamp(velocity, 1, 127) / 127, 1.6);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(level, when + ATTACK);

        source.connect(gain);
        gain.connect(master);
        if (this.wet) gain.connect(this.wet);
        source.start(when);

        const voice: Voice = { source, gain, midi, at: when, delay: when - now };
        source.onended = () => {
            const index = this.voices.indexOf(voice);
            if (index >= 0) this.voices.splice(index, 1);
        };
        this.voices.push(voice);
    }

    noteOff(midi: number): void {
        this.release(midi, RELEASE);
    }

    panic(): void {
        for (const voice of [...this.voices]) this.stop(voice, 0.03);
    }

    dispose(): void {
        this.panic();
        void this.ctx?.close();
        this.ctx = null;
        this.master = null;
    }

    // --- внутреннее ---------------------------------------------------------

    private bankFor(part: number): Bank | null {
        // Живая игра поверх файла не принадлежит ни одной партии — ей общий банк.
        const own = this.options.timbre === "score" ? this.parts.get(part) : undefined;
        return this.banks.get(own ?? this.baseFile) ?? null;
    }

    /** Банк, которым звучит всё, у чего нет своего: он же единственный у простых тембров. */
    private get baseFile(): string {
        return banksNeeded(this.options.timbre, null)[0]!.file;
    }

    /** Создать контекст (после жеста) и подтянуть нужные инструменты. */
    private async prepare(): Promise<void> {
        const ctx = this.ensure();
        if (!ctx) return;

        const generation = ++this.generation;
        const needed = banksNeeded(this.options.timbre, this.score);
        this.parts.clear();
        for (const item of needed) if (item.part >= 0) this.parts.set(item.part, item.file);

        // Партии грузятся разом: очередь из «await» растягивала старт файла на
        // несколько мегабайт друг за другом.
        const missing = needed.filter((item) => !this.banks.has(item.file));
        if (missing.length > 0) this.onStatus?.("загружаю звук…");
        const banks = await Promise.all(needed.map((item) => this.bank(item.file, item.program)));

        // Пока грузили, могли сменить тембр или открыть другой файл.
        if (generation !== this.generation) return;
        if (missing.length > 0 && banks.every((bank) => bank !== null)) this.onStatus?.("звук готов");
    }

    private async bank(file: string, program: number): Promise<Bank | null> {
        const ready = this.banks.get(file);
        if (ready) return ready;
        const running = this.loading.get(file);
        if (running) return running;

        const task = this.fetchBank(file, program);
        this.loading.set(file, task);
        const bank = await task;
        this.loading.delete(file);
        return bank;
    }

    private async fetchBank(file: string, program: number): Promise<Bank | null> {
        const ctx = this.ctx;
        if (!ctx) return null;

        // Сначала местная копия, потом сеть: так проект играет и без интернета.
        for (const base of [WAVETABLE_LOCAL, WAVETABLE_CDN]) {
            try {
                const response = await fetch(`${base}${file}.js`);
                if (!response.ok) continue;
                const zones = await decodeWavetable(ctx, parseWavetable(await response.text()));
                const bank: Bank = { zones, sustaining: sustains(program) };
                this.banks.set(file, bank);
                return bank;
            } catch {
                continue;
            }
        }
        this.onStatus?.("не удалось загрузить звук");
        return null;
    }

    private ensure(): AudioContext | null {
        if (this.ctx) {
            if (this.ctx.state === "suspended") void this.ctx.resume();
            return this.ctx;
        }
        try {
            const ctx = new AudioContext();
            const master = ctx.createGain();
            master.connect(ctx.destination);
            this.ctx = ctx;
            this.master = master;
            this.buildReverb(ctx, master);
            this.applyVolume();
            return ctx;
        } catch {
            this.onStatus?.("звук недоступен");
            return null;
        }
    }

    /**
     * Отражения зала: свёртка с затухающим шумом. Импульс делаем сами —
     * ради одного эффекта тащить звуковой файл незачем.
     */
    private buildReverb(ctx: AudioContext, master: GainNode): void {
        const seconds = 1.6;
        const length = Math.floor(ctx.sampleRate * seconds);
        const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
        fillImpulse(impulse.getChannelData(0), impulse.getChannelData(1));

        const convolver = ctx.createConvolver();
        convolver.buffer = impulse;
        const wet = ctx.createGain();
        wet.gain.value = 0;
        wet.connect(convolver);
        convolver.connect(master);

        this.convolver = convolver;
        this.wet = wet;
    }

    private applyVolume(): void {
        if (this.master) this.ramp(this.master.gain, clamp(this.options.volume, 0, 1));
        if (this.wet) this.ramp(this.wet.gain, clamp(this.options.reverb, 0, 1) * 0.9);
        void this.convolver;
    }

    /** Громкость меняется скатом, а не скачком: скачок слышен щелчком. */
    private ramp(gain: AudioParam, value: number): void {
        const ctx = this.ctx;
        if (!ctx) {
            gain.value = value;
            return;
        }
        gain.cancelScheduledValues(ctx.currentTime);
        gain.setTargetAtTime(value, ctx.currentTime, 0.02);
    }

    private release(midi: number, time: number): void {
        for (const voice of this.voices) if (voice.midi === midi) this.stop(voice, time);
    }

    /** Снять самый старый голос — переполнение слышно меньше, чем треск. */
    private retire(): void {
        let oldest: Voice | null = null;
        for (const voice of this.voices) if (!oldest || voice.at < oldest.at) oldest = voice;
        if (oldest) this.stop(oldest, 0.02);
    }

    private stop(voice: Voice, time: number): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const index = this.voices.indexOf(voice);
        if (index >= 0) this.voices.splice(index, 1);

        // Отпускаем ровно с тем же смещением, с каким начали, — иначе поедет
        // длительность ноты.
        const now = ctx.currentTime + voice.delay;
        try {
            voice.gain.gain.cancelScheduledValues(now);
            voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
            voice.gain.gain.setTargetAtTime(0, now, Math.max(0.01, time));
            voice.source.stop(now + Math.max(0.05, time * 6));
        } catch {
            // Голос уже остановлен — ничего страшного.
        }
    }
}
