import { BaseLayer, Stage } from "../../core/types";
import type { Scene, NoteEvent } from "../../core/Scene";
import { roundRectPath } from "../../core/math";

export interface RisingNotesOptions {
    /** Скорость подъёма, px/сек. */
    speed: number;
    /** Доля ширины клавиши, съедаемая зазором с каждой стороны. */
    gap: number;
    /** Натуральные ноты рисуются контуром, диезы — заливкой. */
    hollowNaturals: boolean;
    /** Скругление в долях ширины ноты — общее для узких и широких. */
    roundness: number;
}

interface Bar {
    readonly note: NoteEvent;
    readonly x: number;
    readonly width: number;
    readonly top: number;
    readonly height: number;
    readonly hue: number;
    readonly velocity: number;
    readonly held: boolean;
}

/**
 * Основная визуализация: нота растёт вверх от клавиши, пока её держат,
 * и после отпускания уплывает целиком. Геометрия каждый кадр считается
 * из времени события, поэтому resize и смена диапазона ничего не ломают.
 */
export class RisingNotesLayer extends BaseLayer {
    readonly id = "notes.rising";
    readonly stage = Stage.Notes;
    readonly options: RisingNotesOptions;

    private bars: Bar[] = [];

    constructor(options: Partial<RisingNotesOptions> = {}) {
        super();
        this.options = { speed: 240, gap: 0.1, hollowNaturals: true, roundness: 0.4, ...options };
    }

    override init(scene: Scene): void {
        this.requestRetention(scene);
    }

    override resize(scene: Scene): void {
        this.requestRetention(scene);
    }

    private requestRetention(scene: Scene): void {
        const flight = (scene.layout.top + 120) / this.options.speed;
        scene.requestRetention(this.id, flight + 1);
    }

    override update(scene: Scene, _dt: number): void {
        const { layout, theme, time } = scene;
        const { speed, gap } = this.options;
        const bars: Bar[] = [];

        for (const note of scene.notes) {
            const key = layout.get(note.midi);
            if (!key) continue;

            const inset = Math.max(1, key.width * gap);
            const bottom = note.end === null ? layout.top : layout.top - (time - note.end) * speed;
            if (bottom < -40) continue;

            const top = layout.top - (time - note.start) * speed;
            const height = bottom - top;
            if (height <= 0.5) continue;

            bars.push({
                note,
                x: key.x + inset,
                width: Math.max(2, key.width - inset * 2),
                top,
                height,
                hue: theme.hueFor(note.midi, layout),
                velocity: Math.min(1, note.velocity / 110),
                held: note.end === null
            });
        }

        this.bars = bars;
    }

    override drawGlow(g: CanvasRenderingContext2D, scene: Scene): void {
        for (const bar of this.bars) {
            const alpha = 0.5 + bar.velocity * 0.28;
            const radii = this.radii(bar);
            g.globalAlpha = alpha;

            if (this.isHollow(bar)) {
                // Пустая нота светится кантом, а не всей площадью.
                g.strokeStyle = scene.theme.color(bar.hue, 56);
                g.lineWidth = Math.max(2, bar.width * 0.24);
                roundRectPath(g, bar.x, bar.top, bar.width, bar.height, radii);
                g.stroke();
            } else {
                g.fillStyle = scene.theme.color(bar.hue, 54);
                roundRectPath(g, bar.x, bar.top, bar.width, bar.height, radii);
                g.fill();
            }
        }
        g.globalAlpha = 1;
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        for (const bar of this.bars) this.drawBar(g, scene, bar, !this.isHollow(bar));
        g.globalAlpha = 1;
    }

    private isHollow(bar: Bar): boolean {
        return this.options.hollowNaturals && !bar.note.accidental;
    }

    /**
     * Скругление задаётся долей ширины, поэтому узкий диез и широкая
     * натуральная нота выглядят одной формой, а не «квадратом и капсулой».
     */
    private radii(bar: Bar): [number, number, number, number] {
        const r = Math.min(bar.width * this.options.roundness, bar.height / 2);
        return bar.held ? [r, r, 0, 0] : [r, r, r, r];
    }

    private strokeWidth(bar: Bar): number {
        return Math.max(1.4, Math.min(3.6, bar.width * 0.16));
    }

    /**
     * Одна форма для всех нот: кант + сердцевина. Разница только в плотности
     * заливки — диез залит, натуральная нота остаётся пустой.
     */
    private drawBar(g: CanvasRenderingContext2D, scene: Scene, bar: Bar, filled: boolean): void {
        const { theme } = scene;
        const alpha = 0.85 + bar.velocity * 0.15;
        const radii = this.radii(bar);
        const stroke = this.strokeWidth(bar);

        const edgeLightness = filled ? 44 + bar.velocity * 8 : 42;
        const coreLightness = filled ? 58 + bar.velocity * 8 : 50;
        const edgeAlpha = filled ? 0.9 * alpha : 0.2 * alpha;
        const coreAlpha = filled ? alpha : 0.32 * alpha;

        const body = g.createLinearGradient(bar.x, bar.top, bar.x + bar.width, bar.top);
        body.addColorStop(0, theme.color(bar.hue, edgeLightness, edgeAlpha));
        body.addColorStop(0.5, theme.color(bar.hue, coreLightness, coreAlpha));
        body.addColorStop(1, theme.color(bar.hue, edgeLightness, edgeAlpha));
        g.fillStyle = body;
        roundRectPath(g, bar.x, bar.top, bar.width, bar.height, radii);
        g.fill();

        const inset = stroke / 2;
        const innerRadii = radii.map((r) => Math.max(0, r - inset)) as [number, number, number, number];
        const innerX = bar.x + inset;
        const innerY = bar.top + inset;
        const innerW = Math.max(0, bar.width - stroke);
        const innerH = Math.max(0, bar.height - stroke);

        g.strokeStyle = theme.color(bar.hue, filled ? 72 : 66, alpha);
        g.lineWidth = stroke;
        roundRectPath(g, innerX, innerY, innerW, innerH, innerRadii);
        g.stroke();

        // Тонкий блик по канту — нота читается как стекло.
        g.globalAlpha = alpha * (filled ? 0.45 : 0.55);
        g.strokeStyle = theme.color(bar.hue, 86, 1);
        g.lineWidth = Math.max(0.6, stroke * 0.3);
        roundRectPath(g, innerX, innerY, innerW, innerH, innerRadii);
        g.stroke();
        g.globalAlpha = 1;
    }

}
