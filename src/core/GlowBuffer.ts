import type { Viewport } from "./types";

/**
 * Буфер свечения. Слои рисуют в него всё, что должно светиться;
 * BloomLayer один раз размывает и подмешивает результат в сцену.
 * Низкое разрешение даёт мягкость почти бесплатно.
 */
export class GlowBuffer {
    readonly canvas: HTMLCanvasElement;
    readonly ctx: CanvasRenderingContext2D;

    constructor(private scale = 0.25) {
        this.canvas = document.createElement("canvas");
        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("Не удалось создать контекст буфера свечения");
        this.ctx = ctx;
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
    begin(viewport: Viewport): CanvasRenderingContext2D {
        const { ctx, canvas } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        return ctx;
    }
}
