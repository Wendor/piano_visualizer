import { roundRectPath } from "../../core/math";
import type { Theme } from "../../theme/Theme";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";

export interface NoteStyleOptions {
    /** Скорость полёта ноты, px/сек. */
    speed: number;
    /** Доля ширины клавиши, съедаемая зазором с каждой стороны. */
    gap: number;
    /** Натуральные ноты рисуются контуром, диезы — заливкой. */
    hollowNaturals: boolean;
    /** Скругление в долях ширины ноты — общее для узких и широких. */
    roundness: number;
}

/** Прямоугольник ноты на экране; общий для растущих и падающих нот. */
export interface NoteBar {
    readonly x: number;
    readonly width: number;
    readonly top: number;
    readonly height: number;
    readonly hue: number;
    /** 0…1 — нормированная громкость. */
    readonly velocity: number;
    readonly hollow: boolean;
    /** Нижний край обрезан клавиатурой: нота ещё звучит. */
    readonly openBottom: boolean;
}

/**
 * Внешний вид нот — общее состояние сцены, а не свойство одного слоя:
 * растущие и падающие ноты обязаны выглядеть одинаково.
 */
export class NoteStyle {
    readonly options: NoteStyleOptions;

    constructor(options: Partial<NoteStyleOptions> = {}) {
        this.options = { speed: 240, gap: 0.1, hollowNaturals: true, roundness: 0.4, ...options };
    }

    params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "speed",
                label: "Скорость нот",
                group: "notes",
                min: 80,
                max: 600,
                step: 20,
                format: (value) => `${Math.round(value)} px/с`,
                get: () => o.speed,
                set: (value) => {
                    o.speed = value;
                }
            },
            {
                type: "boolean",
                key: "hollowNaturals",
                label: "Натуральные ноты",
                group: "notes",
                labels: ["контур", "заливка"],
                get: () => o.hollowNaturals,
                set: (value) => {
                    o.hollowNaturals = value;
                }
            },
            {
                type: "number",
                key: "roundness",
                label: "Скругление",
                group: "notes",
                min: 0,
                max: 0.5,
                step: 0.05,
                format: percent,
                get: () => o.roundness,
                set: (value) => {
                    o.roundness = value;
                }
            },
            {
                type: "number",
                key: "gap",
                label: "Зазор между нотами",
                group: "notes",
                min: 0,
                max: 0.3,
                step: 0.02,
                format: percent,
                get: () => o.gap,
                set: (value) => {
                    o.gap = value;
                }
            }
        ];
    }

    /**
     * Скругление задаётся долей ширины, поэтому узкий диез и широкая
     * натуральная нота выглядят одной формой, а не «квадратом и капсулой».
     */
    radii(bar: NoteBar): [number, number, number, number] {
        const r = Math.min(bar.width * this.options.roundness, bar.height / 2);
        return bar.openBottom ? [r, r, 0, 0] : [r, r, r, r];
    }

    /** Свечение: пустая нота светится кантом, залитая — всей площадью. */
    drawGlow(g: CanvasRenderingContext2D, theme: Theme, bar: NoteBar): void {
        const radii = this.radii(bar);
        g.globalAlpha = 0.5 + bar.velocity * 0.28;

        if (bar.hollow) {
            g.strokeStyle = theme.color(bar.hue, 56);
            g.lineWidth = Math.max(2, bar.width * 0.24);
            roundRectPath(g, bar.x, bar.top, bar.width, bar.height, radii);
            g.stroke();
        } else {
            g.fillStyle = theme.color(bar.hue, 54);
            roundRectPath(g, bar.x, bar.top, bar.width, bar.height, radii);
            g.fill();
        }
        g.globalAlpha = 1;
    }

    /**
     * Одна форма для всех нот: кант + сердцевина. Разница только в плотности
     * заливки — диез залит, натуральная нота остаётся пустой.
     */
    draw(g: CanvasRenderingContext2D, theme: Theme, bar: NoteBar): void {
        const filled = !bar.hollow;
        const alpha = 0.85 + bar.velocity * 0.15;
        const radii = this.radii(bar);
        const stroke = Math.max(1.4, Math.min(3.6, bar.width * 0.16));

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

/** Один экземпляр на сцену: оба слоя нот смотрят в него. */
export const noteStyle = new NoteStyle();
