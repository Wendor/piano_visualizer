import { GlowBuffer } from "../../core/GlowBuffer";
import { context2d } from "../../core/surface";
import type { Ctx2D, Surface } from "../../core/surface";
import type { Viewport } from "../../core/types";
import { cloudTile } from "../cloud";
import { Canvas2DPainter } from "./Canvas2DPainter";
import { CanvasBloom } from "./CanvasBloom";
import type { Engine, Painter } from "../Painter";

/**
 * Движок на холсте 2D — тот, которым сцена жила всегда.
 *
 * Он есть везде, и он же — запасной путь: там, где видеочип недоступен или
 * отказал, картинка обязана появиться хоть как-нибудь.
 */
export class Canvas2DEngine implements Engine {
    readonly name = "холст 2D";
    /**
     * Свет размыт и инерционен: между 40 и 60 обновлениями в секунду глаз
     * разницы не видит, а работа — всё, что слои рисуют в буфер, — сокращается
     * на треть и больше. Здесь за неё платит процессор, и экономия настоящая.
     */
    readonly glowHz = 40;

    private readonly ctx: Ctx2D;
    private readonly glow = new GlowBuffer();
    private readonly bloomer = new CanvasBloom(this.glow);
    private readonly scenePainter: Canvas2DPainter;
    private readonly glowPainter = new Canvas2DPainter("glow");
    private readonly tile = cloudTile();

    constructor(private readonly canvas: Surface) {
        this.ctx = context2d(canvas, "сцена");
        this.scenePainter = new Canvas2DPainter("scene", this.bloomer);
        this.scenePainter.useCloud(this.tile);
        this.glowPainter.useCloud(this.tile);
    }

    setGlowScale(scale: number): void {
        this.glow.setScale(scale);
    }

    resize(viewport: Viewport): void {
        this.glow.resize(viewport);
    }

    begin(viewport: Viewport): Painter {
        this.scenePainter.open(this.ctx, viewport.dpr, viewport.dpr, viewport.width, viewport.height);
        return this.scenePainter;
    }

    beginGlow(viewport: Viewport): Painter | null {
        const ctx = this.glow.begin(viewport);
        const { canvas } = this.glow;
        this.glowPainter.open(
            ctx,
            canvas.width / viewport.width,
            canvas.height / viewport.height,
            viewport.width,
            viewport.height
        );
        return this.glowPainter;
    }

    endGlow(): void {}

    end(): void {}

    dispose(): void {
        void this.canvas;
    }
}
