import { Emitter } from "./Emitter";
import { KeyboardLayout, isAccidental, DEFAULT_LAYOUT_OPTIONS } from "./layout";
import type { LayoutOptions } from "./layout";
import { Theme } from "../theme/Theme";
import { Playback } from "../score/Playback";
import type { Viewport } from "./types";

/** Откуда нота: живая игра или партия файла — это нужно звуку, не картинке. */
export interface NoteOptions {
    performance?: boolean;
    /** Индекс партии партитуры; -1 — живая игра. */
    part?: number;
}

/** Сыгранная нота: чистое музыкальное событие, без геометрии. */
export interface NoteEvent {
    readonly id: number;
    readonly midi: number;
    readonly velocity: number;
    readonly accidental: boolean;
    /** Время нажатия в секундах от старта сцены. */
    readonly start: number;
    /** Время отпускания; null, пока клавиша держится. */
    end: number | null;
}

export interface ActiveNote {
    readonly midi: number;
    readonly velocity: number;
    readonly start: number;
    /** Клавиша отпущена, но звучит на педали. */
    sustained: boolean;
}

export interface SceneEvents extends Record<string, unknown> {
    noteon: { midi: number; velocity: number; time: number; part: number };
    noteoff: { midi: number; time: number };
    sustain: { on: boolean };
    layout: { layout: KeyboardLayout };
    theme: { theme: Theme };
    /** Первая нота, сыгранная человеком, — сигнал выключить автодемо. */
    performance: { midi: number };
}

/**
 * Состояние сцены: клавиатура, тема, живые нажатия и история нот.
 * Слои только читают состояние, источники ввода — меняют.
 */
export class Scene {
    readonly events = new Emitter<SceneEvents>();
    readonly layout = new KeyboardLayout({ ...DEFAULT_LAYOUT_OPTIONS });
    readonly theme = new Theme();
    readonly active = new Map<number, ActiveNote>();
    readonly notes: NoteEvent[] = [];
    /** Воспроизведение партитуры: у файла, в отличие от живой игры, есть будущее. */
    readonly playback = new Playback();

    viewport: Viewport = { width: 0, height: 0, dpr: 1 };
    /** Секунды от старта. */
    time = 0;
    sustain = false;
    /** Пока открыта панель настроек, клавиатура ПК не играет ноты. */
    inputLocked = false;
    /** Сколько нот сыграно живым вводом (не автодемо). */
    performed = 0;
    /**
     * Насыщенность момента, 0…1: растёт от ударов, держится, пока клавиши
     * зажаты, и медленно гаснет в тишине. Фоновые эффекты дышат по ней,
     * поэтому считать её каждому слою отдельно незачем.
     */
    energy = 0;

    private nextId = 1;
    private retentionRequests = new Map<string, number>();
    private retention = 8;

    configureLayout(patch: Partial<LayoutOptions>): void {
        this.layout.configure(patch);
    }

    /** Слой сообщает, сколько секунд истории ему нужно (напр. время пролёта ноты). */
    requestRetention(layerId: string, seconds: number): void {
        this.retentionRequests.set(layerId, seconds);
        this.retention = Math.max(2, ...this.retentionRequests.values());
    }

    resize(viewport: Viewport): void {
        this.viewport = viewport;
        this.layout.build(viewport);
        this.events.emit("layout", { layout: this.layout });
    }

    noteOn(midi: number, velocity: number, options: NoteOptions = {}): void {
        const key = this.layout.get(midi) ?? this.layout.get(this.layout.fold(midi));
        if (!key) return;
        const target = key.midi;

        if (this.active.has(target)) this.noteOff(target, true);

        this.active.set(target, { midi: target, velocity, start: this.time, sustained: false });
        this.notes.push({
            id: this.nextId++,
            midi: target,
            velocity,
            accidental: isAccidental(target),
            start: this.time,
            end: null
        });

        // Каждая следующая нота добавляет меньше предыдущей: иначе на плотном
        // месте энергия упирается в единицу и перестаёт что-либо означать.
        this.energy += (1 - this.energy) * (0.1 + (velocity / 127) * 0.14);

        if (options.performance) {
            this.performed++;
            this.events.emit("performance", { midi: target });
        }
        this.events.emit("noteon", { midi: target, velocity, time: this.time, part: options.part ?? -1 });
    }

    noteOff(midi: number, force = false): void {
        let target = midi;
        if (!this.active.has(target)) {
            const folded = this.layout.fold(midi);
            if (this.active.has(folded)) target = folded;
        }
        const state = this.active.get(target);
        if (!state) return;

        if (this.sustain && !force) {
            state.sustained = true;
            return;
        }

        this.active.delete(target);
        for (let i = this.notes.length - 1; i >= 0; i--) {
            const note = this.notes[i]!;
            if (note.midi === target && note.end === null) {
                note.end = this.time;
                break;
            }
        }
        this.events.emit("noteoff", { midi: target, time: this.time });
    }

    setSustain(on: boolean): void {
        if (this.sustain === on) return;
        this.sustain = on;
        this.events.emit("sustain", { on });
        if (on) return;
        for (const [midi, state] of [...this.active]) if (state.sustained) this.noteOff(midi, true);
    }

    /** All notes off. */
    panic(): void {
        for (const midi of [...this.active.keys()]) this.noteOff(midi, true);
    }

    setPalette(theme: Theme["palette"]): void {
        this.theme.palette = theme;
        this.events.emit("theme", { theme: this.theme });
    }

    /** Сдвиг времени, ноты из партитуры и уборка вышедшей истории. */
    advance(dt: number): void {
        this.time += dt;
        this.playback.advance(dt, this);

        const decay = this.energy * dt * 1.4;
        // Пока клавиши зажаты, энергия не падает ниже уровня «звучит аккорд».
        const floor = Math.min(0.55, this.active.size * 0.09);
        this.energy = Math.max(floor, this.energy - decay);
        const cutoff = this.time - this.retention;
        let alive = 0;
        for (const note of this.notes) if (note.end === null || note.end > cutoff) alive++;
        if (alive !== this.notes.length) {
            const kept = this.notes.filter((note) => note.end === null || note.end > cutoff);
            this.notes.length = 0;
            this.notes.push(...kept);
        }
    }
}
