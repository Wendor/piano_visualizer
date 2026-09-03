import type { Quality } from "../core/Quality";
import type { ParamSpec } from "../settings/types";

/**
 * Счётчик кадров. Читает усреднённую оценку из ступени качества и обновляет
 * текст четыре раза в секунду: писать в DOM каждый кадр — самому мешать замеру.
 */
export class FpsMeter {
    private readonly root = document.createElement("div");
    private timer = 0;
    private shown = false;

    constructor(private readonly quality: Quality) {
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
        if (!on) return;
        this.update();
        this.timer = window.setInterval(() => this.update(), 250);
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
            }
        ];
    }

    dispose(): void {
        window.clearInterval(this.timer);
        this.root.remove();
    }

    private update(): void {
        const work = this.quality.work.toFixed(1);
        this.root.textContent = `${Math.round(this.quality.fps)} к/с · ${work} мс · ${this.quality.title}`;
    }
}
