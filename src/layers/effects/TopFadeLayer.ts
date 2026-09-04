import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import { GradientBook, stop } from "../../paint/Gradient";
import type { ParamSpec } from "../../settings/types";
import type { Painter } from "../../paint/Painter";
import { tint } from "../../paint/Tint";

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
    // Затемнение зависит только от палитры и высоты полосы: и то и другое
    // держится кадрами, а разбор цвета и три остановки — работа на каждый.
    private readonly gradients = new GradientBook(16);

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
                format: { unit: "px" },
                get: () => o.maxHeight,
                set: (value) => {
                    o.maxHeight = value;
                }
            }
        ];
    }

    override draw(p: Painter, scene: Scene): void {
        const height = Math.min(this.options.maxHeight, scene.layout.top * 0.35);
        if (height <= 0) return;

        const background = scene.theme.palette.background;
        const veil = this.gradients.get(background, () => [
            stop(0, tint(background)),
            stop(0.55, tint(this.fade(background, 0.55))),
            stop(1, tint(this.fade(background, 0)))
        ]);
        p.fillGradient(0, 0, scene.viewport.width, height, veil, "y");
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
