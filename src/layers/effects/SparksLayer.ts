import { BaseLayer, Stage } from "../../core/types";
import type { ParamSpec } from "../../settings/types";
import type { Scene } from "../../core/Scene";
import type { Quality } from "../../core/Quality";

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
}

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
                hue
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
        }
    }

    override drawGlow(g: CanvasRenderingContext2D, scene: Scene): void {
        g.lineCap = "round";
        for (const spark of this.sparks) {
            const k = 1 - spark.life / spark.max;
            g.globalAlpha = k * 0.85;
            g.strokeStyle = scene.theme.color(spark.hue, 68, 1);
            g.lineWidth = 1.6 + spark.size * 1.6;
            g.beginPath();
            g.moveTo(spark.x, spark.y);
            g.lineTo(spark.x - spark.vx * 0.014, spark.y - spark.vy * 0.014);
            g.stroke();
        }
        g.globalAlpha = 1;
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        g.globalCompositeOperation = "lighter";
        g.lineCap = "round";
        for (const spark of this.sparks) {
            const k = 1 - spark.life / spark.max;
            g.globalAlpha = k * 0.9;
            g.strokeStyle = scene.theme.color(spark.hue, 74, 1);
            g.lineWidth = spark.size * (0.7 + k * 0.9);
            g.beginPath();
            g.moveTo(spark.x, spark.y);
            g.lineTo(spark.x - spark.vx * 0.012, spark.y - spark.vy * 0.012);
            g.stroke();
        }
    }
}
