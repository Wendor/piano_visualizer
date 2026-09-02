import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";

/** Тонкая светящаяся линия по кромке клавиатуры. */
export class StrikeLineLayer extends BaseLayer {
    readonly id = "effects.strikeLine";
    readonly stage = Stage.Atmosphere + 10;

    constructor(private readonly height = 8) {
        super();
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const { layout, theme, viewport } = scene;
        const hue = theme.midHue;
        const top = layout.top - (this.height - 1);

        g.globalCompositeOperation = "lighter";
        const gradient = g.createLinearGradient(0, top, 0, layout.top + 1);
        gradient.addColorStop(0, theme.color(hue, 62, 0));
        gradient.addColorStop(0.72, theme.color(hue, 58, 0.13));
        gradient.addColorStop(1, theme.color(hue, 82, 0.34));
        g.fillStyle = gradient;
        g.fillRect(0, top, viewport.width, this.height);
    }
}
