import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { GlowBuffer } from "../../core/GlowBuffer";
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

    constructor(
        private readonly glow: GlowBuffer,
        options: Partial<BloomOptions> = {}
    ) {
        super();
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

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const { strength } = this.options;
        if (strength <= 0.01) return;

        const { width, height } = scene.viewport;
        const passes = supportsFilter ? this.options.passes : [{ blur: 0, alpha: 0.9 }];

        g.globalCompositeOperation = "lighter";
        for (const pass of passes) {
            if (supportsFilter) g.filter = `blur(${pass.blur}px)`;
            g.globalAlpha = Math.min(1, pass.alpha * strength);
            g.drawImage(this.glow.canvas, 0, 0, width, height);
        }
        g.filter = "none";
        g.globalAlpha = 1;
    }
}
