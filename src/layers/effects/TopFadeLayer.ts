import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";

/** Ноты уходят в темноту у верхней кромки, а не обрезаются на полуслове. */
export class TopFadeLayer extends BaseLayer {
    readonly id = "effects.topFade";
    readonly stage = Stage.Atmosphere;

    constructor(private readonly maxHeight = 170) {
        super();
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const height = Math.min(this.maxHeight, scene.layout.top * 0.35);
        if (height <= 0) return;

        const background = scene.theme.palette.background;
        const gradient = g.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, background);
        gradient.addColorStop(0.55, this.fade(background, 0.55));
        gradient.addColorStop(1, this.fade(background, 0));
        g.fillStyle = gradient;
        g.fillRect(0, 0, scene.viewport.width, height);
    }

    /** #rrggbb → rgba(...) с нужной прозрачностью. */
    private fade(hex: string, alpha: number): string {
        const value = hex.replace("#", "");
        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}
