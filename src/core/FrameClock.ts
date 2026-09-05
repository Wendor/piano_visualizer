/**
 * Часы кадра: шаг сцены по развёртке, а не по метке времени.
 *
 * Развёртка идёт ровно. Прямая по четырёмстам меткам подряд даёт период
 * 8.333 мс и уход меньше миллисекунды на всём отрезке — экран не гуляет. А вот
 * сама метка приходит дрожащей: ±0.8 мс вокруг этой прямой. Это шум доставки,
 * а не экрана.
 *
 * Считать положение ноты прямо по метке — значит отправить это дрожание в
 * картинку. На 480 px/с шаг ноты гуляет от 3.6 до 4.4 пикселя вместо ровных
 * четырёх, и ход выглядит рваным при совершенно честных ста двадцати кадрах.
 *
 * Поэтому наружу идёт целое число периодов, а метка нужна лишь затем, чтобы
 * понять, сколько их прошло, и чтобы сетка не уехала от настоящего времени.
 * Пропущенный кадр — это два шага, а не рывок. Сменилась частота экрана или
 * вкладка вернулась из фона — часы несколько кадров идут по метке и ставят
 * сетку заново.
 */

/** Сколько кадров часы идут по метке, прежде чем встать на сетку. */
const WARM = 8;
/** По скольким кадрам судим о смене частоты. Середина ряда, а не среднее:
 *  пропущенный кадр не должен сдвигать оценку. */
const WINDOW = 15;
/** Насколько ряд должен разойтись с сеткой, чтобы признать смену частоты. */
const OTHER_RATE = 0.25;
/** Насколько метка должна разойтись с сеткой, чтобы сетку бросить. */
const APART = 0.75;
/** Через сколько кадров уточняем период. Чем длиннее основание, тем точнее
 *  оценка: дрожание отдельных меток на нём усредняется в ничто. */
const REBASE = 60;
/** Доля ошибки, которая идёт в сетку. Она держит сетку у метки, но в шаг —
 *  а значит и в картинку — не попадает. */
const PHASE_PULL = 0.05;
/** Промежутки за этими пределами — не кадры: вкладка была в фоне или спала. */
const MIN_GAP = 1;
const MAX_GAP = 250;

export class FrameClock {
    private readonly gaps: number[] = [];
    private readonly scratch: number[] = [];
    private periodMs = 1000 / 60;
    private warm = 0;
    private raw = 0;
    private time = 0;
    private base = 0;
    private baseTicks = 0;
    private started = false;

    /** Оценка периода развёртки, мс. */
    get period(): number {
        return this.periodMs;
    }

    /** Встали ли часы на сетку. */
    get locked(): boolean {
        return this.started && this.warm >= WARM;
    }

    /** Сколько времени прошло с прошлого кадра, секунды. */
    step(now: number): number {
        if (!this.started) {
            this.started = true;
            this.follow(now);
            return 0;
        }

        const gap = now - this.raw;
        this.raw = now;
        if (gap > MIN_GAP && gap < MAX_GAP) {
            this.gaps.push(gap);
            if (this.gaps.length > WINDOW) this.gaps.shift();
        }

        // Прогрев: сетки ещё нет, идём по метке и заодно узнаём период.
        if (this.warm < WARM) {
            this.warm++;
            this.periodMs = median(this.gaps, this.scratch, this.periodMs);
            const dt = Math.max(0, now - this.time);
            this.follow(now);
            return dt / 1000;
        }

        // Экран сменил частоту — на старую сетку он больше не ложится.
        const middle = median(this.gaps, this.scratch, this.periodMs);
        if (Math.abs(middle - this.periodMs) > this.periodMs * OTHER_RATE) return this.restart(now);

        const before = this.time;
        const frames = Math.max(1, Math.round((now - before) / this.periodMs));
        const stepped = before + frames * this.periodMs;
        const error = now - stepped;
        if (Math.abs(error) > this.periodMs * APART) return this.restart(now);

        this.time = stepped + error * PHASE_PULL;
        this.baseTicks += frames;
        if (this.baseTicks >= REBASE) {
            // Берём измеренное целиком: на таком основании оно точнее любой
            // осторожной поправки — дрожание отдельных меток делится на шесть
            // десятков, а частота экрана между двумя основаниями не меняется.
            this.periodMs = (now - this.base) / this.baseTicks;
            this.base = now;
            this.baseTicks = 0;
        }
        return (frames * this.periodMs) / 1000;
    }

    /** Часы сбиваются: сцена стояла, и следующий кадр — первый заново. */
    reset(): void {
        this.started = false;
        this.warm = 0;
        this.gaps.length = 0;
    }

    /** Идти за меткой: сетки нет или она уже не про этот экран. */
    private follow(now: number): void {
        this.raw = now;
        this.time = now;
        this.base = now;
        this.baseTicks = 0;
    }

    /** Ставить сетку заново, а пока идти по метке. */
    private restart(now: number): number {
        const dt = Math.max(0, now - this.time);
        this.warm = 0;
        this.gaps.length = 0;
        this.follow(now);
        return dt / 1000;
    }
}

/** Середина ряда. Список короткий, поэтому копия и сортировка ничего не стоят. */
function median(values: readonly number[], scratch: number[], fallback: number): number {
    if (values.length === 0) return fallback;
    scratch.length = 0;
    for (const value of values) scratch.push(value);
    scratch.sort((a, b) => a - b);
    return scratch[scratch.length >> 1] ?? fallback;
}
