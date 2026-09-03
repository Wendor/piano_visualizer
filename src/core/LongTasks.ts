/** Сколько секунд блокировка остаётся в отчёте. */
const REMEMBER_MS = 10_000;

/** Кто-то сообщает о блокировке: длительность и момент, обе в миллисекундах. */
export type TaskListener = (ms: number, at: number) => void;
/** Подписка на блокировки; возвращает отписку или null, если браузер молчит. */
export type TaskSource = (listener: TaskListener) => (() => void) | null;

/** Подписка на длинные задачи браузера. Есть не везде — Safari о них молчит. */
export const browserTasks: TaskSource = (listener) => {
    if (typeof PerformanceObserver === "undefined") return null;
    try {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) listener(entry.duration, entry.startTime);
        });
        observer.observe({ entryTypes: ["longtask"] });
        return () => observer.disconnect();
    } catch {
        // Тип записи не поддержан — значит и жаловаться не на что.
        return null;
    }
};

/**
 * Блокировки главного потока: задачи, из-за которых кадр не успевает выйти.
 *
 * Кадров в секунду и рывков мало, когда лаг разовый: сцена замирает на первом
 * касании, а через секунду счётчик снова показывает ровный ход, и о причине
 * судить не по чему. Здесь видно сам факт: сколько раз поток вставал и надолго.
 */
export class LongTasks {
    private readonly seen: Array<{ ms: number; at: number }> = [];
    private readonly stop: (() => void) | null;

    constructor(source: TaskSource = browserTasks) {
        this.stop = source((ms, at) => this.seen.push({ ms, at }));
    }

    /** Сколько блокировок за окно памяти. */
    get count(): number {
        return this.seen.length;
    }

    /** Самая долгая из них, мс. */
    get worst(): number {
        let worst = 0;
        for (const task of this.seen) if (task.ms > worst) worst = task.ms;
        return worst;
    }

    /** Забыть всё, что старше окна: жалуемся на сейчас, а не на загрузку. */
    forget(now: number): void {
        const cutoff = now - REMEMBER_MS;
        let kept = 0;
        for (let i = 0; i < this.seen.length; i++) {
            const task = this.seen[i]!;
            if (task.at <= cutoff) continue;
            if (kept !== i) this.seen[kept] = task;
            kept++;
        }
        this.seen.length = kept;
    }

    dispose(): void {
        this.stop?.();
        this.seen.length = 0;
    }
}
