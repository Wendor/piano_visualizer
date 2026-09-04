import type { Scene } from "./Scene";
import type { ParamSpec } from "../settings/types";
import type { Painter } from "../paint/Painter";

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
 * Слой — единица визуализации. Может рисовать на сцену (`draw`), в буфер
 * свечения (`drawGlow`) или только считать состояние (`update`).
 *
 * Рисует он художником, а не холстом: чем именно картина станет пикселями —
 * процессором или видеочипом — слоя не касается.
 */
export interface Layer {
    readonly id: string;
    readonly stage: StageValue;
    enabled: boolean;
    /** Имя для панели настроек; по умолчанию — id. */
    readonly title?: string;
    /** Можно ли выключать слой из панели. Фон, ноты и клавиатура — нет. */
    readonly toggleable?: boolean;
    /**
     * Слою нужен буфер свечения таким, каким его наполнили другие. Пока о нём
     * никто не просит, сцена буфер не наполняет вовсе — а это половина работы
     * всех светящихся слоёв.
     */
    needsGlow?(): boolean;
    /** Настраиваемые параметры слоя. */
    params?(): ParamSpec[];
    init?(scene: Scene): void;
    resize?(scene: Scene): void;
    update?(scene: Scene, dt: number): void;
    drawGlow?(p: Painter, scene: Scene): void;
    draw?(p: Painter, scene: Scene): void;
    dispose?(): void;
}

/** Базовый класс: наследник переопределяет только нужные шаги. */
export abstract class BaseLayer implements Layer {
    enabled = true;
    abstract readonly id: string;
    abstract readonly stage: StageValue;

    params(): ParamSpec[] {
        return [];
    }

    init(_scene: Scene): void {}
    resize(_scene: Scene): void {}
    update(_scene: Scene, _dt: number): void {}
    drawGlow(_p: Painter, _scene: Scene): void {}
    draw(_p: Painter, _scene: Scene): void {}
    dispose(): void {}
}
