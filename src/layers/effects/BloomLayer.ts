import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { Quality } from "../../core/Quality";
import { clamp } from "../../core/math";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";
import type { Painter } from "../../paint/Painter";

export interface BloomOptions {
    /** Общая сила свечения: 0 — выключено, 2 — максимум. */
    strength: number;
}

/**
 * Место в порядке рисования, где накопленное свечение ложится на сцену.
 *
 * Само размытие — работа движка, а не слоя: холст 2D делает его пирамидой
 * уменьшений или фильтром (что дешевле, выясняется замером), видеочип — парой
 * проходов шейдера. Слой говорит только «здесь и вот настолько ярко».
 */
export class BloomLayer extends BaseLayer {
    readonly id = "effects.bloom";
    readonly stage = Stage.Bloom;
    readonly title = "Свечение";
    readonly options: BloomOptions;

    constructor(
        private readonly quality: Quality,
        options: Partial<BloomOptions> = {}
    ) {
        super();
        this.options = { strength: 1, ...options };
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

    /** Пока сила на нуле, свечение никому не нужно — и наполнять его незачем. */
    needsGlow(): boolean {
        return this.options.strength > 0.01;
    }

    setStrength(value: number): number {
        this.options.strength = clamp(value, 0, 2);
        return this.options.strength;
    }

    override draw(p: Painter, _scene: Scene): void {
        p.bloom(this.options.strength, this.quality.profile.bloomPasses);
    }
}
