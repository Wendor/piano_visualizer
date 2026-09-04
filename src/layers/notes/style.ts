import { roundRectPath } from "../../core/math";
import { GradientCache, bucket } from "../../core/gradients";
import type { Quality } from "../../core/Quality";
import type { Theme } from "../../theme/Theme";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";
import { context2d, createSurface } from "../../core/surface";
import type { Ctx2D, Surface } from "../../core/surface";

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

    private readonly gradients = new GradientCache();
    private quality: Quality | null = null;
    private texture: Surface | null = null;
    private readonly patterns = new WeakMap<Ctx2D, CanvasPattern>();
    /**
     * Рабочие мелочи, которые иначе рождались бы на каждую ноту в каждом кадре:
     * два кортежа радиусов и матрица сдвига текстуры. Нот в кадре сотня, кадров
     * шестьдесят — это тысячи объектов в секунду на ровном месте.
     */
    private readonly corners: [number, number, number, number] = [0, 0, 0, 0];
    private readonly innerCorners: [number, number, number, number] = [0, 0, 0, 0];
    private readonly shift = typeof DOMMatrix === "function" ? new DOMMatrix() : null;
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
     * Прямоугольник без скруглений и без пути: в буфере свечения нота вчетверо
     * уже, чем на экране, скругление там — пара пикселей, и размытие съедает
     * его раньше, чем глаз заметит. `fillRect` вместо `roundRect` + `fill`
     * снимает построение пути с каждой ноты в каждом кадре.
     */
    drawGlow(g: Ctx2D, theme: Theme, bar: NoteBar): void {
        this.drawTrail(g, theme, bar);
        g.globalAlpha = 0.5 + bar.velocity * 0.28;

        if (bar.hollow) {
            g.strokeStyle = theme.color(bar.hue, 56);
            g.lineWidth = Math.max(2, bar.width * 0.24);
            g.strokeRect(bar.x, bar.top, bar.width, bar.height);
        } else {
            g.fillStyle = theme.color(bar.hue, 54);
            g.fillRect(bar.x, bar.top, bar.width, bar.height);
        }
        g.globalAlpha = 1;
    }

    /**
     * Шлейф — размазанный след за задним краем ноты. Живёт только в буфере
     * свечения: там он и стоит дёшево, и сразу получается мягким.
     */
    private drawTrail(g: Ctx2D, theme: Theme, bar: NoteBar): void {
        const { trail, speed } = this.options;
        if (trail <= 0.01 || this.detail < 0.5) return;

        const length = speed * 0.32 * trail;
        if (length < 4) return;

        // Хвост тянется назад по ходу движения: у падающей ноты он сверху,
        // у растущей — снизу, где её уже нет.
        const y = bar.rising ? bar.top + bar.height : bar.top - length;
        const key = `trail|${theme.palette.id}|${bucket(bar.hue, 4)}|${Math.round(length)}|${bar.rising ? 1 : 0}`;
        const gradient = this.gradients.get(key, () => {
            const made = g.createLinearGradient(0, 0, 0, length);
            const near = theme.color(bar.hue, 52, 0.7);
            const far = theme.color(bar.hue, 46, 0);
            made.addColorStop(0, bar.rising ? near : far);
            made.addColorStop(1, bar.rising ? far : near);
            return made;
        });

        g.save();
        g.translate(bar.x, y);
        g.globalAlpha = 0.5 + bar.velocity * 0.35;
        g.fillStyle = gradient;
        g.fillRect(0, 0, bar.width, length);
        g.restore();
    }

    /**
     * Одна форма для всех нот: кант + сердцевина. Разница только в плотности
     * заливки — диез залит, натуральная нота остаётся пустой.
     */
    draw(g: Ctx2D, theme: Theme, bar: NoteBar): void {
        const filled = !bar.hollow;
        const alpha = 0.85 + bar.velocity * 0.15;
        const radii = this.radii(bar);
        const stroke = Math.max(1.4, Math.min(3.6, bar.width * 0.16));
        const { width, height } = bar;

        // Всё рисуется от угла ноты: тогда градиент зависит только от ширины
        // и цвета, а значит его можно взять из кэша, а не строить заново.
        g.save();
        g.translate(bar.x, bar.top);

        // Путь строится дважды, а не четырежды: холст помнит его до следующего
        // `beginPath`, поэтому тело и живая заливка ложатся по одному контуру,
        // а кант и блик — по другому.
        g.fillStyle = this.body(g, theme, bar, filled);
        roundRectPath(g, 0, 0, width, height, radii);
        g.fill();

        this.drawTexture(g, bar);

        const inset = stroke / 2;
        const innerRadii = this.innerCorners;
        for (let i = 0; i < 4; i++) innerRadii[i] = Math.max(0, radii[i]! - inset);
        const innerW = Math.max(0, width - stroke);
        const innerH = Math.max(0, height - stroke);

        g.strokeStyle = theme.color(bar.hue, filled ? 72 : 66, alpha);
        g.lineWidth = stroke;
        roundRectPath(g, inset, inset, innerW, innerH, innerRadii);
        g.stroke();

        // Тонкий блик по канту — нота читается как стекло. Первое, чем стоит
        // пожертвовать на слабой машине: на глаз почти незаметен.
        if (this.detail >= 0.5) {
            g.globalAlpha = alpha * (filled ? 0.45 : 0.55);
            g.strokeStyle = theme.color(bar.hue, 86, 1);
            g.lineWidth = Math.max(0.6, stroke * 0.3);
            g.stroke();
            g.globalAlpha = 1;
        }
        g.restore();
    }

    /**
     * Живая заливка: полупрозрачная облачная текстура внутри ноты, медленно
     * плывущая вдоль неё. Один тайл на всю сцену, поэтому цена — одна заливка.
     */
    private drawTexture(g: Ctx2D, bar: NoteBar): void {
        const amount = this.options.texture;
        // Только высшая ступень. Узор ложится сложением, а сложение читает
        // то, что уже лежит на холсте: там, где рисует процессор, это самая
        // дорогая вещь во всей сцене — 15 мс из 29 у нот.
        if (amount <= 0.01 || this.detail < 1) return;

        const pattern = this.pattern(g);
        if (!pattern) return;

        if (this.shift) {
            // Каждая нота плывёт по-своему: своя точка в тайле и своя скорость.
            // Одной фазы мало — облака шли бы парадом, просто из разных мест.
            const phaseX = bar.seed * 64;
            // Семёрка расцепляет оси: иначе все ноты сидели бы на одной диагонали.
            const phaseY = ((bar.seed * 7) % 1) * 64;
            const drift = -this.time * 22 * (0.7 + bar.seed * 0.6);
            // Матрица одна на сцену: сдвиг — это её последние два числа.
            this.shift.e = phaseX;
            this.shift.f = (drift + phaseY) % 64;
            pattern.setTransform(this.shift);
        }

        // Контур уже построен телом ноты — заливка ложится по нему же.
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = amount * (0.45 + bar.velocity * 0.55);
        g.fillStyle = pattern;
        g.fill();
        g.restore();
    }

    private pattern(g: Ctx2D): CanvasPattern | null {
        const found = this.patterns.get(g);
        if (found) return found;
        this.texture ??= makeTexture();
        const made = g.createPattern(this.texture, "repeat");
        if (!made) return null;
        this.patterns.set(g, made);
        return made;
    }

    /** Заливка тела ноты: градиент или ровный цвет на слабой машине. */
    private body(g: Ctx2D, theme: Theme, bar: NoteBar, filled: boolean): CanvasGradient | string {
        const hue = bucket(bar.hue, 2);
        const width = Math.max(2, Math.round(bar.width));
        const velocity = bucket(bar.velocity, 0.1);
        const key = `${theme.palette.id}|${hue}|${width}|${filled ? 1 : 0}|${velocity.toFixed(1)}`;

        const alpha = 0.85 + velocity * 0.15;
        const coreLightness = filled ? 58 + velocity * 8 : 50;
        const coreAlpha = filled ? alpha : 0.32 * alpha;
        // Ровная заливка берёт цвет сердцевины: именно её видно на всей ширине,
        // а к краям градиент лишь чуть темнеет.
        if (this.flatFill) return theme.color(hue, coreLightness, coreAlpha);

        return this.gradients.get(key, () => {
            const edgeLightness = filled ? 44 + velocity * 8 : 42;
            const edgeAlpha = filled ? 0.9 * alpha : 0.2 * alpha;

            const body = g.createLinearGradient(0, 0, width, 0);
            body.addColorStop(0, theme.color(hue, edgeLightness, edgeAlpha));
            body.addColorStop(0.5, theme.color(hue, coreLightness, coreAlpha));
            body.addColorStop(1, theme.color(hue, edgeLightness, edgeAlpha));
            return body;
        });
    }
}

/**
 * Облачный тайл для живой заливки. Каждое пятно рисуется девять раз со сдвигом
 * на размер тайла — тогда текстура повторяется без видимых швов.
 */
function makeTexture(size = 64): Surface {
    const canvas = createSurface(size, size);
    const g = context2d(canvas, "облачный тайл");

    for (let i = 0; i < 14; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        // Пятна мельче ширины ноты — иначе внутри узкого диеза не видно жизни.
        const radius = 5 + Math.random() * 14;
        const alpha = 0.22 + Math.random() * 0.38;
        for (const dx of [-size, 0, size]) {
            for (const dy of [-size, 0, size]) {
                const gradient = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
                gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
                g.fillStyle = gradient;
                g.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
            }
        }
    }
    return canvas;
}

/** Один экземпляр на сцену: оба слоя нот смотрят в него. */
export const noteStyle = new NoteStyle();
