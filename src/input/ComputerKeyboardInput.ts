import type { Scene } from "../core/Scene";
import type { InputSource } from "./types";

/** Раскладка «как в трекере»: нижний ряд — от до малой октавы, верхний — октавой выше. */
export const TRACKER_LAYOUT: Readonly<Record<string, number>> = {
    KeyZ: 48,
    KeyS: 49,
    KeyX: 50,
    KeyD: 51,
    KeyC: 52,
    KeyV: 53,
    KeyG: 54,
    KeyB: 55,
    KeyH: 56,
    KeyN: 57,
    KeyJ: 58,
    KeyM: 59,
    Comma: 60,
    KeyL: 61,
    Period: 62,
    KeyQ: 60,
    Digit2: 61,
    KeyW: 62,
    Digit3: 63,
    KeyE: 64,
    KeyR: 65,
    Digit5: 66,
    KeyT: 67,
    Digit6: 68,
    KeyY: 69,
    Digit7: 70,
    KeyU: 71,
    KeyI: 72,
    Digit9: 73,
    KeyO: 74
};

export interface ComputerKeyboardOptions {
    map: Readonly<Record<string, number>>;
    velocity: number;
    /** Клавиша-педаль. */
    sustainCode: string;
}

/** Игра с клавиатуры компьютера — для проверки без инструмента. */
export class ComputerKeyboardInput implements InputSource {
    readonly id = "input.computerKeyboard";
    private readonly options: ComputerKeyboardOptions;
    private scene: Scene | null = null;

    constructor(options: Partial<ComputerKeyboardOptions> = {}) {
        this.options = { map: TRACKER_LAYOUT, velocity: 96, sustainCode: "Space", ...options };
    }

    attach(scene: Scene): void {
        this.scene = scene;
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
    }

    detach(): void {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        this.scene = null;
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const scene = this.scene;
        if (!scene || scene.inputLocked) return;
        if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

        if (event.code === this.options.sustainCode) {
            scene.setSustain(true);
            event.preventDefault();
            return;
        }
        const midi = this.options.map[event.code];
        if (midi === undefined) return;
        scene.noteOn(midi, this.options.velocity, { performance: true });
    };

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        const scene = this.scene;
        if (!scene || scene.inputLocked) return;

        if (event.code === this.options.sustainCode) {
            scene.setSustain(false);
            return;
        }
        const midi = this.options.map[event.code];
        if (midi !== undefined) scene.noteOff(midi);
    };
}
