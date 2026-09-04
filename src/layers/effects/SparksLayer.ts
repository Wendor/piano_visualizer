import { BaseLayer, Stage } from "../../core/types";
import type { ParamSpec } from "../../settings/types";
import type { Scene } from "../../core/Scene";
import type { Quality } from "../../core/Quality";
import type { Ctx2D } from "../../core/surface";

/** Чем группа искр отличается в свечении и на экране. */
interface Look {
    lightness: number;
    alpha: number;
    /** Длина хвоста в долях скорости. */
    tail: number;
    /** Толстая линия свечения или тонкая экранная. */
    wide: boolean;
}

export interface SparksOptions {
    /** Базовое число искр; к нему добавляется вклад velocity. */
    count: number;
    velocityCount: number;
    gravity: number;
    drag: number;
}

interface Spark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    life: number;
    max: number;
    hue: number;
    /** Доля оставшейся жизни: 1 — только что, 0 — погасла. */
    k: number;
    /** Номер группы: искры с одним номером рисуются одной обводкой. */
    group: number;
}

/**
 * На сколько ступеней делим яркость и толщину. Искра живёт полсекунды, за это
 * время ступень сменится несколько раз — затухание остаётся плавным, а стиль
 * холста меняется десяток раз за кадр вместо сотни.
 */
const SHADES = 6;
/** Ширина оттеночной корзины, градусов. */
const HUE_STEP = 12;

/** Искры от удара по клавише. */
export class SparksLayer extends BaseLayer {
    readonly id = "effects.sparks";
    readonly stage = Stage.Particles;
    readonly title = "Искры";
    readonly options: SparksOptions;

    private readonly sparks: Spark[] = [];
    private detach: (() => void) | null = null;

    constructor(
        private readonly quality: Quality | null = null,
        options: Partial<SparksOptions> = {}
    ) {
        super();
        this.options = { count: 7, velocityCount: 13, gravity: 430, drag: 1.9, ...options };
    }

    override params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "count",
                label: "Искр на ноту",
                group: "effects",
                min: 0,
                max: 24,
                step: 1,
                get: () => o.count,
                set: (value) => {
                    o.count = Math.round(value);
                }
            },
            {
                type: "number",
                key: "gravity",
                label: "Гравитация искр",
                group: "effects",
                min: 100,
                max: 900,
                step: 25,
                get: () => o.gravity,
                set: (value) => {
                    o.gravity = value;
                }
            }
        ];
    }

    override init(scene: Scene): void {
        this.detach = scene.events.on("noteon", ({ midi, velocity }) => this.spawn(scene, midi, velocity));
    }

    override dispose(): void {
        this.detach?.();
        this.detach = null;
        this.sparks.length = 0;
    }

    private spawn(scene: Scene, midi: number, velocity: number): void {
        const key = scene.layout.get(midi);
        if (!key) return;

        const hue = scene.theme.hueFor(midi, scene.layout);
        const cx = key.x + key.width / 2;
        const density = this.quality?.profile.particles ?? 1;
        const full = this.options.count + (velocity / 127) * this.options.velocityCount;
        const total = Math.round(full * density);

        for (let i = 0; i < total; i++) {
            const aim = Math.random() - 0.5;
            this.sparks.push({
                x: cx + aim * key.width * 1.5,
                y: scene.layout.top - Math.random() * 6,
                vx: aim * 190 + (Math.random() - 0.5) * 90,
                vy: -(150 + Math.random() * 430) * (0.5 + velocity / 200),
                size: 0.5 + Math.random() * 0.8,
                life: 0,
                max: 0.45 + Math.random() * 0.75,
                hue,
                k: 1,
                group: 0
            });
        }
    }

    override update(_scene: Scene, dt: number): void {
        for (let i = this.sparks.length - 1; i >= 0; i--) {
            const spark = this.sparks[i]!;
            spark.life += dt;
            if (spark.life >= spark.max) {
                this.sparks.splice(i, 1);
                continue;
            }
            spark.x += spark.vx * dt;
            spark.y += spark.vy * dt;
            spark.vy += this.options.gravity * dt;
            spark.vx *= 1 - this.options.drag * dt;
            spark.vy *= 1 - 0.5 * dt;

            spark.k = 1 - spark.life / spark.max;
            const shade = Math.min(SHADES - 1, Math.floor(spark.k * SHADES));
            const thick = spark.size < 0.9 ? 0 : 1;
            spark.group = (Math.round(spark.hue / HUE_STEP) * SHADES + shade) * 2 + thick;
        }

        // Искры складываются по яркости, поэтому порядок не виден, — и его можно
        // отдать под группировку: соседи по списку рисуются одной обводкой.
        this.sparks.sort(byGroup);
    }

    override drawGlow(g: Ctx2D, scene: Scene): void {
        this.paint(g, scene, { lightness: 68, alpha: 0.85, tail: 0.014, wide: true });
        g.globalAlpha = 1;
    }

    override draw(g: Ctx2D, scene: Scene): void {
        g.globalCompositeOperation = "lighter";
        this.paint(g, scene, { lightness: 74, alpha: 0.9, tail: 0.012, wide: false });
    }

    /**
     * Одна обводка на группу вместо одной на искру: цвет, прозрачность и
     * толщина ставятся раз в десяток искр, а не сто раз за кадр. Внутри группы
     * они одинаковы — на то она и группа.
     */
    private paint(g: Ctx2D, scene: Scene, look: Look): void {
        const sparks = this.sparks;
        if (sparks.length === 0) return;
        g.lineCap = "round";

        let group = -1;
        for (let i = 0; i < sparks.length; i++) {
            const spark = sparks[i]!;
            if (spark.group !== group) {
                if (group >= 0) g.stroke();
                group = spark.group;
                g.globalAlpha = spark.k * look.alpha;
                g.strokeStyle = scene.theme.color(spark.hue, look.lightness, 1);
                g.lineWidth = look.wide ? 1.6 + spark.size * 1.6 : spark.size * (0.7 + spark.k * 0.9);
                g.beginPath();
            }
            g.moveTo(spark.x, spark.y);
            g.lineTo(spark.x - spark.vx * look.tail, spark.y - spark.vy * look.tail);
        }
        g.stroke();
    }
}

/** Порядок групп: сравниваем числа, чтобы сортировка не стоила дороже отрисовки. */
const byGroup = (a: Spark, b: Spark): number => a.group - b.group;
