/**
 * Проба двух дорог: пройти каждую и остаться на дешёвой.
 *
 * Нужна там, где ответ зависит от движка, а не от нашего вкуса: одно и то же
 * рисование в Chrome и Firefox стоит по-разному и в разные стороны. Спрашивать
 * имя браузера бессмысленно — оно ничего не обещает; надёжнее проехать оба
 * пути и посмотреть на часы.
 *
 * Проба идёт отрезками, а не через раз: движку нужно несколько повторов, чтобы
 * выйти на установившийся ход, и чередование меряет не дороги, а перекладку
 * поверхностей между ними. Первые замеры каждого отрезка не судят вовсе.
 */
export class Trial<T extends string> {
    private index = 0;
    private warm: number;
    private taken: number[][];
    private choice: T | null = null;

    constructor(
        private readonly roads: readonly T[],
        private readonly warmup = 4,
        private readonly laps = 12
    ) {
        this.warm = warmup;
        this.taken = roads.map(() => []);
    }

    /** Дорога, которой идти сейчас: на пробе — текущая, потом — выбранная. */
    get road(): T {
        return this.choice ?? this.roads[this.index]!;
    }

    /** Выбор сделан — часы больше не нужны. */
    get done(): boolean {
        return this.choice !== null;
    }

    /** Во что обошёлся очередной проезд текущей дороги. */
    sample(ms: number): void {
        if (this.choice !== null) return;
        if (this.warm > 0) {
            this.warm--;
            return;
        }

        const taken = this.taken[this.index]!;
        taken.push(ms);
        if (taken.length < this.laps) return;

        if (this.index < this.roads.length - 1) {
            this.index++;
            this.warm = this.warmup;
            return;
        }
        this.choice = this.best();
    }

    /**
     * Начать заново: условия сменились и старые замеры относятся к другой
     * работе. Уже сделанный выбор проба не пересматривает — он о движке, а
     * движок посреди сцены не меняется.
     */
    restart(): void {
        if (this.choice !== null) return;
        this.index = 0;
        this.warm = this.warmup;
        this.taken = this.roads.map(() => []);
    }

    /**
     * Судим по середине списка, а не по лучшему проезду: рисование ленивое, и
     * отдельный замер легко поймает чужую задержку или, наоборот, покажет лишь
     * скорость, с которой работу заказали.
     */
    private best(): T {
        let bestRoad = this.roads[0]!;
        let bestMs = Infinity;
        for (let i = 0; i < this.roads.length; i++) {
            const ms = median(this.taken[i]!);
            if (ms < bestMs) {
                bestMs = ms;
                bestRoad = this.roads[i]!;
            }
        }
        return bestRoad;
    }
}

/** Середина списка: устойчива и к случайному провалу, и к случайному всплеску. */
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1] ?? Infinity;
}
