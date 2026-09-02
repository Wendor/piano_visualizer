import { Emitter } from "../core/Emitter";
import { clamp } from "../core/math";

export type TransportState = "stopped" | "playing" | "paused";

export interface TransportEvents extends Record<string, unknown> {
    state: { state: TransportState };
    /** Время сдвинуто скачком — звучащее надо пересобрать. */
    seek: { time: number };
    ended: Record<string, never>;
}

/** Часы воспроизведения: положение, скорость, цикл. Нот не знает. */
export class Transport {
    readonly events = new Emitter<TransportEvents>();

    time = 0;
    speed = 1;
    loop = false;
    duration = 0;

    private current: TransportState = "stopped";

    get state(): TransportState {
        return this.current;
    }

    get playing(): boolean {
        return this.current === "playing";
    }

    play(): void {
        if (this.duration <= 0) return;
        if (this.time >= this.duration) this.seek(0);
        this.setState("playing");
    }

    pause(): void {
        if (this.current === "playing") this.setState("paused");
    }

    toggle(): void {
        if (this.current === "playing") this.pause();
        else this.play();
    }

    stop(): void {
        this.setState("stopped");
        this.seek(0);
    }

    seek(time: number): void {
        this.time = clamp(time, 0, this.duration);
        this.events.emit("seek", { time: this.time });
    }

    setSpeed(value: number): void {
        this.speed = clamp(value, 0.25, 2);
    }

    /**
     * Продвинуть часы. Возвращает пройденный отрезок времени — по нему плеер
     * находит события. На конце файла либо цикл (отрезок обрывается и время
     * прыгает в ноль), либо остановка.
     */
    advance(dt: number): { from: number; to: number } | null {
        if (this.current !== "playing" || this.duration <= 0) return null;

        const from = this.time;
        const to = from + dt * this.speed;
        if (to < this.duration) {
            this.time = to;
            return { from, to };
        }

        this.time = this.duration;
        if (this.loop) {
            this.seek(0);
            return { from, to: this.duration };
        }
        this.setState("paused");
        this.events.emit("ended", {});
        return { from, to: this.duration };
    }

    private setState(state: TransportState): void {
        if (this.current === state) return;
        this.current = state;
        this.events.emit("state", { state });
    }
}
