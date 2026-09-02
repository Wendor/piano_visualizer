/**
 * Геометрия клавиатуры рояля.
 *
 * Все белые клавиши одной ширины, выровненной по целому числу физических
 * пикселей. Чёрные клавиши расставлены по модели настоящего инструмента:
 * внутри групп «до-ре-ми» и «фа-соль-ля-си» задние части белых клавиш равны,
 * поэтому крайние диезы смещены наружу от стыков, а соль-диез стоит ровно по стыку.
 */

import { snap } from "./math";
import type { Viewport } from "./types";

export const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;

export const isAccidental = (midi: number): boolean =>
    !WHITE_PITCH_CLASSES.includes((((midi % 12) + 12) % 12) as (typeof WHITE_PITCH_CLASSES)[number]);

/** Сколько белых клавиш строго ниже данной ноты (абсолютная шкала MIDI). */
export function whiteKeysBelow(midi: number): number {
    const octave = Math.floor(midi / 12);
    const pitchClass = midi - octave * 12;
    let count = 0;
    for (const white of WHITE_PITCH_CLASSES) if (white < pitchClass) count++;
    return octave * 7 + count;
}

export interface PianoKey {
    readonly midi: number;
    readonly pitchClass: number;
    readonly accidental: boolean;
    /** Левый край, px. */
    readonly x: number;
    readonly width: number;
    /** Длина клавиши вниз от верхнего края клавиатуры, px. */
    readonly height: number;
}

export interface LayoutOptions {
    firstMidi: number;
    lastMidi: number;
    /** На узком экране показывать меньше октав вместо «спичек». */
    autoRange: boolean;
    minWhiteWidth: number;
    blackWidthRatio: number;
    blackHeightRatio: number;
    /** Высота клавиатуры = ширина белой клавиши × это число. */
    heightRatio: number;
    maxHeightFraction: number;
    minHeight: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
    firstMidi: 21,
    lastMidi: 108,
    autoRange: true,
    minWhiteWidth: 13,
    blackWidthRatio: 0.583,
    blackHeightRatio: 0.63,
    heightRatio: 4.9,
    maxHeightFraction: 0.3,
    minHeight: 70
};

/** Диапазоны для узких экранов: 88 → 76 → 61 → 49 клавиш. */
export const RANGE_STEPS: ReadonlyArray<readonly [number, number]> = [
    [21, 108],
    [28, 103],
    [36, 96],
    [40, 88]
];

/** Центры чёрных клавиш внутри октавы, в ширинах белой клавиши. */
function accidentalOffsets(blackWidth: number): Record<number, number> {
    const groupCDE = (3 - 2 * blackWidth) / 3;
    const groupFGAB = (4 - 3 * blackWidth) / 4;
    return {
        1: groupCDE + blackWidth / 2,
        3: 2 * groupCDE + 1.5 * blackWidth,
        6: 3 + groupFGAB + blackWidth / 2,
        8: 3 + 2 * groupFGAB + 1.5 * blackWidth,
        10: 3 + 3 * groupFGAB + 2.5 * blackWidth
    };
}

export class KeyboardLayout {
    keys: readonly PianoKey[] = [];
    firstMidi = 21;
    lastMidi = 108;
    whiteWidth = 0;
    blackWidth = 0;
    /** Верхняя кромка клавиатуры — она же линия удара. */
    top = 0;
    height = 0;
    width = 0;

    private byMidi = new Map<number, PianoKey>();

    constructor(private options: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS }) {}

    /** Текущие настройки геометрии — их читает панель настроек. */
    get settings(): Readonly<LayoutOptions> {
        return this.options;
    }

    configure(patch: Partial<LayoutOptions>): void {
        this.options = { ...this.options, ...patch };
    }

    build(viewport: Viewport): void {
        const o = this.options;
        const { width, height, dpr } = viewport;

        let first = o.firstMidi;
        let last = o.lastMidi;
        if (o.autoRange) {
            for (const [a, b] of RANGE_STEPS) {
                if (a < o.firstMidi || b > o.lastMidi) continue;
                first = a;
                last = b;
                const whites = whiteKeysBelow(b + 1) - whiteKeysBelow(a);
                if (width / whites >= o.minWhiteWidth) break;
            }
        }

        const whiteCount = whiteKeysBelow(last + 1) - whiteKeysBelow(first);
        const whiteWidth = Math.floor((width * dpr) / whiteCount) / dpr;
        const marginX = snap((width - whiteWidth * whiteCount) / 2, dpr);

        const kbHeight = Math.max(
            o.minHeight,
            Math.round(Math.min(whiteWidth * o.heightRatio, height * o.maxHeightFraction))
        );
        const blackWidth = snap(whiteWidth * o.blackWidthRatio, dpr);
        const blackHeight = Math.round(kbHeight * o.blackHeightRatio);
        const offsets = accidentalOffsets(blackWidth / whiteWidth);
        const whiteBase = whiteKeysBelow(first);

        const keys: PianoKey[] = [];
        const byMidi = new Map<number, PianoKey>();
        for (let midi = first; midi <= last; midi++) {
            const pitchClass = ((midi % 12) + 12) % 12;
            const accidental = isAccidental(midi);
            let x: number;
            let keyWidth: number;

            if (accidental) {
                const octaveRoot = Math.floor(midi / 12) * 12;
                const unit = whiteKeysBelow(octaveRoot) - whiteBase + (offsets[pitchClass] ?? 0);
                x = snap(marginX + unit * whiteWidth - blackWidth / 2, dpr);
                keyWidth = blackWidth;
            } else {
                const index = whiteKeysBelow(midi) - whiteBase;
                x = snap(marginX + index * whiteWidth, dpr);
                keyWidth = whiteWidth;
            }

            const key: PianoKey = {
                midi,
                pitchClass,
                accidental,
                x,
                width: keyWidth,
                height: accidental ? blackHeight : kbHeight
            };
            keys.push(key);
            byMidi.set(midi, key);
        }

        this.keys = keys;
        this.byMidi = byMidi;
        this.firstMidi = first;
        this.lastMidi = last;
        this.whiteWidth = whiteWidth;
        this.blackWidth = blackWidth;
        this.height = kbHeight;
        this.top = Math.round(height - kbHeight);
        this.width = width;
    }

    get(midi: number): PianoKey | undefined {
        return this.byMidi.get(midi);
    }

    /** Перенос ноты октавами внутрь показанного диапазона. */
    fold(midi: number): number {
        let value = midi;
        while (value < this.firstMidi) value += 12;
        while (value > this.lastMidi) value -= 12;
        return value;
    }

    /** Клавиша под точкой экрана; чёрные имеют приоритет. */
    keyAt(x: number, y: number): PianoKey | undefined {
        if (y < this.top) return undefined;
        for (const key of this.keys) {
            if (!key.accidental) continue;
            if (x >= key.x && x <= key.x + key.width && y <= this.top + key.height) return key;
        }
        for (const key of this.keys) {
            if (key.accidental) continue;
            if (x >= key.x && x <= key.x + key.width) return key;
        }
        return undefined;
    }

    /** Положение ноты в диапазоне, 0 — самая низкая, 1 — самая высокая. */
    position(midi: number): number {
        return (midi - this.firstMidi) / Math.max(1, this.lastMidi - this.firstMidi);
    }
}
