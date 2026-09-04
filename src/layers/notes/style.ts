import type { Quality } from "../../core/Quality";
import type { Theme } from "../../theme/Theme";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";
import { GradientBook, bucket, stop } from "../../paint/Gradient";
import { CLOUD_TILE } from "../../paint/cloud";
import type { Gradient } from "../../paint/Gradient";
import { SQUARE } from "../../paint/Painter";
import type { Corners, Painter } from "../../paint/Painter";
import type { Tint } from "../../paint/Tint";

export interface NoteStyleOptions {
    /** Скорость полёта ноты, px/сек. */
    speed: number;
    /** Доля ширины клавиши, съедаемая зазором с каждой стороны. */
    gap: number;
    /** Натуральные ноты рисуются контуром, диезы — заливкой. */
    hollowNaturals: boolean;
    /** Скругление в долях ширины ноты — общее для узких и широких. */
    roundness: number;
    /** Длина шлейфа в долях секунды полёта: 0 — без шлейфа. */
    trail: number;
    /** Сила живой заливки внутри ноты: 0 — ровная заливка. */
    texture: number;
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
    /** Нота летит вверх (живая игра), а не падает сверху (файл). */
    readonly rising: boolean;
    /** Постоянная доля 0…1, своя у каждой ноты: по ней живёт её заливка. */
    readonly seed: number;
}

/** Полоса, которую слой заполняет на месте: та же `NoteBar`, только изменяемая. */
type Slot = { -readonly [K in keyof NoteBar]: NoteBar[K] };

/**
 * Полосы кадра. Нот на экране сотня, кадров в секунде шестьдесят — рождать на
 * каждую по объекту значит отдавать сборщику мусора тысячи штук в секунду, а
 * платит он за это рывками в самый неподходящий момент. Полосы живут между
 * кадрами: слой лишь сбрасывает счётчик и заполняет их заново.
 */
export class NoteBars {
    private readonly items: Slot[] = [];
    private used = 0;

    get length(): number {
        return this.used;
    }

    /** Начать кадр заново. Сами полосы остаются — их и переиспользуем. */
    clear(): void {
        this.used = 0;
    }

    /** Очередная полоса под запись. Поля слой задаёт целиком, все до одного. */
    take(): Slot {
        const found = this.items[this.used];
        if (found) {
            this.used++;
            return found;
        }
        const made: Slot = {
            x: 0,
            width: 0,
            top: 0,
            height: 0,
            hue: 0,
            velocity: 0,
            hollow: false,
            openBottom: false,
            rising: false,
            seed: 0
        };
        this.items.push(made);
        this.used++;
        return made;
    }

    /** Полоса под номером: обход идёт по индексу, чтобы не рождать итератор. */
    at(index: number): NoteBar {
        return this.items[index]!;
    }
}

/**
 * Номер ноты → её постоянная доля 0…1. Умножение на золотое сечение разводит
 * соседние номера далеко друг от друга; остаток от деления выстроил бы их
 * лесенкой, и подряд идущие ноты выглядели бы почти одинаково.
 */
export const seedOf = (index: number): number => (index * 0.618033988749895) % 1;

/**
 * Внешний вид нот — общее состояние сцены, а не свойство одного слоя:
 * растущие и падающие ноты обязаны выглядеть одинаково.
 */
export class NoteStyle {
    readonly options: NoteStyleOptions;

    private readonly gradients = new GradientBook();
    private quality: Quality | null = null;
    /**
     * Кортежи радиусов, которые иначе рождались бы на каждую ноту в каждом
     * кадре. Нот в кадре сотня, кадров шестьдесят — это тысячи объектов в
     * секунду на ровном месте.
     */
    private readonly corners: [number, number, number, number] = [0, 0, 0, 0];
    private readonly innerCorners: [number, number, number, number] = [0, 0, 0, 0];
    /** Время сцены: живая заливка и шлейф должны двигаться. */
    time = 0;

    constructor(options: Partial<NoteStyleOptions> = {}) {
        this.options = {
            speed: 240,
            gap: 0.1,
            hollowNaturals: true,
            roundness: 0.4,
            trail: 0.5,
            texture: 0.6,
            ...options
        };
    }

    /** Ступень качества решает, рисовать ли мелкие украшения вроде блика. */
    useQuality(quality: Quality): void {
        this.quality = quality;
    }

    private get detail(): number {
        return this.quality?.profile.detail ?? 1;
    }

    /**
     * Заливать тело ноты ровным цветом вместо поперечного градиента.
     *
     * Растеризация градиента считает интерполяцию на каждый пиксель. Там, где
     * холст рисует процессор, это дороже всей остальной ноты вместе взятой —
     * дороже и скруглённого пути, и канта: замер в Firefox дал 7.5 мс из 29
     * на одном только градиенте. Поэтому его держит лишь высшая ступень.
     */
    get flatFill(): boolean {
        return this.detail < 1;
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
                format: { unit: "px/с" },
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
                key: "trail",
                label: "Шлейф нот",
                group: "notes",
                min: 0,
                max: 1.5,
                step: 0.1,
                format: percent,
                get: () => o.trail,
                set: (value) => {
                    o.trail = value;
                }
            },
            {
                type: "number",
                key: "texture",
                label: "Живая заливка",
                group: "notes",
                min: 0,
                max: 1,
                step: 0.1,
                format: percent,
                get: () => o.texture,
                set: (value) => {
                    o.texture = value;
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
        const corners = this.corners;
        corners[0] = r;
        corners[1] = r;
        corners[2] = bar.openBottom ? 0 : r;
        corners[3] = bar.openBottom ? 0 : r;
        return corners;
    }

    /**
     * Свечение: пустая нота светится кантом, залитая — всей площадью.
     *
     * Прямоугольник без скруглений: в буфере свечения нота вчетверо уже, чем
     * на экране, скругление там — пара пикселей, и размытие съедает его
     * раньше, чем глаз заметит.
     */
    drawGlow(p: Painter, theme: Theme, bar: NoteBar): void {
        this.drawTrail(p, theme, bar);
        p.alpha = 0.5 + bar.velocity * 0.28;

        if (bar.hollow) {
            const width = Math.max(2, bar.width * 0.24);
            p.strokeRound(bar.x, bar.top, bar.width, bar.height, SQUARE, width, theme.tint(bar.hue, 56));
        } else {
            p.fill(bar.x, bar.top, bar.width, bar.height, theme.tint(bar.hue, 54));
        }
        p.alpha = 1;
    }

    /**
     * Шлейф — размазанный след за задним краем ноты. Живёт только в буфере
     * свечения: там он и стоит дёшево, и сразу получается мягким.
     */
    private drawTrail(p: Painter, theme: Theme, bar: NoteBar): void {
        const { trail, speed } = this.options;
        if (trail <= 0.01 || this.detail < 0.5) return;

        const length = speed * 0.32 * trail;
        if (length < 4) return;

        // Хвост тянется назад по ходу движения: у падающей ноты он сверху,
        // у растущей — снизу, где её уже нет.
        const y = bar.rising ? bar.top + bar.height : bar.top - length;
        const key = `trail|${theme.palette.id}|${bucket(bar.hue, 4)}|${bar.rising ? 1 : 0}`;
        const tail = this.gradients.get(key, () => {
            const near = theme.tint(bar.hue, 52, 0.7);
            const far = theme.tint(bar.hue, 46, 0);
            return bar.rising ? [stop(0, near), stop(1, far)] : [stop(0, far), stop(1, near)];
        });

        p.alpha = 0.5 + bar.velocity * 0.35;
        p.fillGradient(bar.x, y, bar.width, length, tail, "y");
        p.alpha = 1;
    }

    /**
     * Одна форма для всех нот: кант + сердцевина. Разница только в плотности
     * заливки — диез залит, натуральная нота остаётся пустой.
     */
    draw(p: Painter, theme: Theme, bar: NoteBar): void {
        const filled = !bar.hollow;
        const alpha = 0.85 + bar.velocity * 0.15;
        const radii = this.radii(bar);
        const stroke = Math.max(1.4, Math.min(3.6, bar.width * 0.16));
        const { x, top, width, height } = bar;

        if (this.flatFill) p.fillRound(x, top, width, height, radii, this.bodyTint(theme, bar, filled));
        else p.fillRoundGradient(x, top, width, height, radii, this.body(theme, bar, filled), "x");

        this.drawTexture(p, bar, radii);

        // Кант откладывается внутрь: линия идёт по контуру, и половина её
        // ширины ушла бы наружу ноты, съедая зазор до соседней.
        const inset = stroke / 2;
        const innerRadii = this.innerCorners;
        for (let i = 0; i < 4; i++) innerRadii[i] = Math.max(0, radii[i]! - inset);
        const innerW = Math.max(0, width - stroke);
        const innerH = Math.max(0, height - stroke);
        const ix = x + inset;
        const iy = top + inset;

        p.strokeRound(
            ix,
            iy,
            innerW,
            innerH,
            innerRadii,
            stroke,
            theme.tint(bar.hue, filled ? 72 : 66, alpha)
        );

        // Тонкий блик по канту — нота читается как стекло. Первое, чем стоит
        // пожертвовать на слабой машине: на глаз почти незаметен.
        if (this.detail >= 0.5) {
            const light = Math.max(0.6, stroke * 0.3);
            p.alpha = alpha * (filled ? 0.45 : 0.55);
            p.strokeRound(ix, iy, innerW, innerH, innerRadii, light, theme.tint(bar.hue, 86, 1));
            p.alpha = 1;
        }
    }

    /**
     * Живая заливка: полупрозрачная облачная текстура внутри ноты, медленно
     * плывущая вдоль неё. Один тайл на всю сцену, поэтому цена — одна заливка.
     */
    private drawTexture(p: Painter, bar: NoteBar, radii: Corners): void {
        const amount = this.options.texture;
        // Только высшая ступень. Узор ложится сложением, а сложение читает
        // то, что уже лежит на холсте: там, где рисует процессор, это самая
        // дорогая вещь во всей сцене — 15 мс из 29 у нот.
        if (amount <= 0.01 || this.detail < 1) return;

        // Каждая нота плывёт по-своему: своя точка в тайле и своя скорость.
        // Одной фазы мало — облака шли бы парадом, просто из разных мест.
        const phaseX = bar.seed * CLOUD_TILE;
        // Семёрка расцепляет оси: иначе все ноты сидели бы на одной диагонали.
        const phaseY = ((bar.seed * 7) % 1) * CLOUD_TILE;
        const drift = -this.time * 22 * (0.7 + bar.seed * 0.6);

        p.cloud(
            bar.x,
            bar.top,
            bar.width,
            bar.height,
            radii,
            amount * (0.45 + bar.velocity * 0.55),
            phaseX,
            (drift + phaseY) % CLOUD_TILE
        );
    }

    /** Ровный цвет тела: им заливают ноту там, где градиент не по карману. */
    private bodyTint(theme: Theme, bar: NoteBar, filled: boolean): Tint {
        const hue = bucket(bar.hue, 2);
        const velocity = bucket(bar.velocity, 0.1);
        const alpha = 0.85 + velocity * 0.15;
        // Ровная заливка берёт цвет сердцевины: именно её видно на всей ширине,
        // а к краям градиент лишь чуть темнеет.
        return theme.tint(hue, filled ? 58 + velocity * 8 : 50, filled ? alpha : 0.32 * alpha);
    }

    /** Поперечный градиент тела: к краям темнее, в сердцевине ярче. */
    private body(theme: Theme, bar: NoteBar, filled: boolean): Gradient {
        const hue = bucket(bar.hue, 2);
        const velocity = bucket(bar.velocity, 0.1);
        const key = `${theme.palette.id}|${hue}|${filled ? 1 : 0}|${velocity.toFixed(1)}`;

        return this.gradients.get(key, () => {
            const alpha = 0.85 + velocity * 0.15;
            const coreLightness = filled ? 58 + velocity * 8 : 50;
            const coreAlpha = filled ? alpha : 0.32 * alpha;
            const edgeLightness = filled ? 44 + velocity * 8 : 42;
            const edgeAlpha = filled ? 0.9 * alpha : 0.2 * alpha;

            return [
                stop(0, theme.tint(hue, edgeLightness, edgeAlpha)),
                stop(0.5, theme.tint(hue, coreLightness, coreAlpha)),
                stop(1, theme.tint(hue, edgeLightness, edgeAlpha))
            ];
        });
    }
}

/** Один экземпляр на сцену: оба слоя нот смотрят в него. */
export const noteStyle = new NoteStyle();
