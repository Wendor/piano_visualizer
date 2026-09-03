import { LongTasks } from "../core/LongTasks";
import type { Visualizer } from "../core/Visualizer";
import type { ParamSpec } from "../settings/types";
import { profileLines } from "./profile";

/**
 * Счётчик кадров и замер по слоям. Читает усреднённую оценку из ступени
 * качества и обновляет текст четыре раза в секунду: писать в DOM каждый кадр —
 * самому мешать замеру.
 *
 * Замер по слоям нужен там, где отладчика нет: на телевизоре видно только то,
 * что мы сами вывели на экран.
 */
export class FpsMeter {
    private readonly root = document.createElement("div");
    private readonly blocks = new LongTasks();
    private timer = 0;
    private shown = false;

    constructor(private readonly visualizer: Visualizer) {
        this.root.className = "fps";
        this.root.hidden = true;
        document.body.appendChild(this.root);
    }

    get visible(): boolean {
        return this.shown;
    }

    setVisible(on: boolean): void {
        if (this.shown === on) return;
        this.shown = on;
        this.root.hidden = !on;
        window.clearInterval(this.timer);
        if (!on) {
            this.setProfiling(false);
            return;
        }
        this.update();
        this.timer = window.setInterval(() => this.update(), 250);
    }

    /** Разбор кадра по слоям: сам счётчик при этом включается. */
    setProfiling(on: boolean): void {
        if (on && !this.shown) this.setVisible(true);
        this.visualizer.profiler.setEnabled(on);
        if (this.shown) this.update();
    }

    params(): ParamSpec[] {
        return [
            {
                type: "boolean",
                key: "fps",
                label: "Счётчик кадров",
                group: "system",
                get: () => this.shown,
                set: (value) => this.setVisible(value)
            },
            {
                type: "boolean",
                key: "profile",
                label: "Разбор кадра",
                group: "system",
                get: () => this.visualizer.profiler.active,
                set: (value) => this.setProfiling(value)
            }
        ];
    }

    dispose(): void {
        window.clearInterval(this.timer);
        this.blocks.dispose();
        this.root.remove();
    }

    private update(): void {
        const { quality, profiler, canvas } = this.visualizer;
        const { smoothness } = quality;
        const lines = [`${Math.round(quality.fps)} к/с · ${quality.work.toFixed(1)} мс · ${quality.title}`];

        // Кадров в секунду мало для суждения: при рваном ходе их бывает даже
        // больше обычного, а картинка дёргается. Рывки об этом и говорят.
        if (smoothness.stalls > 0) {
            lines.push(`рывков ${smoothness.stalls} · худший ${smoothness.worst.toFixed(0)} мс`);
        }

        // Разовое замирание рывками не описать: через секунду ход снова ровный,
        // а о причине судить не по чему. Блокировки показывают сам факт.
        this.blocks.forget(performance.now());
        if (this.blocks.count > 0) {
            lines.push(`блокировок ${this.blocks.count} · до ${this.blocks.worst.toFixed(0)} мс`);
        }

        if (profiler.active) {
            // Размер холста — первое, что стоит увидеть на большом экране:
            // телевизор на 4K просит вчетверо больше пикселей, чем ноутбук.
            lines.push(`холст ${canvas.width}×${canvas.height}`);
            lines.push(...profileLines(profiler.rows()));
        }

        this.root.textContent = "";
        for (const [index, line] of lines.entries()) {
            const row = document.createElement("div");
            // Идентификаторы слоёв набраны латиницей: капитель их только портит.
            if (index > 0) row.className = "fps__detail";
            row.textContent = line;
            this.root.appendChild(row);
        }
    }
}
