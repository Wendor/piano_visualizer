import type { Scene } from "../core/Scene";

/** Источник нот: MIDI-порт, клавиатура ПК, мышь, автодемо, что угодно. */
export interface InputSource {
    readonly id: string;
    attach(scene: Scene): void;
    detach(): void;
}
