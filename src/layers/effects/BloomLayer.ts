import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { GlowBuffer } from "../../core/GlowBuffer";
import type { Quality } from "../../core/Quality";
import { clamp } from "../../core/math";
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

const supportsFilter = ((): boolean => {
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return false;
    probe.filter = "blur(2px)";
    return probe.filter === "blur(2px)";
})();

/** Накопленный буфер свечения кладётся на сцену несколькими размытиями. */
export class BloomLayer extends BaseLayer {
    readonly id = "effects.bloom";
    readonly stage = Stage.Bloom;
    readonly title = "Свечение";
    readonly options: BloomOptions;

    /** Накопитель размытий: размер буфера свечения, не экрана. */
    private readonly acc = document.createElement("canvas");
    private readonly accCtx: CanvasRenderingContext2D;

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
     */
    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const { strength } = this.options;
        if (strength <= 0.01) return;

        const { width, height } = scene.viewport;
        const source = this.glow.canvas;
        if (source.width < 1 || source.height < 1) return;

        g.globalCompositeOperation = "lighter";

        if (!supportsFilter) {
            g.globalAlpha = Math.min(1, 0.9 * strength);
            g.drawImage(source, 0, 0, width, height);
            g.globalAlpha = 1;
            return;
        }

        const count = Math.max(1, Math.min(this.options.passes.length, this.quality.profile.bloomPasses));
        const radius = this.glow.scaleFactor;
        const acc = this.accCtx;

        if (this.acc.width !== source.width || this.acc.height !== source.height) {
            this.acc.width = source.width;
            this.acc.height = source.height;
        }
        acc.globalCompositeOperation = "source-over";
        acc.clearRect(0, 0, this.acc.width, this.acc.height);
        acc.globalCompositeOperation = "lighter";

        for (let i = 0; i < count; i++) {
            const pass = this.options.passes[i]!;
            acc.filter = `blur(${(pass.blur * radius).toFixed(2)}px)`;
            acc.globalAlpha = Math.min(1, pass.alpha * strength);
            acc.drawImage(source, 0, 0);
        }
        acc.filter = "none";
        acc.globalAlpha = 1;

        // Все проходы уже сложены — на экран уходит один растянутый рисунок.
        g.globalAlpha = 1;
        g.drawImage(this.acc, 0, 0, width, height);
    }
}
