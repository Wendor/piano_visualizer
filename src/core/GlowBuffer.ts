import type { Viewport } from "./types";
import { context2d, createSurface } from "./surface";
import type { Ctx2D, Surface } from "./surface";

/**
 * Буфер свечения. Слои рисуют в него всё, что должно светиться;
 * BloomLayer один раз размывает и подмешивает результат в сцену.
 * Низкое разрешение даёт мягкость почти бесплатно.
 */
export class GlowBuffer {
    readonly canvas: Surface;
    readonly ctx: Ctx2D;
    /**
     * Номер обновления. Буфер наполняется не каждый кадр, и блум по этому
     * номеру понимает, что размывать заново нечего: содержимое то же самое.
     */
    private updates = 0;

    constructor(private scale = 0.25) {
        this.canvas = createSurface();
        this.ctx = context2d(this.canvas, "буфер свечения");
    }

    get version(): number {
        return this.updates;
    }

    /** Доля экрана, в которой живёт буфер. Меняется вместе с качеством. */
    get scaleFactor(): number {
        return this.scale;
    }

    setScale(scale: number): void {
        this.scale = scale;
    }

    resize(viewport: Viewport): void {
        this.canvas.width = Math.max(1, Math.round(viewport.width * this.scale));
        this.canvas.height = Math.max(1, Math.round(viewport.height * this.scale));
    }

    /** Очистка и перевод координат буфера в координаты сцены. */
    begin(viewport: Viewport): Ctx2D {
        const { ctx, canvas } = this;
        this.updates++;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        return ctx;
    }
}
