import type { Scene } from "../core/Scene";
import type { InputSource } from "./types";

export interface DemoOptions {
    chords: readonly (readonly number[])[];
    pattern: readonly number[];
    /** Интервал между нотами, сек. */
    step: number;
    startDelay: number;
}

const DEFAULT_CHORDS = [
    [45, 52, 57, 60, 64],
    [41, 48, 53, 57, 60],
    [36, 43, 48, 52, 55],
    [43, 50, 55, 59, 62]
] as const;

/** Играет само, пока человек не сыграл первую ноту. */
export class DemoPlayer implements InputSource {
    readonly id = "input.demo";
    private readonly options: DemoOptions;

    private scene: Scene | null = null;
    private timer = 0;
    private index = 0;
    private stopped = false;
    private detachPerformance: (() => void) | null = null;
    private frame = 0;
    private lastTime = 0;
    private readonly held = new Set<number>();

    constructor(options: Partial<DemoOptions> = {}) {
        this.options = {
            chords: DEFAULT_CHORDS,
            pattern: [0, 2, 3, 4, 3, 2, 4, 3],
            step: 0.3,
            startDelay: 1.2,
            ...options
        };
    }

    attach(scene: Scene): void {
        this.scene = scene;
        this.timer = -this.options.startDelay;
        this.detachPerformance = scene.events.on("performance", () => this.stop());
        this.lastTime = performance.now();
        this.frame = requestAnimationFrame(this.tick);
    }

    detach(): void {
        this.stop();
        this.detachPerformance?.();
        this.detachPerformance = null;
        this.scene = null;
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        cancelAnimationFrame(this.frame);
        for (const midi of this.held) this.scene?.noteOff(midi, true);
        this.held.clear();
    }

    private readonly tick = (now: number): void => {
        const dt = Math.min(0.1, (now - this.lastTime) / 1000);
        this.lastTime = now;
        if (!this.stopped) {
            this.advance(dt);
            this.frame = requestAnimationFrame(this.tick);
        }
    };

    private advance(dt: number): void {
        const scene = this.scene;
        if (!scene) return;

        this.timer += dt;
        if (this.timer < this.options.step) return;
        this.timer -= this.options.step;

        const { chords, pattern } = this.options;
        const chord = chords[Math.floor(this.index / pattern.length) % chords.length]!;
        const position = this.index % pattern.length;
        let midi = chord[pattern[position]!] ?? chord[0]!;
        if (position === 0) midi = chord[0]! - 12;
        if (position === 4 || position === 7) midi += 12;

        this.play(midi, 62 + Math.round(Math.random() * 45), 0.24 + Math.random() * 0.26);
        if (position === 3 && Math.random() < 0.7) {
            this.play(chord[4]! + 12, 70, 0.4);
        }
        this.index++;
    }

    private play(midi: number, velocity: number, duration: number): void {
        const scene = this.scene;
        if (!scene) return;
        scene.noteOn(midi, velocity);
        this.held.add(midi);
        window.setTimeout(() => {
            if (this.stopped) return;
            scene.noteOff(midi);
            this.held.delete(midi);
        }, duration * 1000);
    }
}
