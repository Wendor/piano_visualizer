/**
 * Кэш градиентов. `createLinearGradient` строит объект под конкретные
 * координаты, поэтому в кадре на сотню нот рождалась сотня градиентов.
 * Слои теперь рисуют в локальных координатах (0,0 — угол фигуры) и берут
 * готовый градиент по ключу; сам сдвиг делает `translate`.
 */
export class GradientCache {
    private readonly items = new Map<string, CanvasGradient>();

    constructor(private readonly limit = 512) {}

    get(key: string, make: () => CanvasGradient): CanvasGradient {
        const found = this.items.get(key);
        if (found) return found;
        // Переполнение — признак того, что ключ слишком дробный: проще
        // начать заново, чем держать сотни мёртвых градиентов.
        if (this.items.size >= this.limit) this.items.clear();
        const made = make();
        this.items.set(key, made);
        return made;
    }

    clear(): void {
        this.items.clear();
    }

    get size(): number {
        return this.items.size;
    }
}

/** Округление до шага — чтобы близкие значения делили один градиент. */
export const bucket = (value: number, step: number): number => Math.round(value / step) * step;
