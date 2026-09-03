/** Строка отчёта: во что обошёлся участок кадра. */
export interface ProfileRow {
    readonly label: string;
    /** Сглаженное время, мс. */
    readonly ms: number;
}

/** Доля нового кадра в среднем: скачок одного кадра не должен прыгать в глаза. */
const SMOOTHING = 0.15;

/**
 * Замер кадра по участкам. Нужен там, где отладчика нет: на телевизоре видно
 * только то, что мы сами показали на экране.
 *
 * Пока выключен, `measure` вызывает работу напрямую и не трогает часы —
 * замер не должен стоить ничего тем, кто его не просил.
 */
export class FrameProfiler {
    private enabled = false;
    private readonly totals = new Map<string, number>();
    private readonly smoothed = new Map<string, number>();

    constructor(private readonly now: () => number = () => performance.now()) {}

    get active(): boolean {
        return this.enabled;
    }

    setEnabled(on: boolean): void {
        if (this.enabled === on) return;
        this.enabled = on;
        // Старые числа относятся к другому кадру — начинаем с чистого листа.
        this.totals.clear();
        this.smoothed.clear();
    }

    /** Выполнить работу, записав её время под меткой. */
    measure<T>(label: string, work: () => T): T {
        if (!this.enabled) return work();
        const started = this.now();
        const result = work();
        this.totals.set(label, (this.totals.get(label) ?? 0) + (this.now() - started));
        return result;
    }

    /** Кадр закончен: свести замеры в средние. */
    endFrame(): void {
        if (!this.enabled) return;
        for (const [label, total] of this.totals) {
            const previous = this.smoothed.get(label);
            this.smoothed.set(
                label,
                previous === undefined ? total : previous + (total - previous) * SMOOTHING
            );
        }
        // Метка, не встреченная в кадре, относится к выключенному слою:
        // держать её в отчёте — врать о текущей картине.
        for (const label of [...this.smoothed.keys()])
            if (!this.totals.has(label)) this.smoothed.delete(label);
        this.totals.clear();
    }

    /** Участки кадра, самый дорогой первым. */
    rows(): ProfileRow[] {
        return [...this.smoothed].map(([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms);
    }
}
