/**
 * Разбор Standard MIDI File. Тики переводятся в секунды прямо здесь, по карте
 * темпа, — дальше по проекту время везде в секундах.
 */

import { makeScore } from "./types";
import type { PartDraft, PedalEvent, Score, ScoreNote } from "./types";
import type { MeterPoint, TempoPoint } from "./grid";
import { instrumentName } from "./gm";

interface RawEvent {
    readonly tick: number;
    readonly track: number;
    readonly kind: "on" | "off" | "pedal" | "tempo" | "meter" | "program" | "name" | "instrument";
    readonly midi: number;
    readonly velocity: number;
    readonly channel: number;
    /** Для tempo — микросекунды на четверть, для pedal и program — значение. */
    readonly value: number;
    readonly text?: string;
    /** Только для meter: размер такта, знаменатель уже числом. */
    readonly meter?: { numerator: number; denominator: number };
}

class Reader {
    offset = 0;

    constructor(private readonly view: DataView) {}

    get done(): boolean {
        return this.offset >= this.view.byteLength;
    }

    u8(): number {
        this.require(1);
        return this.view.getUint8(this.offset++);
    }

    u16(): number {
        this.require(2);
        const value = this.view.getUint16(this.offset);
        this.offset += 2;
        return value;
    }

    u32(): number {
        this.require(4);
        const value = this.view.getUint32(this.offset);
        this.offset += 4;
        return value;
    }

    /** Число переменной длины: семь бит на байт, старший бит — признак продолжения. */
    varInt(): number {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            const byte = this.u8();
            value = (value << 7) | (byte & 0x7f);
            if ((byte & 0x80) === 0) return value;
        }
        throw new Error("Повреждённый файл: слишком длинное число");
    }

    text(length: number): string {
        this.require(length);
        let result = "";
        for (let i = 0; i < length; i++) result += String.fromCharCode(this.view.getUint8(this.offset + i));
        this.offset += length;
        return result;
    }

    bytes(length: number): Uint8Array {
        this.require(length);
        const start = this.view.byteOffset + this.offset;
        this.offset += length;
        return new Uint8Array(this.view.buffer, start, length);
    }

    skip(length: number): void {
        this.require(length);
        this.offset += length;
    }

    private require(length: number): void {
        if (this.offset + length > this.view.byteLength) {
            throw new Error("Повреждённый файл: данные обрываются");
        }
    }
}

export function parseMidiFile(data: ArrayBuffer, name: string): Score {
    const reader = new Reader(new DataView(data));

    if (reader.text(4) !== "MThd") throw new Error("Это не MIDI-файл");
    const headerLength = reader.u32();
    const format = reader.u16();
    const trackCount = reader.u16();
    const division = reader.u16();
    if (headerLength > 6) reader.skip(headerLength - 6);

    if (format > 2) throw new Error(`Неизвестный формат MIDI: ${format}`);
    if ((division & 0x8000) !== 0) throw new Error("Файлы с делением SMPTE пока не поддерживаются");
    if (division === 0) throw new Error("Повреждённый файл: нулевое деление");

    const events: RawEvent[] = [];
    for (let track = 0; track < trackCount && !reader.done; track++) {
        const label = reader.text(4);
        const length = reader.u32();
        if (label !== "MTrk") {
            reader.skip(length);
            continue;
        }
        readTrack(reader, reader.offset + length, track, events);
    }

    events.sort((a, b) => a.tick - b.tick);
    return build(events, division, name, trackCount);
}

function readTrack(reader: Reader, end: number, track: number, out: RawEvent[]): void {
    let tick = 0;
    let status = 0;

    while (reader.offset < end) {
        tick += reader.varInt();
        let byte = reader.u8();

        if (byte < 0x80) {
            // Running status: статус тот же, что у предыдущего события.
            if (status === 0) throw new Error("Повреждённый файл: событие без статуса");
            reader.offset--;
            byte = status;
        } else if (byte < 0xf0) {
            status = byte;
        }

        const type = byte & 0xf0;
        const channel = byte & 0x0f;

        if (byte === 0xff) {
            const meta = reader.u8();
            const length = reader.varInt();
            if (meta === 0x51 && length === 3) {
                const value = (reader.u8() << 16) | (reader.u8() << 8) | reader.u8();
                out.push({ tick, track, kind: "tempo", midi: 0, velocity: 0, channel, value });
            } else if (meta === 0x58 && length === 4) {
                const numerator = reader.u8();
                // Знаменатель лежит степенью двойки: 2 значит четверть, 3 — восьмую.
                const denominator = 2 ** reader.u8();
                reader.skip(2); // метроном и деление четверти — нам не нужны
                out.push({
                    tick,
                    track,
                    kind: "meter",
                    midi: 0,
                    velocity: 0,
                    channel,
                    value: 0,
                    meter: { numerator, denominator }
                });
            } else if (meta === 0x03 || meta === 0x04) {
                const text = decodeText(reader.bytes(length));
                if (text) {
                    out.push({
                        tick,
                        track,
                        kind: meta === 0x03 ? "name" : "instrument",
                        midi: 0,
                        velocity: 0,
                        channel,
                        value: 0,
                        text
                    });
                }
            } else {
                reader.skip(length);
            }
            continue;
        }

        if (byte === 0xf0 || byte === 0xf7) {
            reader.skip(reader.varInt());
            continue;
        }

        switch (type) {
            case 0x90: {
                const midi = reader.u8();
                const velocity = reader.u8();
                out.push({
                    tick,
                    track,
                    kind: velocity > 0 ? "on" : "off",
                    midi,
                    velocity,
                    channel,
                    value: 0
                });
                break;
            }
            case 0x80: {
                const midi = reader.u8();
                const velocity = reader.u8();
                out.push({ tick, track, kind: "off", midi, velocity, channel, value: 0 });
                break;
            }
            case 0xb0: {
                const controller = reader.u8();
                const value = reader.u8();
                if (controller === 64) {
                    out.push({ tick, track, kind: "pedal", midi: 0, velocity: 0, channel, value });
                }
                break;
            }
            case 0xa0:
            case 0xe0:
                reader.skip(2);
                break;
            case 0xc0: {
                const program = reader.u8();
                out.push({ tick, track, kind: "program", midi: 0, velocity: 0, channel, value: program });
                break;
            }
            case 0xd0:
                reader.skip(1);
                break;
            default:
                throw new Error(`Неизвестное событие MIDI: 0x${byte.toString(16)}`);
        }
    }

    reader.offset = end;
}

/** Имена в файлах бывают в UTF-8, бывают в cp1251 — пробуем по очереди. */
function decodeText(bytes: Uint8Array): string {
    for (const encoding of ["utf-8", "windows-1251"]) {
        try {
            const text = new TextDecoder(encoding, { fatal: encoding === "utf-8" }).decode(bytes);
            if (text.trim()) return text.trim();
            return "";
        } catch {
            /* следующая кодировка */
        }
    }
    return "";
}

interface PartAccumulator extends PartDraft {
    trackName: string | null;
    instrumentName: string | null;
}

/**
 * Сводит сырые события в партитуру: тики в секунды по карте темпа, ноты в пары
 * «нажали — отпустили», партии — по паре «дорожка + канал».
 */
function build(events: readonly RawEvent[], division: number, name: string, _tracks: number): Score {
    const notes: ScoreNote[] = [];
    const pedal: PedalEvent[] = [];
    const pending = new Map<number, { midi: number; start: number; velocity: number; part: number }[]>();

    const parts: PartAccumulator[] = [];
    const partIndex = new Map<number, number>();
    const trackNames = new Map<number, string>();
    const instrumentNames = new Map<number, string>();
    const channelsInTrack = new Map<number, Set<number>>();

    const partFor = (track: number, channel: number): number => {
        const key = track * 16 + channel;
        const existing = partIndex.get(key);
        if (existing !== undefined) return existing;
        const index = parts.length;
        parts.push({
            index,
            track,
            channel,
            name: "",
            program: null,
            trackName: null,
            instrumentName: null
        });
        partIndex.set(key, index);
        const used = channelsInTrack.get(track) ?? new Set<number>();
        used.add(channel);
        channelsInTrack.set(track, used);
        return index;
    };

    let tempo = 500000; // 120 ударов в минуту, пока файл не сказал иное
    let lastTick = 0;
    let lastSeconds = 0;
    const seconds = (tick: number): number => lastSeconds + ((tick - lastTick) * tempo) / (division * 1e6);
    let pedalDown = false;
    const tempos: TempoPoint[] = [];
    const meters: MeterPoint[] = [];

    for (const event of events) {
        const time = seconds(event.tick);

        if (event.kind === "tempo") {
            lastSeconds = time;
            lastTick = event.tick;
            tempo = event.value;
            tempos.push({ tick: event.tick, micros: event.value });
            continue;
        }

        if (event.kind === "meter") {
            if (event.meter) meters.push({ tick: event.tick, ...event.meter });
            continue;
        }

        if (event.kind === "name") {
            if (!trackNames.has(event.track) && event.text) trackNames.set(event.track, event.text);
            continue;
        }

        if (event.kind === "instrument") {
            if (!instrumentNames.has(event.track) && event.text) instrumentNames.set(event.track, event.text);
            continue;
        }

        if (event.kind === "program") {
            const part = parts[partFor(event.track, event.channel)]!;
            if (part.program === null) parts[part.index] = { ...part, program: event.value };
            continue;
        }

        if (event.kind === "pedal") {
            const on = event.value >= 64;
            if (on !== pedalDown) {
                pedalDown = on;
                pedal.push({ time, on });
            }
            continue;
        }

        const part = partFor(event.track, event.channel);
        const key = (event.track * 16 + event.channel) * 128 + event.midi;

        if (event.kind === "on") {
            const stack = pending.get(key) ?? [];
            stack.push({ midi: event.midi, start: time, velocity: event.velocity, part });
            pending.set(key, stack);
            continue;
        }

        const stack = pending.get(key);
        const started = stack?.shift();
        if (!started) continue;
        notes.push({
            midi: event.midi,
            velocity: started.velocity,
            start: started.start,
            end: Math.max(time, started.start + 0.02),
            part: started.part
        });
    }

    // Ноты без пары «выключить» — обрываем на конце файла.
    const tail = events.length > 0 ? seconds(events[events.length - 1]!.tick) : 0;
    for (const stack of pending.values()) {
        for (const started of stack) {
            notes.push({
                midi: started.midi,
                velocity: started.velocity,
                start: started.start,
                end: Math.max(tail, started.start + 0.02),
                part: started.part
            });
        }
    }

    if (notes.length === 0) throw new Error("В файле нет нот");

    const named: PartDraft[] = parts.map((part) => ({
        index: part.index,
        track: part.track,
        channel: part.channel,
        program: part.program,
        name: partName(part, trackNames, instrumentNames, channelsInTrack)
    }));

    return makeScore(name, notes, pedal, named, { tempos, meters, division });
}

/** Имя дорожки, имя инструмента из файла, GM-инструмент, номер канала. */
function partName(
    part: PartAccumulator,
    trackNames: Map<number, string>,
    instrumentNames: Map<number, string>,
    channelsInTrack: Map<number, Set<number>>
): string {
    const fromFile = trackNames.get(part.track) ?? instrumentNames.get(part.track) ?? null;
    const fromProgram = instrumentName(part.program, part.channel);
    const shared = (channelsInTrack.get(part.track)?.size ?? 1) > 1;

    if (fromFile && shared && fromProgram) return `${fromFile} · ${fromProgram}`;
    if (fromFile) return fromFile;
    if (fromProgram) return fromProgram;
    return `Канал ${part.channel + 1}`;
}
