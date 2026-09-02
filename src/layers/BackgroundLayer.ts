import { BaseLayer, Stage } from "../core/types";
import type { Scene } from "../core/Scene";

export interface BackgroundOptions {
    /** Насколько высоко от клавиатуры поднимается подсветка фона. */
    glowFraction: number;
}

/** Фон сцены: ровная тьма с лёгким подъёмом света к линии удара. */
export class BackgroundLayer extends BaseLayer {
    readonly id = "background";
    readonly stage = Stage.Background;
    private readonly options: BackgroundOptions;

    constructor(options: Partial<BackgroundOptions> = {}) {
        super();
        this.options = { glowFraction: 0.55, ...options };
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const { width, height } = scene.viewport;
        const { top } = scene.layout;

        g.fillStyle = scene.theme.palette.background;
        g.fillRect(0, 0, width, height);

        const band = height * this.options.glowFraction;
        const gradient = g.createLinearGradient(0, top - band, 0, top);
        gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
        gradient.addColorStop(1, scene.theme.palette.backgroundGlow);
        g.fillStyle = gradient;
        g.fillRect(0, top - band, width, band);
    }
}
