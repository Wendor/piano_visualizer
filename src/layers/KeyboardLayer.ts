import { BaseLayer, Stage } from "../core/types";
import type { Scene } from "../core/Scene";
import type { PianoKey } from "../core/layout";
import type { Theme } from "../theme/Theme";
import { roundRectPath } from "../core/math";
import { GradientCache, bucket } from "../core/gradients";

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

    private readonly whiteCache = document.createElement("canvas");
    private readonly blackCache = document.createElement("canvas");
    private readonly whiteCtx: CanvasRenderingContext2D;
    private readonly blackCtx: CanvasRenderingContext2D;
    private readonly press = new Map<number, number>();
    private readonly gradients = new GradientCache(256);
    private dpr = 1;

    constructor(options: Partial<KeyboardOptions> = {}) {
        super();
        this.options = { release: 6, spillHeight: 22, ...options };
        this.whiteCtx = this.context(this.whiteCache);
        this.blackCtx = this.context(this.blackCache);
    }

    private context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2D-контекст клавиатуры недоступен");
        return ctx;
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

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const { layout, viewport } = scene;
        g.drawImage(this.whiteCache, 0, layout.top, viewport.width, layout.height);
        this.drawPressed(g, scene, false);
        this.drawSpill(g, scene, false);
        g.drawImage(this.blackCache, 0, layout.top, viewport.width, layout.height);
        this.drawPressed(g, scene, true);
        this.drawSpill(g, scene, true);
    }

    // --- статичный рисунок клавиш -------------------------------------------

    /** Контур клавиши: скруглены только передние (нижние) углы. */
    private keyPath(g: CanvasRenderingContext2D, key: PianoKey, x: number, y: number): void {
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
     * Свет нажатой клавиши. Яркость уходит в `globalAlpha`, поэтому градиенты
     * зависят только от цвета и высоты клавиши — и живут в кэше, а не строятся
     * заново для каждой клавиши каждый кадр.
     */
    private drawPressed(g: CanvasRenderingContext2D, scene: Scene, accidental: boolean): void {
        const { layout, theme } = scene;
        const top = layout.top;
        const hair = Math.max(1, 1 / this.dpr);

        for (const key of layout.keys) {
            if (key.accidental !== accidental) continue;
            const state = scene.active.get(key.midi);
            const lit = state ? 1 : this.press.get(key.midi) ?? 0;
            if (lit <= 0.01) continue;

            const hue = theme.hueFor(key.midi, layout);
            const velocity = state ? Math.min(1, state.velocity / 110) : 0.7;
            const alpha = lit * (0.55 + velocity * 0.45);
            const edgeHeight = Math.min(26, key.height * 0.3);

            g.save();
            g.translate(key.x, top);
            this.keyPath(g, key, 0, 0);
            g.clip();

            g.globalAlpha = alpha;
            g.fillStyle = this.pressGradient(g, theme, key, hue, accidental);
            g.fillRect(0, 0, key.width, key.height);

            g.fillStyle = this.hotGradient(g, theme, hue, edgeHeight);
            g.fillRect(0, 0, key.width, edgeHeight);
            g.globalAlpha = 1;

            g.fillStyle = this.footGradient(g, key);
            g.fillRect(0, key.height - 8, key.width, 8);

            // Грани, чтобы соседние нажатые клавиши не сливались в пятно.
            g.fillStyle = "rgba(6, 8, 16, 0.42)";
            g.fillRect(0, 0, hair, key.height);
            g.globalAlpha = alpha;
            g.fillStyle = theme.color(hue, 82, 0.35);
            g.fillRect(key.width - hair, 0, hair, key.height);
            g.globalAlpha = 1;
            g.restore();
        }
    }

    private pressGradient(
        g: CanvasRenderingContext2D,
        theme: Theme,
        key: PianoKey,
        hue: number,
        accidental: boolean
    ): CanvasGradient {
        const h = Math.round(key.height);
        const id = `body|${theme.palette.id}|${bucket(hue, 2)}|${accidental ? 1 : 0}|${h}`;
        return this.gradients.get(id, () => {
            const body = g.createLinearGradient(0, 0, 0, h);
            if (accidental) {
                body.addColorStop(0.0, theme.color(hue, 62, 0.98));
                body.addColorStop(0.55, theme.color(hue, 44, 0.92));
                body.addColorStop(1.0, theme.color(hue, 26, 0.85));
            } else {
                body.addColorStop(0.0, theme.color(hue, 66, 0.96));
                body.addColorStop(0.4, theme.color(hue, 55, 0.88));
                body.addColorStop(1.0, theme.color(hue, 44, 0.72));
            }
            return body;
        });
    }

    private hotGradient(
        g: CanvasRenderingContext2D,
        theme: Theme,
        hue: number,
        edgeHeight: number
    ): CanvasGradient {
        const h = Math.round(edgeHeight);
        const id = `hot|${theme.palette.id}|${bucket(hue, 2)}|${h}`;
        return this.gradients.get(id, () => {
            const hot = g.createLinearGradient(0, 0, 0, h);
            hot.addColorStop(0, theme.color(hue, 88, 0.75, 100));
            hot.addColorStop(1, theme.color(hue, 60, 0, 100));
            return hot;
        });
    }

    private footGradient(g: CanvasRenderingContext2D, key: PianoKey): CanvasGradient {
        const h = Math.round(key.height);
        return this.gradients.get(`foot|${h}`, () => {
            const foot = g.createLinearGradient(0, h - 8, 0, h);
            foot.addColorStop(0, "rgba(0, 0, 0, 0)");
            foot.addColorStop(1, "rgba(0, 0, 0, 0.45)");
            return foot;
        });
    }

    /** Свет ложится на верх клавиши, не выходя за её контур. */
    private drawSpill(g: CanvasRenderingContext2D, scene: Scene, accidental: boolean): void {
        const { layout, theme } = scene;
        for (const key of layout.keys) {
            if (key.accidental !== accidental) continue;
            const state = scene.active.get(key.midi);
            const lit = state ? 1 : this.press.get(key.midi) ?? 0;
            if (lit <= 0.02) continue;

            const hue = theme.hueFor(key.midi, layout);
            const height = Math.round(Math.min(key.height, this.options.spillHeight));

            g.save();
            g.globalCompositeOperation = "lighter";
            g.translate(key.x, layout.top);
            this.keyPath(g, key, 0, 0);
            g.clip();
            g.globalAlpha = lit;
            g.fillStyle = this.gradients.get(
                `spill|${theme.palette.id}|${bucket(hue, 2)}|${height}`,
                () => {
                    const gradient = g.createLinearGradient(0, 0, 0, height);
                    gradient.addColorStop(0, theme.color(hue, 70, 0.5));
                    gradient.addColorStop(1, theme.color(hue, 60, 0));
                    return gradient;
                }
            );
            g.fillRect(0, 0, key.width, height);
            g.restore();
        }
    }
}
