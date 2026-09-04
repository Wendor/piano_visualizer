import { BaseLayer, Stage } from "../core/types";
import type { Scene } from "../core/Scene";
import { GradientBook, stop } from "../paint/Gradient";
import { TRANSPARENT } from "../paint/Tint";
import type { Painter } from "../paint/Painter";

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
    // Подсветка у кромки меняется только с палитрой, а собирать её заново —
    // работа на каждый кадр за один и тот же ответ.
    private readonly gradients = new GradientBook(8);

    constructor(options: Partial<BackgroundOptions> = {}) {
        super();
        this.options = { glowFraction: 0.55, ...options };
    }

    override draw(p: Painter, scene: Scene): void {
        const { width, height } = scene.viewport;
        const { top } = scene.layout;
        const { theme } = scene;

        p.fill(0, 0, width, height, theme.background);

        const band = height * this.options.glowFraction;
        const glow = this.gradients.get(theme.palette.id, () => [
            stop(0, TRANSPARENT),
            stop(1, theme.backgroundGlow)
        ]);
        p.fillGradient(0, top - band, width, band, glow, "y");
    }
}
