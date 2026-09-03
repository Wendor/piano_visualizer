/** Партитура: ноты с заранее известным временем, в отличие от живой игры. */

import { buildGrid, EMPTY_GRID } from "./grid";
import type { GridSource, ScoreGrid } from "./grid";

export interface ScoreNote {
    readonly midi: number;
    readonly velocity: number;
    /** Секунды от начала партитуры. */
    readonly start: number;
    readonly end: number;
    /** Номер партии в `Score.parts`. */
    readonly part: number;
}

export interface PedalEvent {
    readonly time: number;
    readonly on: boolean;
}

/**
 * Партия — то, что человек называет «дорожкой»: пара «дорожка файла + канал».
 * В формате 0 дорожка одна и партии различаются каналами, в формате 1 обычно
 * наоборот; пара покрывает оба случая.
 */
export interface ScorePart {
    readonly index: number;
    readonly track: number;
    readonly channel: number;
    readonly name: string;
    readonly program: number | null;
    /** Сколько нот в партии — заполняется в `makeScore`. */
    readonly notes: number;
}

export interface Score {
    readonly name: string;
    /** Отсортированы по началу — на этом держится поиск видимого окна. */
    readonly notes: readonly ScoreNote[];
    readonly pedal: readonly PedalEvent[];
    readonly parts: readonly ScorePart[];
    readonly duration: number;
    /** Самая длинная нота: насколько далеко назад смотреть при поиске окна. */
    readonly maxDuration: number;
    /** Линии тактов и долей в секундах; пустая, если файл о размере молчал. */
    readonly grid: ScoreGrid;
}

export type PartDraft = Omit<ScorePart, "notes">;

/** Собрать партитуру из готовых нот: общий путь для файла и записи. */
export function makeScore(
    name: string,
    notes: ScoreNote[],
    pedal: PedalEvent[],
    parts: readonly PartDraft[],
    /** Карты темпа и размера в тиках; сетка считается уже по длительности. */
    source?: GridSource
): Score {
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
    const counts = new Array<number>(parts.length).fill(0);
    let duration = 0;
    let maxDuration = 0;

    for (const note of sorted) {
        if (note.end > duration) duration = note.end;
        const length = note.end - note.start;
        if (length > maxDuration) maxDuration = length;
        if (note.part >= 0 && note.part < counts.length) counts[note.part]! += 1;
    }

    return {
        name,
        notes: sorted,
        pedal: [...pedal].sort((a, b) => a.time - b.time),
        parts: parts.map((part, index) => ({ ...part, notes: counts[index] ?? 0 })),
        duration,
        maxDuration,
        grid: source ? buildGrid(source.tempos, source.meters, source.division, duration) : EMPTY_GRID
    };
}

/** Индекс первой ноты, начинающейся не раньше `time`. */
export function firstNoteAtOrAfter(notes: readonly ScoreNote[], time: number): number {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (notes[mid]!.start < time) low = mid + 1;
        else high = mid;
    }
    return low;
}
