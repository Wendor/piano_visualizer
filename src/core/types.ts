import type { Scene } from "./Scene";

export interface Viewport {
    width: number;
    height: number;
    dpr: number;
}

/**
 * Порядок отрисовки. Слой объявляет свою ступень — сцена сортирует по ней,
 * поэтому новый эффект достаточно зарегистрировать с нужным номером.
 */
export const Stage = {
    Background: 0,
    NotesBack: 100,
    Notes: 200,
    Particles: 300,
    /** Здесь накопленный буфер свечения ложится на сцену. */
    Bloom: 400,
    Atmosphere: 500,
    Keyboard: 600,
    Overlay: 700
} as const;

export type StageValue = (typeof Stage)[keyof typeof Stage] | number;

/**
 * Слой — единица визуализации. Может рисовать в основной холст (`draw`),
 * в буфер свечения (`drawGlow`) или только считать состояние (`update`).
 */
export interface Layer {
    readonly id: string;
    readonly stage: StageValue;
    enabled: boolean;
    init?(scene: Scene): void;
    resize?(scene: Scene): void;
    update?(scene: Scene, dt: number): void;
    drawGlow?(g: CanvasRenderingContext2D, scene: Scene): void;
    draw?(g: CanvasRenderingContext2D, scene: Scene): void;
    dispose?(): void;
}

/** Базовый класс: наследник переопределяет только нужные шаги. */
export abstract class BaseLayer implements Layer {
    enabled = true;
    abstract readonly id: string;
    abstract readonly stage: StageValue;

    init(_scene: Scene): void {}
    resize(_scene: Scene): void {}
    update(_scene: Scene, _dt: number): void {}
    drawGlow(_g: CanvasRenderingContext2D, _scene: Scene): void {}
    draw(_g: CanvasRenderingContext2D, _scene: Scene): void {}
    dispose(): void {}
}
