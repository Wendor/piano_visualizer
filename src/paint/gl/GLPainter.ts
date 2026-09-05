import { MODE } from "./glsl";
import type { GradientAtlas, ImageBook } from "./textures";
import type { Axis, Blend, Corners, Painter } from "../Painter";
import type { Gradient } from "../Gradient";
import type { Tint } from "../Tint";
import type { Surface } from "../../core/surface";

/** Сколько чисел занимает одна фигура. */
const STRIDE = 24;
/** Сколько фигур копится до отправки. Кадр сцены — около тысячи. */
const CAPACITY = 4096;

/** Что должен уметь движок, чтобы художник мог отправить накопленное. */
export interface Sink {
    readonly gl: WebGL2RenderingContext;
    readonly atlas: GradientAtlas;
    readonly images: ImageBook;
    /** Отправить накопленные фигуры на видеочип. */
    draw(data: Float32Array, count: number, sprite: WebGLTexture | null): void;
    /** Положить свечение на сцену. */
    bloom(strength: number, passes: number): void;
}

/**
 * Художник поверх видеочипа.
 *
 * Фигуры не рисуются по одной: они складываются в один длинный список чисел и
 * уезжают пачкой. Кадр сцены — это несколько таких пачек вместо тысячи заливок
 * по холсту.
 *
 * Складывающийся свет не требует смены режима наложения, а значит и разрыва
 * пачки. Цвет здесь premultiplied, и обычное наложение считает `src + dst *
 * (1 - src.a)`: если у фигуры обнулить прозрачность, останется ровно `src +
 * dst` — то самое сложение. Поэтому вся сцена, и светящаяся, и обычная, едет
 * одним режимом.
 */
export class GLPainter implements Painter {
    alpha = 1;

    private readonly data = new Float32Array(CAPACITY * STRIDE);
    private count = 0;
    private mode: Blend = "normal";
    private sprite_: WebGLTexture | null = null;
    private cloudTile: Surface | null = null;

    constructor(
        readonly target: "scene" | "glow",
        private readonly sink: Sink
    ) {}

    get blend(): Blend {
        return this.mode;
    }

    set blend(value: Blend) {
        this.mode = value;
    }

    useCloud(tile: Surface): void {
        this.cloudTile = tile;
    }

    /** Новый кадр: копилка пуста, состояние обычное. */
    open(): void {
        this.count = 0;
        this.mode = "normal";
        this.alpha = 1;
        this.sprite_ = null;
    }

    reset(): void {
        this.blend = "normal";
        this.alpha = 1;
    }

    /** Отправить накопленное. Зовётся движком в конце кадра и при смене режима. */
    flush(): void {
        if (this.count === 0) return;
        this.sink.draw(this.data, this.count, this.sprite_);
        this.count = 0;
    }

    // --- заливки -------------------------------------------------------------

    fill(x: number, y: number, w: number, h: number, tint: Tint): void {
        const at = this.open4(x, y, w, h, 0, 0, 0, 0);
        this.tint(at, tint);
        this.params(at, MODE.flat, 0, 0, 0);
    }

    fillGradient(x: number, y: number, w: number, h: number, gradient: Gradient, axis: Axis): void {
        const at = this.open4(x, y, w, h, 0, 0, 0, 0);
        this.level(at);
        this.params(at, axis === "x" ? MODE.gradientX : MODE.gradientY, this.sink.atlas.row(gradient), 0, 0);
    }

    fillRound(x: number, y: number, w: number, h: number, radii: Corners, tint: Tint): void {
        const at = this.open4(x, y, w, h, radii[0], radii[1], radii[2], radii[3]);
        this.tint(at, tint);
        this.params(at, MODE.flat, 0, 0, 0);
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
        const at = this.open4(x, y, w, h, radii[0], radii[1], radii[2], radii[3]);
        this.level(at);
        this.params(at, axis === "x" ? MODE.gradientX : MODE.gradientY, this.sink.atlas.row(gradient), 0, 0);
    }

    fillRoundBand(
        x: number,
        y: number,
        w: number,
        h: number,
        radii: Corners,
        edge: Tint,
        core: Tint,
        axis: Axis
    ): void {
        const at = this.open4(x, y, w, h, radii[0], radii[1], radii[2], radii[3]);
        this.tint(at, edge);
        this.params(at, MODE.band, axis === "y" ? 1 : 0, 0, 0);
        const f = this.data;
        const a = core.a * this.alpha;
        f[at + 20] = core.r * a;
        f[at + 21] = core.g * a;
        f[at + 22] = core.b * a;
        f[at + 23] = a;
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
        const at = this.open4(x, y, w, h, 0, 0, 0, 0);
        this.level(at);
        this.params(at, MODE.radial, this.sink.atlas.row(gradient), 0, 0);
        this.extra(at, cx, cy, radius);
    }

    strokeRound(x: number, y: number, w: number, h: number, radii: Corners, width: number, tint: Tint): void {
        const at = this.open4(x, y, w, h, radii[0], radii[1], radii[2], radii[3]);
        this.tint(at, tint);
        this.params(at, MODE.stroke, 0, width, 0);
    }

    lines(points: Float32Array, count: number, width: number, tint: Tint): void {
        const half = width / 2;
        for (let i = 0; i < count; i++) {
            const p = i * 4;
            const x0 = points[p]!;
            const y0 = points[p + 1]!;
            const dx = points[p + 2]! - x0;
            const dy = points[p + 3]! - y0;
            const length = Math.hypot(dx, dy);
            // Отрезок — та же фигура: капсула длиной в отрезок, повёрнутая
            // вдоль него. Круглые концы даёт скругление в половину толщины.
            const at = this.open4(
                x0 + dx / 2 - (length + width) / 2,
                y0 + dy / 2 - half,
                length + width,
                width,
                half,
                half,
                half,
                half
            );
            this.tint(at, tint);
            this.params(at, MODE.flat, 0, 0, length > 0.0001 ? Math.atan2(dy, dx) : 0);
        }
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
        const tile = this.cloudTile;
        if (!tile) return;
        const at = this.open4(x, y, w, h, radii[0], radii[1], radii[2], radii[3]);
        this.level(at, amount);
        this.params(at, MODE.cloud, 0, 0, 0);
        this.extra(at, phaseX, phaseY, 0);
        // Узор всегда складывается: он про свет внутри ноты, а не про краску.
        this.data[at + 19] = 1;
    }

    sprite(image: Surface, x: number, y: number, w: number, h: number): void {
        const texture = this.sink.images.get(image);
        if (!texture) return;
        // Картинка — единственное, что не выразить в пачке: у неё своя память
        // на видеочипе, и сменить её можно только между вызовами рисования.
        if (texture !== this.sprite_) {
            this.flush();
            this.sprite_ = texture;
        }
        const at = this.open4(x, y, w, h, 0, 0, 0, 0);
        this.level(at);
        this.params(at, MODE.sprite, 0, 0, 0);
    }

    invalidate(image: Surface): void {
        this.sink.images.refresh(image);
    }

    bloom(strength: number, passes: number): void {
        this.flush();
        this.sink.bloom(strength, passes);
    }

    // --- запись фигуры -------------------------------------------------------

    /** Место под новую фигуру: прямоугольник и скругления. */
    private open4(
        x: number,
        y: number,
        w: number,
        h: number,
        tl: number,
        tr: number,
        br: number,
        bl: number
    ): number {
        if (this.count >= CAPACITY) this.flush();
        const at = this.count * STRIDE;
        const f = this.data;
        f[at] = x;
        f[at + 1] = y;
        f[at + 2] = w;
        f[at + 3] = h;
        f[at + 4] = tl;
        f[at + 5] = tr;
        f[at + 6] = br;
        f[at + 7] = bl;
        f[at + 16] = 0;
        f[at + 17] = 0;
        f[at + 18] = 0;
        f[at + 19] = this.mode === "add" ? 1 : 0;
        f[at + 20] = 0;
        f[at + 21] = 0;
        f[at + 22] = 0;
        f[at + 23] = 0;
        this.count++;
        return at;
    }

    /** Цвет фигуры, уже умноженный на прозрачность — так его и ждёт наложение. */
    private tint(at: number, tint: Tint): void {
        const f = this.data;
        const a = tint.a * this.alpha;
        f[at + 8] = tint.r * a;
        f[at + 9] = tint.g * a;
        f[at + 10] = tint.b * a;
        f[at + 11] = a;
    }

    /** Для градиента и картинки цвет не нужен — только общая прозрачность. */
    private level(at: number, extra = 1): void {
        const f = this.data;
        f[at + 8] = 0;
        f[at + 9] = 0;
        f[at + 10] = 0;
        f[at + 11] = this.alpha * extra;
    }

    private params(at: number, mode: number, row: number, width: number, angle: number): void {
        const f = this.data;
        f[at + 12] = mode;
        f[at + 13] = row;
        f[at + 14] = width;
        f[at + 15] = angle;
    }

    private extra(at: number, x: number, y: number, z: number): void {
        const f = this.data;
        f[at + 16] = x;
        f[at + 17] = y;
        f[at + 18] = z;
    }
}

export { STRIDE };
