import { BaseLayer, Stage } from "../core/types";
import type { Scene } from "../core/Scene";
import { GradientCache } from "../core/gradients";
import type { Ctx2D } from "../core/surface";

export interface BackgroundOptions {
    /** Насколько высоко от клавиатуры поднимается подсветка фона. */
    glowFraction: number;
}

/** Фон сцены: ровная тьма с лёгким подъёмом света к линии удара. */
export class BackgroundLayer extends BaseLayer {
    readonly id = "background";
    readonly stage = Stage.Background;
    readonly title = "Фон";
    readonly toggleable = false;
    private readonly options: BackgroundOptions;
    // Подсветка у кромки меняется только с размером окна и палитрой, а строить
    // её заново — работа на каждый кадр за один и тот же результат.
    private readonly gradients = new GradientCache(8);

    constructor(options: Partial<BackgroundOptions> = {}) {
        super();
        this.options = { glowFraction: 0.55, ...options };
    }

    override draw(g: Ctx2D, scene: Scene): void {
        const { width, height } = scene.viewport;
        const { top } = scene.layout;

        g.fillStyle = scene.theme.palette.background;
        g.fillRect(0, 0, width, height);

        const band = height * this.options.glowFraction;
        g.fillStyle = this.gradients.get(
            `${scene.theme.palette.id}|${Math.round(top)}|${Math.round(band)}`,
            () => {
                const gradient = g.createLinearGradient(0, top - band, 0, top);
                gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
                gradient.addColorStop(1, scene.theme.palette.backgroundGlow);
                return gradient;
            }
        );
        g.fillRect(0, top - band, width, band);
    }
}
