/** Строка отчёта: во что обошёлся участок кадра. */
export interface ProfileRow {
    readonly label: string;
    /** Сглаженное время, мс. */
    readonly ms: number;
}

/** Доля нового кадра в среднем: скачок одного кадра не должен прыгать в глаза. */
const SMOOTHING = 0.15;

/**
 * Сколько кадров подряд метка может молчать, прежде чем уйдёт из отчёта.
 * Половина секунды: работа, идущая реже кадра — буфер свечения наполняется
 * сорок раз в секунду, — пропадать из отчёта не должна, а выключенный слой
 * пусть уходит быстро.
 */
const FORGET_AFTER = 30;

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
    /** Сколько кадров подряд метка не встречалась. */
    private readonly silence = new Map<string, number>();

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
        this.silence.clear();
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
        for (const label of new Set([...this.smoothed.keys(), ...this.totals.keys()])) {
            const total = this.totals.get(label);
            // Кадр без этой работы идёт в среднее нулём: строка отчёта — цена
            // участка в среднем кадре, а не в том кадре, где он случился.
            // Иначе суммы строк не сойдутся со временем кадра.
            const previous = this.smoothed.get(label);
            this.smoothed.set(
                label,
                previous === undefined ? (total ?? 0) : previous + ((total ?? 0) - previous) * SMOOTHING
            );
            const silent = total === undefined ? (this.silence.get(label) ?? 0) + 1 : 0;
            // Метка, замолчавшая надолго, относится к выключенному слою:
            // держать её в отчёте — врать о текущей картине.
            if (silent > FORGET_AFTER) {
                this.smoothed.delete(label);
                this.silence.delete(label);
            } else this.silence.set(label, silent);
        }
        this.totals.clear();
    }

    /** Участки кадра, самый дорогой первым. */
    rows(): ProfileRow[] {
        return [...this.smoothed].map(([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms);
    }
}
