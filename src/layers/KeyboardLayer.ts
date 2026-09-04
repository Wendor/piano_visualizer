import { BaseLayer, Stage } from "../core/types";
import type { Scene } from "../core/Scene";
import type { PianoKey } from "../core/layout";
import type { Theme } from "../theme/Theme";
import { roundRectPath } from "../core/math";
import { GradientBook, bucket, stop } from "../paint/Gradient";
import type { Gradient } from "../paint/Gradient";
import type { Corners, Painter } from "../paint/Painter";
import { tint } from "../paint/Tint";
import { context2d, createSurface } from "../core/surface";
import type { Ctx2D, Surface } from "../core/surface";

export interface KeyboardOptions {
    /** Скорость угасания подсветки после отпускания, 1/сек. */
    release: number;
    /** Световой налив у линии удара, px. */
    spillHeight: number;
}

/**
 * Рояль. Рисуется двумя кэшированными слоями: белые клавиши и чёрные.
 * Подсветка белой клавиши ложится между ними, поэтому цвет физически
 * не может попасть на соседние чёрные клавиши.
 */
export class KeyboardLayer extends BaseLayer {
    readonly id = "keyboard";
    readonly stage = Stage.Keyboard;
    readonly title = "Клавиатура";
    readonly toggleable = false;
    readonly options: KeyboardOptions;

    private readonly whiteCache = createSurface();
    private readonly blackCache = createSurface();
    private readonly whiteCtx: Ctx2D;
    private readonly blackCtx: Ctx2D;
    private readonly press = new Map<number, number>();
    private readonly gradients = new GradientBook(256);
    /** Скругления клавиши: кортеж один на сцену, а не на клавишу в кадре. */
    private readonly corners: [number, number, number, number] = [0, 0, 0, 0];
    /** Кэш клавиш перерисован: движку пора забыть то, что он о нём помнил. */
    private stale = true;
    private dpr = 1;

    constructor(options: Partial<KeyboardOptions> = {}) {
        super();
        this.options = { release: 6, spillHeight: 22, ...options };
        this.whiteCtx = this.context(this.whiteCache);
        this.blackCtx = this.context(this.blackCache);
    }

    private context(canvas: Surface): Ctx2D {
        return context2d(canvas, "клавиатура");
    }

    override init(scene: Scene): void {
        scene.events.on("theme", () => {
            this.gradients.clear();
            this.render(scene);
        });
    }

    override resize(scene: Scene): void {
        this.gradients.clear();
        this.render(scene);
    }

    override update(scene: Scene, dt: number): void {
        for (const key of scene.layout.keys) {
            if (scene.active.has(key.midi)) {
                this.press.set(key.midi, 1);
                continue;
            }
            const value = this.press.get(key.midi);
            if (value === undefined) continue;
            const next = value - dt * this.options.release;
            if (next <= 0) this.press.delete(key.midi);
            else this.press.set(key.midi, next);
        }
    }

    override draw(p: Painter, scene: Scene): void {
        const { layout, viewport } = scene;
        // Клавиши нарисованы раз и живут картинкой; видеочип держит её у себя
        // и должен узнать, что она сменилась.
        if (this.stale) {
            p.invalidate(this.whiteCache);
            p.invalidate(this.blackCache);
            this.stale = false;
        }
        p.sprite(this.whiteCache, 0, layout.top, viewport.width, layout.height);
        this.drawPressed(p, scene, false);
        this.drawSpill(p, scene, false);
        p.sprite(this.blackCache, 0, layout.top, viewport.width, layout.height);
        this.drawPressed(p, scene, true);
        this.drawSpill(p, scene, true);
    }

    /** Скруглены только передние (нижние) углы — как у настоящей клавиши. */
    private radii(key: PianoKey): Corners {
        const r = key.accidental ? Math.min(3, key.width * 0.16) : Math.min(4, key.width * 0.13);
        const out = this.corners;
        out[0] = 0;
        out[1] = 0;
        out[2] = r;
        out[3] = r;
        return out;
    }

    // --- статичный рисунок клавиш -------------------------------------------

    /** Контур клавиши: скруглены только передние (нижние) углы. */
    private keyPath(g: Ctx2D, key: PianoKey, x: number, y: number): void {
        const r = key.accidental ? Math.min(3, key.width * 0.16) : Math.min(4, key.width * 0.13);
        roundRectPath(g, x, y, key.width, key.height, [0, 0, r, r]);
    }

    private render(scene: Scene): void {
        const { layout, viewport } = scene;
        if (layout.width <= 0 || layout.height <= 0) return;
        this.dpr = viewport.dpr;

        for (const [canvas, ctx] of [
            [this.whiteCache, this.whiteCtx],
            [this.blackCache, this.blackCtx]
        ] as const) {
            canvas.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
            canvas.height = Math.max(1, Math.round(layout.height * viewport.dpr));
            ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
            ctx.clearRect(0, 0, viewport.width, layout.height);
        }

        this.renderWhiteKeys(scene);
        this.renderBlackKeys(scene);
        this.stale = true;
    }

    private renderWhiteKeys(scene: Scene): void {
        const g = this.whiteCtx;
        const { layout } = scene;
        const hair = Math.max(0.5, 1 / this.dpr);

        for (const key of layout.keys) {
            if (key.accidental) continue;

            const body = g.createLinearGradient(0, 0, 0, layout.height);
            body.addColorStop(0.0, "#dfe3e9");
            body.addColorStop(0.04, "#f2f4f7");
            body.addColorStop(0.45, "#fdfdfe");
            body.addColorStop(0.93, "#ffffff");
            body.addColorStop(1.0, "#ccd2da");

            g.save();
            this.keyPath(g, key, key.x, 0);
            g.clip();
            g.fillStyle = body;
            g.fillRect(key.x, 0, key.width, layout.height);

            // Узкая тень от корпуса у самой кромки — без размытого пятна на пол-клавиши.
            const capShadow = g.createLinearGradient(0, 0, 0, 9);
            capShadow.addColorStop(0, "rgba(12, 16, 24, 0.5)");
            capShadow.addColorStop(1, "rgba(12, 16, 24, 0)");
            g.fillStyle = capShadow;
            g.fillRect(key.x, 0, key.width, 9);

            // Передний торец.
            const lip = g.createLinearGradient(0, layout.height - 7, 0, layout.height);
            lip.addColorStop(0, "rgba(255, 255, 255, 0)");
            lip.addColorStop(0.5, "rgba(140, 150, 165, 0.28)");
            lip.addColorStop(1, "rgba(90, 100, 115, 0.5)");
            g.fillStyle = lip;
            g.fillRect(key.x, layout.height - 7, key.width, 7);
            g.restore();

            // Разделитель.
            g.fillStyle = "rgba(24, 30, 40, 0.28)";
            g.fillRect(key.x, 0, hair, layout.height - 2);
            g.fillStyle = "rgba(255, 255, 255, 0.5)";
            g.fillRect(key.x + hair, 0, hair, layout.height - 4);
        }
    }

    private renderBlackKeys(scene: Scene): void {
        const g = this.blackCtx;
        const { layout } = scene;

        for (const key of layout.keys) {
            if (!key.accidental) continue;

            // Короткая мягкая тень со смещением вниз-вправо — как от реальной клавиши.
            g.save();
            g.shadowColor = "rgba(0, 0, 0, 0.5)";
            g.shadowBlur = 5;
            g.shadowOffsetX = 1;
            g.shadowOffsetY = 2;
            g.fillStyle = "#000";
            this.keyPath(g, key, key.x, 0);
            g.fill();
            g.restore();

            // Тело матово-чёрное с продольным градиентом; блик даёт передний торец.
            const body = g.createLinearGradient(0, 0, 0, key.height);
            body.addColorStop(0.0, "#15181d");
            body.addColorStop(0.55, "#0a0c0f");
            body.addColorStop(0.86, "#1b1f25");
            body.addColorStop(1.0, "#040507");

            g.save();
            this.keyPath(g, key, key.x, 0);
            g.clip();
            g.fillStyle = body;
            g.fillRect(key.x, 0, key.width, key.height);

            // Фаски по бокам делают край чётким, а не размытым.
            const bevel = Math.max(1, key.width * 0.09);
            g.fillStyle = "rgba(255, 255, 255, 0.10)";
            g.fillRect(key.x, 0, bevel, key.height);
            g.fillStyle = "rgba(0, 0, 0, 0.75)";
            g.fillRect(key.x + key.width - bevel, 0, bevel, key.height);

            const face = g.createLinearGradient(0, key.height * 0.86, 0, key.height);
            face.addColorStop(0, "rgba(0, 0, 0, 0.55)");
            face.addColorStop(0.5, "rgba(104, 112, 126, 0.45)");
            face.addColorStop(1, "rgba(24, 28, 36, 0.92)");
            g.fillStyle = face;
            g.fillRect(key.x, key.height * 0.86, key.width, key.height * 0.14);
            g.restore();
        }

        // Планка корпуса над клавишами.
        const cap = g.createLinearGradient(0, 0, 0, 5);
        cap.addColorStop(0, "rgba(0, 0, 0, 0.95)");
        cap.addColorStop(1, "rgba(0, 0, 0, 0.15)");
        g.fillStyle = cap;
        g.fillRect(0, 0, layout.width, 5);
    }

    // --- подсветка нажатых ---------------------------------------------------

    /**
     * Свет нажатой клавиши. Яркость уходит в общую прозрачность, поэтому
     * градиенты зависят только от цвета — и живут в книге, а не собираются
     * заново для каждой клавиши каждый кадр.
     */
    private drawPressed(p: Painter, scene: Scene, accidental: boolean): void {
        const { layout, theme } = scene;
        const top = layout.top;
        const hair = Math.max(1, 1 / this.dpr);

        for (const key of layout.keys) {
            if (key.accidental !== accidental) continue;
            const state = scene.active.get(key.midi);
            const lit = state ? 1 : (this.press.get(key.midi) ?? 0);
            if (lit <= 0.01) continue;

            const hue = theme.hueFor(key.midi, layout);
            const velocity = state ? Math.min(1, state.velocity / 110) : 0.7;
            const alpha = lit * (0.55 + velocity * 0.45);
            const edgeHeight = Math.min(26, key.height * 0.3);
            const radii = this.radii(key);
            const foot = Math.min(8, key.height);

            p.alpha = alpha;
            p.fillRoundGradient(
                key.x,
                top,
                key.width,
                key.height,
                radii,
                this.pressGradient(theme, hue, accidental),
                "y"
            );
            // Верхняя кромка прямая: скругление живёт только у переднего края.
            p.fillGradient(key.x, top, key.width, edgeHeight, this.hotGradient(theme, hue), "y");

            p.alpha = 1;
            p.fillRoundGradient(
                key.x,
                top + key.height - foot,
                key.width,
                foot,
                radii,
                this.footGradient(),
                "y"
            );

            // Грани, чтобы соседние нажатые клавиши не сливались в пятно.
            p.fill(key.x, top, hair, key.height, EDGE_DARK);
            p.alpha = alpha;
            p.fill(key.x + key.width - hair, top, hair, key.height, theme.tint(hue, 82, 0.35));
            p.alpha = 1;
        }
    }

    private pressGradient(theme: Theme, hue: number, accidental: boolean): Gradient {
        const id = `body|${theme.palette.id}|${bucket(hue, 2)}|${accidental ? 1 : 0}`;
        return this.gradients.get(id, () =>
            accidental
                ? [
                      stop(0, theme.tint(hue, 62, 0.98)),
                      stop(0.55, theme.tint(hue, 44, 0.92)),
                      stop(1, theme.tint(hue, 26, 0.85))
                  ]
                : [
                      stop(0, theme.tint(hue, 66, 0.96)),
                      stop(0.4, theme.tint(hue, 55, 0.88)),
                      stop(1, theme.tint(hue, 44, 0.72))
                  ]
        );
    }

    private hotGradient(theme: Theme, hue: number): Gradient {
        const id = `hot|${theme.palette.id}|${bucket(hue, 2)}`;
        return this.gradients.get(id, () => [
            stop(0, theme.tint(hue, 88, 0.75, 100)),
            stop(1, theme.tint(hue, 60, 0, 100))
        ]);
    }

    private footGradient(): Gradient {
        return this.gradients.get("foot", () => [
            stop(0, tint("rgba(0, 0, 0, 0)")),
            stop(1, tint("rgba(0, 0, 0, 0.45)"))
        ]);
    }

    /** Свет ложится на верх клавиши: там прямая кромка, скругление внизу. */
    private drawSpill(p: Painter, scene: Scene, accidental: boolean): void {
        const { layout, theme } = scene;
        for (const key of layout.keys) {
            if (key.accidental !== accidental) continue;
            const state = scene.active.get(key.midi);
            const lit = state ? 1 : (this.press.get(key.midi) ?? 0);
            if (lit <= 0.02) continue;

            const hue = theme.hueFor(key.midi, layout);
            const height = Math.round(Math.min(key.height, this.options.spillHeight));
            const light = this.gradients.get(`spill|${theme.palette.id}|${bucket(hue, 2)}`, () => [
                stop(0, theme.tint(hue, 70, 0.5)),
                stop(1, theme.tint(hue, 60, 0))
            ]);

            p.blend = "add";
            p.alpha = lit;
            p.fillGradient(key.x, layout.top, key.width, height, light, "y");
        }
        p.blend = "normal";
        p.alpha = 1;
    }
}

/** Тёмная грань слева от нажатой клавиши: цвет один на всю сцену. */
const EDGE_DARK = tint("rgba(6, 8, 16, 0.42)");
