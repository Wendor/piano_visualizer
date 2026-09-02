/** Партитура: ноты с заранее известным временем, в отличие от живой игры. */

export interface ScoreNote {
    readonly midi: number;
    readonly velocity: number;
    /** Секунды от начала партитуры. */
    readonly start: number;
    readonly end: number;
    readonly track: number;
}

export interface PedalEvent {
    readonly time: number;
    readonly on: boolean;
}

export interface Score {
    readonly name: string;
    /** Отсортированы по началу — на этом держится поиск видимого окна. */
    readonly notes: readonly ScoreNote[];
    readonly pedal: readonly PedalEvent[];
    readonly duration: number;
    readonly tracks: number;
    /** Сколько нот в каждой дорожке — по этому списку строится их выбор. */
    readonly trackNotes: readonly number[];
    /** Самая длинная нота: насколько далеко назад смотреть при поиске окна. */
    readonly maxDuration: number;
}

export const EMPTY_SCORE: Score = {
    name: "",
    notes: [],
    pedal: [],
    duration: 0,
    tracks: 0,
    trackNotes: [],
    maxDuration: 0
};

/** Собрать партитуру из готовых нот: общий путь для файла и записи. */
export function makeScore(name: string, notes: ScoreNote[], pedal: PedalEvent[], tracks: number): Score {
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
    let duration = 0;
    let maxDuration = 0;
    const trackNotes = new Array<number>(tracks).fill(0);
    for (const note of sorted) {
        if (note.end > duration) duration = note.end;
        const length = note.end - note.start;
        if (length > maxDuration) maxDuration = length;
        if (note.track < trackNotes.length) trackNotes[note.track]! += 1;
        else trackNotes[note.track] = 1;
    }
    return {
        name,
        notes: sorted,
        pedal: [...pedal].sort((a, b) => a.time - b.time),
        duration,
        tracks,
        trackNotes,
        maxDuration
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
