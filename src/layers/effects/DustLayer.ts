import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { Quality } from "../../core/Quality";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";
import type { Ctx2D } from "../../core/surface";

export interface DustOptions {
    /** Плотность пыли: 0 — нет, 2 — метель. */
    density: number;
    /** Сколько пылинок при плотности 1 и высшем качестве. */
    count: number;
    /** Средняя скорость подъёма, px/сек. */
    rise: number;
}

interface Mote {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    phase: number;
    twinkle: number;
}

/** Пылинки в воздухе: медленно всплывают от клавиш и мерцают. */
export class DustLayer extends BaseLayer {
    readonly id = "effects.dust";
    readonly stage = Stage.Particles;
    readonly title = "Пыль";
    readonly options: DustOptions;

    private readonly motes: Mote[] = [];
    private width = 0;
    private height = 0;

    constructor(
        private readonly quality: Quality | null = null,
        options: Partial<DustOptions> = {}
    ) {
        super();
        this.options = { density: 1, count: 130, rise: 16, ...options };
    }

    override params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "density",
                label: "Плотность пыли",
                group: "effects",
                min: 0,
                max: 2,
                step: 0.1,
                format: percent,
                get: () => o.density,
                set: (value) => {
                    o.density = value;
                }
            }
        ];
    }

    override resize(scene: Scene): void {
        this.width = scene.viewport.width;
        this.height = Math.max(1, scene.layout.top);
        this.motes.length = 0;
    }

    override update(_scene: Scene, dt: number): void {
        const target = this.target;
        if (this.motes.length !== target) this.fit(target);

        for (const mote of this.motes) {
            mote.phase += mote.twinkle * dt;
            mote.y += mote.vy * dt;
            // Лёгкое покачивание вбок — пыль не падает по линейке.
            mote.x += (mote.vx + Math.sin(mote.phase * 0.6) * 6) * dt;
            if (mote.y < -8) this.reset(mote, true);
            if (mote.x < -8) mote.x = this.width + 8;
            if (mote.x > this.width + 8) mote.x = -8;
        }
    }

    override draw(g: Ctx2D, scene: Scene): void {
        this.paint(g, scene, 1, 1);
    }

    override drawGlow(g: Ctx2D, scene: Scene): void {
        // В буфере свечения пылинка меньше пикселя — рисуем крупнее и мягче,
        // иначе после размытия от неё не останется следа.
        this.paint(g, scene, 2.6, 0.55);
    }

    private paint(g: Ctx2D, scene: Scene, scale: number, weight: number): void {
        if (this.motes.length === 0) return;
        const level = (0.3 + scene.energy * 0.7) * weight;

        g.save();
        g.globalCompositeOperation = "lighter";
        // Пылинок сотни, а строка цвета дорогая: раскладываем их по четырём
        // ступеням яркости и меняем стиль четыре раза за кадр, а не сто.
        for (let step = 0; step < 4; step++) {
            const alpha = ((step + 1) / 4) * 0.5 * level;
            if (alpha <= 0.01) continue;
            g.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
            for (const mote of this.motes) {
                const shine = 0.5 + 0.5 * Math.sin(mote.phase);
                if (Math.min(3, Math.floor(shine * 4)) !== step) continue;
                const size = mote.size * scale;
                g.fillRect(mote.x, mote.y, size, size);
            }
        }
        g.restore();
    }

    private get target(): number {
        const budget = this.quality?.profile.particles ?? 1;
        return Math.max(0, Math.round(this.options.count * this.options.density * budget));
    }

    private fit(target: number): void {
        while (this.motes.length > target) this.motes.pop();
        while (this.motes.length < target) {
            const mote: Mote = { x: 0, y: 0, vx: 0, vy: 0, size: 1, phase: 0, twinkle: 1 };
            this.reset(mote, false);
            this.motes.push(mote);
        }
    }

    /** `fromBottom` — пылинка родилась заново у клавиш, а не при заполнении. */
    private reset(mote: Mote, fromBottom: boolean): void {
        const rise = this.options.rise;
        mote.x = Math.random() * this.width;
        mote.y = fromBottom ? this.height + Math.random() * 40 : Math.random() * this.height;
        mote.vx = (Math.random() - 0.5) * 10;
        mote.vy = -(rise * (0.4 + Math.random() * 1.3));
        mote.size = 0.8 + Math.random() * 1.4;
        mote.phase = Math.random() * Math.PI * 2;
        mote.twinkle = 0.8 + Math.random() * 2.4;
    }
}
