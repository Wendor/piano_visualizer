import { BaseLayer, Stage } from "../../core/types";
import type { ParamSpec } from "../../settings/types";
import type { Scene } from "../../core/Scene";
import { GradientCache, bucket } from "../../core/gradients";
import type { Ctx2D } from "../../core/surface";

export interface KeyLightOptions {
    /** Скорость затухания вспышки удара, 1/сек. */
    decay: number;
    /** Ширина ореола в ширинах клавиши. */
    spread: number;
}

/** Свет, который клавиша отдаёт вверх: ровное свечение + вспышка в момент удара. */
export class KeyLightLayer extends BaseLayer {
    readonly id = "effects.keyLight";
    readonly stage = Stage.Particles;
    readonly title = "Свет клавиш";
    readonly options: KeyLightOptions;

    private readonly flash = new Map<number, number>();
    private readonly gradients = new GradientCache(256);
    private detach: (() => void) | null = null;

    constructor(options: Partial<KeyLightOptions> = {}) {
        super();
        this.options = { decay: 4.5, spread: 2, ...options };
    }

    override params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "decay",
                label: "Затухание вспышки",
                group: "effects",
                min: 1,
                max: 12,
                step: 0.5,
                format: { digits: 1 },
                get: () => o.decay,
                set: (value) => {
                    o.decay = value;
                }
            },
            {
                type: "number",
                key: "spread",
                label: "Ширина ореола",
                group: "effects",
                min: 1,
                max: 5,
                step: 0.25,
                format: { digits: 2 },
                get: () => o.spread,
                set: (value) => {
                    o.spread = value;
                }
            }
        ];
    }

    override init(scene: Scene): void {
        this.detach = scene.events.on("noteon", ({ midi }) => this.flash.set(midi, 1));
    }

    override dispose(): void {
        this.detach?.();
        this.detach = null;
    }

    override update(_scene: Scene, dt: number): void {
        // Обходим карту как есть: копия ради безопасного удаления — это лишний
        // массив пар на каждый кадр, а удалять текущий ключ и так можно.
        for (const [midi, value] of this.flash) {
            const next = value - dt * this.options.decay;
            if (next <= 0) this.flash.delete(midi);
            else this.flash.set(midi, next);
        }
    }

    override drawGlow(g: Ctx2D, scene: Scene): void {
        const { layout, theme } = scene;

        for (const key of layout.keys) {
            const state = scene.active.get(key.midi);
            const flash = this.flash.get(key.midi) ?? 0;
            const intensity = Math.max(state ? 0.55 + Math.min(1, state.velocity / 110) * 0.45 : 0, flash);
            if (intensity <= 0.02) continue;

            const hue = theme.hueFor(key.midi, layout);
            const spread = key.width * (this.options.spread + flash * 2.6);
            const height = 34 + flash * 120;
            // Ореол строится от центра клавиши: тогда радиус можно огрубить
            // и брать готовый градиент из кэша, а яркость отдать globalAlpha.
            const radius = Math.max(16, bucket(Math.max(spread, height), 16));

            g.save();
            g.translate(key.x + key.width / 2, layout.top);
            g.globalAlpha = intensity;
            g.fillStyle = this.gradients.get(`${theme.palette.id}|${bucket(hue, 4)}|${radius}`, () => {
                const gradient = g.createRadialGradient(0, 0, 0, 0, 0, radius);
                gradient.addColorStop(0, theme.color(hue, 60, 0.7));
                gradient.addColorStop(0.42, theme.color(hue, 52, 0.34));
                gradient.addColorStop(1, theme.color(hue, 50, 0));
                return gradient;
            });
            g.fillRect(-spread, -height, spread * 2, height + 10);
            g.restore();
        }
        g.globalAlpha = 1;
    }
}
