import { clamp } from "../core/math";

/**
 * Сетка тактов и долей. Файл задаёт её двумя картами в тиках — темпа и
 * размера, — а сцене нужны готовые секунды: время в проекте везде в секундах.
 */

/** Точка карты темпа: с этого тика четверть длится столько микросекунд. */
export interface TempoPoint {
    readonly tick: number;
    readonly micros: number;
}

/** Точка карты размера: знаменатель числом — 4 это четверть, 8 — восьмая. */
export interface MeterPoint {
    readonly tick: number;
    readonly numerator: number;
    readonly denominator: number;
}

export interface ScoreGrid {
    /** Секунды начал тактов. */
    readonly bars: readonly number[];
    /** Секунды долей; начала тактов сюда не попадают, чтобы не рисовать дважды. */
    readonly beats: readonly number[];
}

/** Всё, что нужно для сетки, в тиках — как это лежит в файле. */
export interface GridSource {
    readonly tempos: readonly TempoPoint[];
    readonly meters: readonly MeterPoint[];
    readonly division: number;
}

export const EMPTY_GRID: ScoreGrid = { bars: [], beats: [] };

/** 120 ударов в минуту и четыре четверти — пока файл не сказал иное. */
const DEFAULT_MICROS = 500_000;
const DEFAULT_METER: MeterPoint = { tick: 0, numerator: 4, denominator: 4 };
/** Потолок на случай испорченного файла: линий больше этого никто не увидит. */
const MAX_LINES = 20_000;

interface TempoSpan {
    readonly tick: number;
    readonly seconds: number;
    readonly micros: number;
}

export function buildGrid(
    tempos: readonly TempoPoint[],
    meters: readonly MeterPoint[],
    division: number,
    duration: number
): ScoreGrid {
    if (!(duration > 0) || !(division > 0)) return EMPTY_GRID;

    const spans = tempoSpans(tempos, division);
    const list = meterList(meters);
    const bars: number[] = [];
    const beats: number[] = [];

    let meterIndex = 0;
    let tempoIndex = 0;
    let tick = 0;
    /** Номер доли внутри такта: ноль — начало такта. */
    let beat = 0;

    for (let line = 0; line < MAX_LINES; line++) {
        const next = list[meterIndex + 1];
        // Смена размера обрывает такт и начинает новый прямо на себе.
        if (next && tick >= next.tick) {
            meterIndex++;
            tick = next.tick;
            beat = 0;
            continue;
        }

        while (spans[tempoIndex + 1] && spans[tempoIndex + 1]!.tick <= tick) tempoIndex++;
        const span = spans[tempoIndex]!;
        const seconds = span.seconds + ((tick - span.tick) * span.micros) / (division * 1e6);
        if (seconds > duration) break;

        if (beat === 0) bars.push(seconds);
        else beats.push(seconds);

        const meter = list[meterIndex]!;
        tick += (division * 4) / meter.denominator;
        beat = (beat + 1) % meter.numerator;
    }

    return { bars, beats };
}

/** Карта темпа с уже посчитанными секундами каждой точки. */
function tempoSpans(tempos: readonly TempoPoint[], division: number): TempoSpan[] {
    const sorted = [...tempos]
        .filter((point) => point.tick >= 0 && point.micros > 0)
        .sort((a, b) => a.tick - b.tick);

    const spans: TempoSpan[] = [{ tick: 0, seconds: 0, micros: DEFAULT_MICROS }];
    for (const point of sorted) {
        const last = spans[spans.length - 1]!;
        // Темп в той же точке просто заменяет прежний.
        if (point.tick <= last.tick) {
            spans[spans.length - 1] = { ...last, micros: point.micros };
            continue;
        }
        const seconds = last.seconds + ((point.tick - last.tick) * last.micros) / (division * 1e6);
        spans.push({ tick: point.tick, seconds, micros: point.micros });
    }
    return spans;
}

/** Карта размера, зажатая в разумное и всегда начинающаяся с нуля. */
function meterList(meters: readonly MeterPoint[]): MeterPoint[] {
    const sorted = meters
        .filter((point) => point.tick >= 0)
        .map((point) => ({
            tick: point.tick,
            numerator: Math.round(clamp(point.numerator, 1, 64)),
            denominator: Math.round(clamp(point.denominator, 1, 64))
        }))
        .sort((a, b) => a.tick - b.tick);

    if (sorted[0]?.tick !== 0) sorted.unshift(DEFAULT_METER);
    return sorted;
}

/** Индекс первой линии не раньше времени: в кадре нужен только видимый кусок. */
export function firstLineAtOrAfter(times: readonly number[], time: number): number {
    let low = 0;
    let high = times.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (times[mid]! < time) low = mid + 1;
        else high = mid;
    }
    return low;
}
