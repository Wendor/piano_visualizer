import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { ParamSpec } from "../../settings/types";

export interface TopFadeOptions {
    /** Предельная высота затемнения у верхней кромки, px. */
    maxHeight: number;
}

/** Ноты уходят в темноту у верхней кромки, а не обрезаются на полуслове. */
export class TopFadeLayer extends BaseLayer {
    readonly id = "effects.topFade";
    readonly stage = Stage.Atmosphere;
    readonly title = "Затемнение сверху";
    readonly options: TopFadeOptions;

    constructor(options: Partial<TopFadeOptions> = {}) {
        super();
        this.options = { maxHeight: 170, ...options };
    }

    override params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "maxHeight",
                label: "Высота затемнения",
                group: "effects",
                min: 0,
                max: 400,
                step: 10,
                format: (value) => `${Math.round(value)} px`,
                get: () => o.maxHeight,
                set: (value) => {
                    o.maxHeight = value;
                }
            }
        ];
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const height = Math.min(this.options.maxHeight, scene.layout.top * 0.35);
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
