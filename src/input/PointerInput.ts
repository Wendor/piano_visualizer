import type { Scene } from "../core/Scene";
import type { InputSource } from "./types";

/** Игра мышью и пальцем прямо по нарисованным клавишам. */
export class PointerInput implements InputSource {
    readonly id = "input.pointer";
    private scene: Scene | null = null;
    private current: number | null = null;

    constructor(
        private readonly element: HTMLElement,
        private readonly velocity = 100
    ) {}

    attach(scene: Scene): void {
        this.scene = scene;
        this.element.addEventListener("pointerdown", this.onDown);
        this.element.addEventListener("pointermove", this.onMove);
        this.element.addEventListener("pointerup", this.onUp);
        this.element.addEventListener("pointercancel", this.onUp);
    }

    detach(): void {
        this.element.removeEventListener("pointerdown", this.onDown);
        this.element.removeEventListener("pointermove", this.onMove);
        this.element.removeEventListener("pointerup", this.onUp);
        this.element.removeEventListener("pointercancel", this.onUp);
        this.scene = null;
    }

    private readonly onDown = (event: PointerEvent): void => {
        const scene = this.scene;
        if (!scene) return;
        const key = scene.layout.keyAt(event.clientX, event.clientY);
        if (!key) return;
        this.element.setPointerCapture(event.pointerId);
        this.current = key.midi;
        scene.noteOn(key.midi, this.velocity, { performance: true });
    };

    private readonly onMove = (event: PointerEvent): void => {
        const scene = this.scene;
        if (!scene || this.current === null) return;
        const key = scene.layout.keyAt(event.clientX, event.clientY);
        if (!key || key.midi === this.current) return;
        scene.noteOff(this.current);
        this.current = key.midi;
        scene.noteOn(key.midi, this.velocity, { performance: true });
    };

    private readonly onUp = (): void => {
        if (this.current === null || !this.scene) return;
        this.scene.noteOff(this.current);
        this.current = null;
    };
}
