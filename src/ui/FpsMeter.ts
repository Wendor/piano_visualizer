import { LongTasks } from "../core/LongTasks";
import type { Visualizer } from "../core/Visualizer";
import type { RenderStats } from "../render/protocol";
import type { ParamSpec } from "../settings/types";
import { profileLines } from "./profile";

/**
 * Откуда счётчик берёт цифры. Сцена рисует то в окне, то в рабочем потоке, и
 * во втором случае сводка приходит сообщением — счётчику это безразлично.
 */
export interface StatsSource {
    stats(): RenderStats;
    setProfiling(on: boolean): void;
}

/** Сводка от визуализатора, который рисует прямо здесь. */
export function localStats(visualizer: Visualizer): StatsSource {
    return {
        stats: () => {
            const { quality, profiler, canvas } = visualizer;
            return {
                fps: quality.fps,
                work: quality.work,
                title: quality.title,
                stalls: quality.smoothness.stalls,
                worst: quality.smoothness.worst,
                width: canvas.width,
                height: canvas.height,
                profiling: profiler.active,
                rows: profiler.rows().map((row) => [row.label, row.ms] as [string, number])
            };
        },
        setProfiling: (on) => visualizer.profiler.setEnabled(on)
    };
}

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
    private profiling = false;

    constructor(private readonly source: StatsSource) {
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
        this.profiling = on;
        this.source.setProfiling(on);
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
                get: () => this.profiling,
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
        const stats = this.source.stats();
        const lines = [`${Math.round(stats.fps)} к/с · ${stats.work.toFixed(1)} мс · ${stats.title}`];

        // Кадров в секунду мало для суждения: при рваном ходе их бывает даже
        // больше обычного, а картинка дёргается. Рывки об этом и говорят.
        if (stats.stalls > 0) {
            lines.push(`рывков ${stats.stalls} · худший ${stats.worst.toFixed(0)} мс`);
        }

        // Разовое замирание рывками не описать: через секунду ход снова ровный,
        // а о причине судить не по чему. Блокировки показывают сам факт.
        this.blocks.forget(performance.now());
        if (this.blocks.count > 0) {
            lines.push(`блокировок ${this.blocks.count} · до ${this.blocks.worst.toFixed(0)} мс`);
        }

        if (stats.profiling) {
            // Размер холста — первое, что стоит увидеть на большом экране:
            // телевизор на 4K просит вчетверо больше пикселей, чем ноутбук.
            lines.push(`холст ${stats.width}×${stats.height}`);
            lines.push(...profileLines(stats.rows.map(([label, ms]) => ({ label, ms }))));
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
