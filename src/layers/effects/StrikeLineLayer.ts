import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import { GradientBook, stop } from "../../paint/Gradient";
import type { ParamSpec } from "../../settings/types";
import type { Painter } from "../../paint/Painter";

export interface StrikeLineOptions {
    /** Толщина светящейся кромки, px. */
    height: number;
}

/** Тонкая светящаяся линия по кромке клавиатуры. */
export class StrikeLineLayer extends BaseLayer {
    readonly id = "effects.strikeLine";
    readonly stage = Stage.Atmosphere + 10;
    readonly title = "Линия удара";
    readonly options: StrikeLineOptions;
    private readonly gradients = new GradientBook(16);

    constructor(options: Partial<StrikeLineOptions> = {}) {
        super();
        this.options = { height: 8, ...options };
    }

    override params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "height",
                label: "Толщина линии",
                group: "effects",
                min: 2,
                max: 24,
                step: 1,
                format: { unit: "px" },
                get: () => o.height,
                set: (value) => {
                    o.height = Math.round(value);
                }
            }
        ];
    }

    override draw(p: Painter, scene: Scene): void {
        const { layout, theme, viewport } = scene;
        const hue = theme.midHue;
        const height = this.options.height;
        const top = layout.top - (height - 1);

        const light = this.gradients.get(theme.palette.id, () => [
            stop(0, theme.tint(hue, 62, 0)),
            stop(0.72, theme.tint(hue, 58, 0.13)),
            stop(1, theme.tint(hue, 82, 0.34))
        ]);
        p.blend = "add";
        p.fillGradient(0, top, viewport.width, height, light, "y");
    }
}
