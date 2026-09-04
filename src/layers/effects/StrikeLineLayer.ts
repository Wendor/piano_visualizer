import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import { GradientCache } from "../../core/gradients";
import type { ParamSpec } from "../../settings/types";
import type { Ctx2D } from "../../core/surface";

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
    private readonly gradients = new GradientCache(16);

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

    override draw(g: Ctx2D, scene: Scene): void {
        const { layout, theme, viewport } = scene;
        const hue = theme.midHue;
        const height = this.options.height;
        const top = layout.top - (height - 1);

        g.globalCompositeOperation = "lighter";
        g.fillStyle = this.gradients.get(`${theme.palette.id}|${Math.round(top)}|${height}`, () => {
            const gradient = g.createLinearGradient(0, top, 0, layout.top + 1);
            gradient.addColorStop(0, theme.color(hue, 62, 0));
            gradient.addColorStop(0.72, theme.color(hue, 58, 0.13));
            gradient.addColorStop(1, theme.color(hue, 82, 0.34));
            return gradient;
        });
        g.fillRect(0, top, viewport.width, height);
    }
}
