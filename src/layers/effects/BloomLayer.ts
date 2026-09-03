import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { GlowBuffer } from "../../core/GlowBuffer";
import type { Quality } from "../../core/Quality";
import { clamp } from "../../core/math";
import { bloomPyramid } from "./bloomPyramid";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";

export interface BloomPass {
    blur: number;
    alpha: number;
}

export interface BloomOptions {
    /** Общая сила свечения: 0 — выключено, 2 — максимум. */
    strength: number;
    passes: BloomPass[];
}

/** Накопленный буфер свечения кладётся на сцену несколькими размытиями. */
export class BloomLayer extends BaseLayer {
    readonly id = "effects.bloom";
    readonly stage = Stage.Bloom;
    readonly title = "Свечение";
    readonly options: BloomOptions;

    /** Накопитель размытий: размер буфера свечения, не экрана. */
    private readonly acc = document.createElement("canvas");
    private readonly accCtx: CanvasRenderingContext2D;
    /** Ступени пирамиды по величине уменьшения; переживают кадр. */
    private readonly steps = new Map<number, HTMLCanvasElement>();

    constructor(
        private readonly glow: GlowBuffer,
        private readonly quality: Quality,
        options: Partial<BloomOptions> = {}
    ) {
        super();
        const ctx = this.acc.getContext("2d");
        if (!ctx) throw new Error("Контекст блума недоступен");
        this.accCtx = ctx;
        this.options = {
            strength: 1,
            passes: [
                { blur: 4, alpha: 0.62 },
                { blur: 14, alpha: 0.52 },
                { blur: 40, alpha: 0.42 }
            ],
            ...options
        };
    }

    override params(): ParamSpec[] {
        return [
            {
                type: "number",
                key: "strength",
                label: "Сила свечения",
                group: "effects",
                min: 0,
                max: 2,
                step: 0.1,
                format: percent,
                get: () => this.options.strength,
                set: (value) => this.setStrength(value)
            }
        ];
    }

    setStrength(value: number): number {
        this.options.strength = clamp(value, 0, 2);
        return this.options.strength;
    }

    /**
     * Размытие считается внутри буфера свечения, а не на экране: буфер вчетверо
     * меньше по стороне, значит работы в шестнадцать раз меньше, а после
     * растягивания разницы не видно — картинка и так мягкая.
     *
     * Самого фильтра размытия здесь нет. `filter: blur()` на слабых машинах
     * уходит на программный путь и стоит миллисекунды даже на буфере в сотню
     * пикселей по стороне; вместо него — пирамида уменьшений, где размывает
     * та же билинейная выборка, которой картинка и так выводится на экран.
     */
    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const { strength } = this.options;
        if (strength <= 0.01) return;

        const { width, height } = scene.viewport;
        const source = this.glow.canvas;
        if (source.width < 1 || source.height < 1) return;

        const count = Math.max(1, Math.min(this.options.passes.length, this.quality.profile.bloomPasses));
        const levels = bloomPyramid(
            source.width,
            source.height,
            this.options.passes.slice(0, count),
            this.glow.scaleFactor
        );
        if (levels.length === 0) return;

        // Уровни строятся друг из друга: последовательное деление пополам
        // усредняет мягче, чем одно уменьшение сразу в восемь раз.
        const made = new Map<number, HTMLCanvasElement>([[1, source]]);
        let previous: HTMLCanvasElement = source;
        const deepest = levels[levels.length - 1]!.scale;
        for (let scale = 2; scale <= deepest; scale *= 2) {
            const step = this.step(scale, source.width, source.height);
            const ctx = step.getContext("2d");
            if (!ctx) break;
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, step.width, step.height);
            ctx.drawImage(previous, 0, 0, step.width, step.height);
            made.set(scale, step);
            previous = step;
        }

        if (this.acc.width !== source.width || this.acc.height !== source.height) {
            this.acc.width = source.width;
            this.acc.height = source.height;
        }
        const acc = this.accCtx;
        acc.globalCompositeOperation = "source-over";
        acc.globalAlpha = 1;
        acc.clearRect(0, 0, this.acc.width, this.acc.height);
        acc.globalCompositeOperation = "lighter";
        for (const level of levels) {
            const layer = made.get(level.scale);
            if (!layer) continue;
            acc.globalAlpha = Math.min(1, level.alpha * strength);
            acc.drawImage(layer, 0, 0, this.acc.width, this.acc.height);
        }
        acc.globalAlpha = 1;

        // Все уровни уже сложены — на экран уходит один растянутый рисунок.
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 1;
        g.drawImage(this.acc, 0, 0, width, height);
    }

    override dispose(): void {
        this.steps.clear();
    }

    /** Холст ступени, уменьшенной в `scale` раз. Переживает кадры. */
    private step(scale: number, sourceWidth: number, sourceHeight: number): HTMLCanvasElement {
        const width = Math.max(1, Math.round(sourceWidth / scale));
        const height = Math.max(1, Math.round(sourceHeight / scale));
        let canvas = this.steps.get(scale);
        if (!canvas) {
            canvas = document.createElement("canvas");
            this.steps.set(scale, canvas);
        }
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return canvas;
    }
}
