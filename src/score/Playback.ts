import { Emitter } from "../core/Emitter";
import { Transport } from "./Transport";
import { firstNoteAtOrAfter } from "./types";
import type { Score, ScoreNote } from "./types";

/** Куда плеер отдаёт ноты. Сцена подходит как есть. */
export interface NoteSink {
    noteOn(midi: number, velocity: number, options?: { performance?: boolean }): void;
    noteOff(midi: number, force?: boolean): void;
    setSustain(on: boolean): void;
    panic(): void;
}

export interface PlaybackEvents extends Record<string, unknown> {
    /** Загружена новая партитура или выгружена (score = null). */
    score: { score: Score | null };
    state: { playing: boolean };
    /** Изменился набор показываемых партий. */
    parts: Record<string, never>;
}

/**
 * Воспроизведение партитуры: держит партитуру и часы, раздаёт ноты в сцену.
 * Время идёт от сцены, поэтому картинка и звучащие ноты не расходятся.
 */
export class Playback {
    readonly events = new Emitter<PlaybackEvents>();
    readonly transport = new Transport();

    score: Score | null = null;

    private nextNote = 0;
    private nextPedal = 0;
    private readonly sounding: ScoreNote[] = [];
    private readonly muted = new Set<number>();

    constructor() {
        this.transport.events.on("state", ({ state }) => {
            this.events.emit("state", { playing: state === "playing" });
        });
    }

    get time(): number {
        return this.transport.time;
    }

    get loaded(): boolean {
        return this.score !== null;
    }

    /** Показывается ли партия: выключенная не звучит и не рисуется. */
    partEnabled(part: number): boolean {
        return !this.muted.has(part);
    }

    setPartEnabled(part: number, on: boolean, sink: NoteSink): void {
        if (on) this.muted.delete(part);
        else this.muted.add(part);
        this.silence(sink);
        this.resync(sink);
        this.events.emit("parts", {});
    }

    load(score: Score, sink: NoteSink): void {
        this.silence(sink);
        this.muted.clear();
        this.score = score;
        this.transport.duration = score.duration;
        this.transport.seek(0);
        this.resync(sink);
        this.events.emit("score", { score });
    }

    unload(sink: NoteSink): void {
        this.silence(sink);
        this.score = null;
        this.transport.stop();
        this.transport.duration = 0;
        this.events.emit("score", { score: null });
    }

    /** Перемотка: гасим звучащее и собираем состояние заново. */
    seek(time: number, sink: NoteSink): void {
        this.transport.seek(time);
        this.silence(sink);
        this.resync(sink);
    }

    advance(dt: number, sink: NoteSink): void {
        const score = this.score;
        if (!score) return;

        const span = this.transport.advance(dt);
        if (!span) return;

        while (this.nextPedal < score.pedal.length && score.pedal[this.nextPedal]!.time <= span.to) {
            sink.setSustain(score.pedal[this.nextPedal]!.on);
            this.nextPedal++;
        }

        for (let i = this.sounding.length - 1; i >= 0; i--) {
            const note = this.sounding[i]!;
            if (note.end > span.to) continue;
            sink.noteOff(note.midi);
            this.sounding.splice(i, 1);
        }

        while (this.nextNote < score.notes.length && score.notes[this.nextNote]!.start <= span.to) {
            const note = score.notes[this.nextNote]!;
            this.nextNote++;
            if (this.muted.has(note.part)) continue;
            if (note.end <= span.to) continue; // нота целиком уместилась в кадр
            sink.noteOn(note.midi, note.velocity);
            this.sounding.push(note);
        }

        // Цикл уже вернул время в ноль — пересобираем указатели.
        if (this.transport.time < span.from) {
            this.silence(sink);
            this.resync(sink);
        }
    }

    private silence(sink: NoteSink): void {
        sink.setSustain(false);
        sink.panic();
        this.sounding.length = 0;
    }

    /** Что должно звучать и быть нажато в текущей точке времени. */
    private resync(sink: NoteSink): void {
        const score = this.score;
        if (!score) return;
        const time = this.transport.time;

        this.nextNote = firstNoteAtOrAfter(score.notes, time);
        this.nextPedal = 0;
        let sustain = false;
        while (this.nextPedal < score.pedal.length && score.pedal[this.nextPedal]!.time <= time) {
            sustain = score.pedal[this.nextPedal]!.on;
            this.nextPedal++;
        }
        if (sustain) sink.setSustain(true);

        const from = time - score.maxDuration;
        for (let i = this.nextNote - 1; i >= 0; i--) {
            const note = score.notes[i]!;
            if (note.start < from) break;
            if (note.end <= time || this.muted.has(note.part)) continue;
            sink.noteOn(note.midi, note.velocity);
            this.sounding.push(note);
        }
    }
}
