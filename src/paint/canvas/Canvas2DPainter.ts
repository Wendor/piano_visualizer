import { roundRectPath } from "../../core/math";
import { CLOUD_TILE } from "../cloud";
import type { Axis, Blend, Corners, Painter } from "../Painter";
import type { Gradient } from "../Gradient";
import type { Tint } from "../Tint";
import type { Ctx2D, Surface } from "../../core/surface";

/** Как движок наложения зовётся у холста. */
const MODES: Record<Blend, GlobalCompositeOperation> = {
    normal: "source-over",
    add: "lighter"
};

/**
 * Готовые градиенты одного описания. `createLinearGradient` печёт координаты
 * внутрь объекта, поэтому один и тот же градиент нужен свой на каждую длину —
 * но длин в сцене немного: высота клавиши, ширина ноты, полоса у кромки.
 */
type Baked = Map<number, CanvasGradient>;

/** Что художнику нужно от движка, чтобы положить свечение на сцену. */
export interface Bloom {
    apply(g: Ctx2D, width: number, height: number, strength: number, passes: number): void;
}

/**
 * Художник поверх холста 2D. Рисует ровно теми вызовами, какими сцена рисовала
 * всегда: скруглённый путь, градиент в местных координатах, `lighter` для
 * складывающегося света.
 *
 * Сдвиг в местные координаты делается не через `save`/`restore`, а прямой
 * заменой матрицы: стек контекста в кадре трогают тысячи раз, и он не бесплатен.
 */
export class Canvas2DPainter implements Painter {
    alpha = 1;
    blend: Blend = "normal";

    private ctx: Ctx2D = null as unknown as Ctx2D;
    /** Множители местных координат в пиксели холста. */
    private sx = 1;
    private sy = 1;
    /** Размер сцены в её собственных координатах: нужен свечению. */
    private width = 0;
    private height = 0;
    private readonly baked = new WeakMap<Gradient, Baked>();
    private readonly patterns = new WeakMap<Surface, CanvasPattern>();
    private readonly shift = typeof DOMMatrix === "function" ? new DOMMatrix() : null;
    private cloudTile: Surface | null = null;

    constructor(
        readonly target: "scene" | "glow",
        private readonly bloomer: Bloom | null = null
    ) {}

    /** Новый кадр: холст, множители и чистое состояние. */
    open(ctx: Ctx2D, sx: number, sy: number, width: number, height: number): void {
        this.ctx = ctx;
        this.sx = sx;
        this.sy = sy;
        this.width = width;
        this.height = height;
        this.base();
        this.reset();
    }

    useCloud(tile: Surface): void {
        this.cloudTile = tile;
        this.patterns.delete(tile);
    }

    reset(): void {
        this.alpha = 1;
        this.blend = "normal";
        this.ctx.globalAlpha = 1;
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.filter = "none";
    }

    // --- заливки -------------------------------------------------------------

    fill(x: number, y: number, w: number, h: number, tint: Tint): void {
        const g = this.ctx;
        this.apply();
        g.fillStyle = tint.css;
        g.fillRect(x, y, w, h);
    }

    fillGradient(x: number, y: number, w: number, h: number, gradient: Gradient, axis: Axis): void {
        const g = this.ctx;
        this.apply();
        g.fillStyle = this.bake(gradient, axis === "x" ? w : h, axis);
        this.local(x, y);
        g.fillRect(0, 0, w, h);
        this.base();
    }

    fillRound(x: number, y: number, w: number, h: number, radii: Corners, tint: Tint): void {
        const g = this.ctx;
        this.apply();
        g.fillStyle = tint.css;
        roundRectPath(g, x, y, w, h, radii as unknown as [number, number, number, number]);
        g.fill();
    }

    fillRoundGradient(
        x: number,
        y: number,
        w: number,
        h: number,
        radii: Corners,
        gradient: Gradient,
        axis: Axis
    ): void {
        const g = this.ctx;
        this.apply();
        g.fillStyle = this.bake(gradient, axis === "x" ? w : h, axis);
        this.local(x, y);
        roundRectPath(g, 0, 0, w, h, radii as unknown as [number, number, number, number]);
        g.fill();
        this.base();
    }

    fillRadial(
        x: number,
        y: number,
        w: number,
        h: number,
        cx: number,
        cy: number,
        radius: number,
        gradient: Gradient
    ): void {
        const g = this.ctx;
        this.apply();
        g.fillStyle = this.bakeRadial(gradient, radius);
        this.local(cx, cy);
        g.fillRect(x - cx, y - cy, w, h);
        this.base();
    }

    strokeRound(x: number, y: number, w: number, h: number, radii: Corners, width: number, tint: Tint): void {
        const g = this.ctx;
        this.apply();
        g.strokeStyle = tint.css;
        g.lineWidth = width;
        roundRectPath(g, x, y, w, h, radii as unknown as [number, number, number, number]);
        g.stroke();
    }

    lines(points: Float32Array, count: number, width: number, tint: Tint): void {
        if (count <= 0) return;
        const g = this.ctx;
        this.apply();
        g.strokeStyle = tint.css;
        g.lineWidth = width;
        g.lineCap = "round";
        g.beginPath();
        for (let i = 0; i < count; i++) {
            const at = i * 4;
            g.moveTo(points[at]!, points[at + 1]!);
            g.lineTo(points[at + 2]!, points[at + 3]!);
        }
        g.stroke();
    }

    cloud(
        x: number,
        y: number,
        w: number,
        h: number,
        radii: Corners,
        amount: number,
        phaseX: number,
        phaseY: number
    ): void {
        const pattern = this.pattern();
        if (!pattern) return;

        const g = this.ctx;
        if (this.shift) {
            // Матрица одна на сцену: сдвиг — это её последние два числа.
            this.shift.e = phaseX;
            this.shift.f = phaseY;
            pattern.setTransform(this.shift);
        }

        g.globalAlpha = this.alpha * amount;
        g.globalCompositeOperation = "lighter";
        g.fillStyle = pattern;
        this.local(x, y);
        roundRectPath(g, 0, 0, w, h, radii as unknown as [number, number, number, number]);
        g.fill();
        this.base();
        g.globalCompositeOperation = MODES[this.blend];
    }

    sprite(image: Surface, x: number, y: number, w: number, h: number): void {
        this.apply();
        this.ctx.drawImage(image, x, y, w, h);
    }

    invalidate(image: Surface): void {
        this.patterns.delete(image);
    }

    bloom(strength: number, passes: number): void {
        this.bloomer?.apply(this.ctx, this.width, this.height, strength, passes);
    }

    // --- внутреннее ----------------------------------------------------------

    /**
     * Общее состояние перед заливкой. Прозрачность самого цвета сидит в нём
     * самом — и в строке для холста, и в числах для видеочипа; здесь только
     * общий множитель, который слой поставил на всю фигуру.
     */
    private apply(): void {
        this.ctx.globalAlpha = this.alpha;
        this.ctx.globalCompositeOperation = MODES[this.blend];
    }

    /** Матрица сцены. */
    private base(): void {
        this.ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    }

    /** Матрица с началом в углу фигуры: тогда градиент зависит лишь от размера. */
    private local(x: number, y: number): void {
        this.ctx.setTransform(this.sx, 0, 0, this.sy, x * this.sx, y * this.sy);
    }

    private bake(gradient: Gradient, length: number, axis: Axis): CanvasGradient {
        // Ключ — длина в целых точках и ось: близкие длины делят один градиент,
        // а разница в полпикселя глазу недоступна.
        const size = Math.max(1, Math.round(length));
        const key = axis === "x" ? size : -size;
        let baked = this.baked.get(gradient);
        if (!baked) this.baked.set(gradient, (baked = new Map()));
        const found = baked.get(key);
        if (found) return found;

        const made =
            axis === "x"
                ? this.ctx.createLinearGradient(0, 0, size, 0)
                : this.ctx.createLinearGradient(0, 0, 0, size);
        for (const stop of gradient.stops) made.addColorStop(clampStop(stop.at), stop.tint.css);
        baked.set(key, made);
        return made;
    }

    private bakeRadial(gradient: Gradient, radius: number): CanvasGradient {
        const size = Math.max(1, Math.round(radius));
        // Ключи радиальных не должны сталкиваться с линейными: те держат ось
        // знаком, а радиус кладём в заведомо чужой диапазон.
        const key = size + 1e6;
        let baked = this.baked.get(gradient);
        if (!baked) this.baked.set(gradient, (baked = new Map()));
        const found = baked.get(key);
        if (found) return found;

        const made = this.ctx.createRadialGradient(0, 0, 0, 0, 0, size);
        for (const stop of gradient.stops) made.addColorStop(clampStop(stop.at), stop.tint.css);
        baked.set(key, made);
        return made;
    }

    private pattern(): CanvasPattern | null {
        const tile = this.cloudTile;
        if (!tile) return null;
        const found = this.patterns.get(tile);
        if (found) return found;
        const made = this.ctx.createPattern(tile, "repeat");
        if (!made) return null;
        this.patterns.set(tile, made);
        return made;
    }
}

/** Доли за пределами отрезка холст считает ошибкой и роняет весь кадр. */
const clampStop = (at: number): number => (at < 0 ? 0 : at > 1 ? 1 : at);

export { CLOUD_TILE };
