import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { Quality } from "../../core/Quality";
import { GradientBook, bucket, stop } from "../../paint/Gradient";
import { clamp, lerp } from "../../core/math";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";
import type { Painter } from "../../paint/Painter";

export interface NebulaOptions {
    /** Плотность облаков: 0 — выключено, 2 — густой туман. */
    density: number;
    /** Базовое число облаков при высшем качестве. */
    count: number;
    /** Скорость дрейфа, px/сек. */
    drift: number;
}

interface Cloud {
    x: number;
    y: number;
    radius: number;
    vx: number;
    vy: number;
    phase: number;
    /** Скорость дыхания облака. */
    pulse: number;
    /** Своё место относительно центра внимания, в долях ширины экрана. */
    offset: number;
}

/**
 * Дымка за нотами: несколько мягких облаков, которые медленно плывут и
 * разгораются от игры. Рисуется только в буфер свечения — он вчетверо меньше
 * экрана, поэтому туман почти ничего не стоит, а блум делает его облаком.
 */
export class NebulaLayer extends BaseLayer {
    readonly id = "effects.nebula";
    readonly stage = Stage.Background + 10;
    readonly title = "Дымка";
    readonly options: NebulaOptions;

    private readonly clouds: Cloud[] = [];
    private readonly gradients = new GradientBook(128);
    /** Куда смещён центр внимания: середина звучащих клавиш. */
    private focus = 0.5;
    private width = 0;
    private height = 0;

    constructor(
        private readonly quality: Quality | null = null,
        options: Partial<NebulaOptions> = {}
    ) {
        super();
        this.options = { density: 1, count: 10, drift: 12, ...options };
    }

    override params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "density",
                label: "Плотность дымки",
                group: "effects",
                min: 0,
                max: 2,
                step: 0.1,
                format: percent,
                get: () => o.density,
                set: (value) => {
                    o.density = value;
                }
            },
            {
                type: "number",
                key: "drift",
                label: "Дрейф дымки",
                group: "effects",
                min: 0,
                max: 40,
                step: 2,
                format: { unit: "px/с" },
                get: () => o.drift,
                set: (value) => {
                    o.drift = value;
                }
            }
        ];
    }

    override resize(scene: Scene): void {
        this.width = scene.viewport.width;
        this.height = Math.max(1, scene.layout.top);
        this.build();
    }

    override update(scene: Scene, dt: number): void {
        if (this.clouds.length !== this.count) this.build();

        // Центр внимания тянется к звучащим клавишам, но не дёргается за ними.
        if (scene.active.size > 0 && this.width > 0) {
            let sum = 0;
            let n = 0;
            for (const midi of scene.active.keys()) {
                const key = scene.layout.get(midi);
                if (!key) continue;
                sum += (key.x + key.width / 2) / this.width;
                n++;
            }
            if (n > 0) this.focus += (sum / n - this.focus) * Math.min(1, dt * 1.2);
        } else {
            this.focus += (0.5 - this.focus) * Math.min(1, dt * 0.25);
        }

        const drift = this.options.drift;
        for (const cloud of this.clouds) {
            cloud.x += cloud.vx * drift * dt;
            cloud.y += cloud.vy * drift * dt;
            cloud.phase += cloud.pulse * dt;

            // Притяжение к центру внимания — но каждое облако к своему месту
            // рядом с ним: иначе при плотной игре все сойдутся в одну точку
            // и сложатся в яркое пятно.
            const home = (this.focus + cloud.offset) * this.width;
            cloud.x += (home - cloud.x) * dt * 0.08;

            const margin = cloud.radius;
            if (cloud.x < -margin) cloud.x = this.width + margin;
            if (cloud.x > this.width + margin) cloud.x = -margin;
            if (cloud.y < -margin) cloud.y = this.height + margin * 0.5;
            if (cloud.y > this.height + margin) cloud.y = -margin * 0.5;
        }
    }

    override drawGlow(p: Painter, scene: Scene): void {
        const { density } = this.options;
        if (density <= 0.01 || this.width <= 0) return;

        const { palette } = scene.theme;
        // Облака складываются по яркости, поэтому общий уровень делится между
        // ними: гуще туман — не значит светлее.
        const share = Math.sqrt(4 / Math.max(1, this.clouds.length));
        const level = density * (0.05 + scene.energy * 0.13) * share;

        for (const cloud of this.clouds) {
            const breath = 0.55 + 0.45 * Math.sin(cloud.phase);
            const alpha = level * breath;
            if (alpha <= 0.004) continue;

            const hue = lerp(palette.hueLow, palette.hueHigh, clamp(cloud.x / this.width, 0, 1));
            const radius = Math.max(32, bucket(cloud.radius, 24));

            const body = this.gradients.get(`${palette.id}|${bucket(hue, 6)}`, () => [
                stop(0, scene.theme.tint(hue, 50, 0.7)),
                stop(0.45, scene.theme.tint(hue, 46, 0.32)),
                stop(1, scene.theme.tint(hue, 40, 0))
            ]);
            p.blend = "add";
            p.alpha = alpha;
            p.fillRadial(
                cloud.x - radius,
                cloud.y - radius,
                radius * 2,
                radius * 2,
                cloud.x,
                cloud.y,
                radius,
                body
            );
        }
    }

    private get count(): number {
        const density = this.quality?.profile.particles ?? 1;
        return Math.max(2, Math.round(this.options.count * density));
    }

    private build(): void {
        this.clouds.length = 0;
        if (this.width <= 0) return;
        const count = this.count;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            this.clouds.push({
                x: Math.random() * this.width,
                // Ближе к клавиатуре тумана больше — там и рождается свет.
                y: this.height * (0.25 + Math.random() * 0.75),
                radius: this.height * (0.3 + Math.random() * 0.35),
                vx: Math.cos(angle),
                vy: Math.sin(angle) * 0.5,
                phase: Math.random() * Math.PI * 2,
                pulse: 0.18 + Math.random() * 0.35,
                offset: (i / count - 0.5) * 0.8 + (Math.random() - 0.5) * 0.15
            });
        }
    }
}
