import { clamp } from "../core/math";
import { DRUM_CHANNEL } from "../score/gm";
import type { Score } from "../score/types";

/** Данные инструментов WebAudioFont: банк FluidR3 GM (лицензия MIT). */
export const WAVETABLE_CDN = "https://surikov.github.io/webaudiofontdata/sound/";
/** Локальная копия для работы без сети: `npm run sound:fetch`. */
export const WAVETABLE_LOCAL = "sound/";
const BANK = "FluidR3_GM_sf2_file";

/** Имя файла звуковой таблицы для инструмента General MIDI. */
export function presetFile(program: number): string {
    const index = Math.round(clamp(program, 0, 127)) * 10;
    return `${String(index).padStart(4, "0")}_${BANK}`;
}

export interface Timbre {
    readonly id: string;
    readonly title: string;
    /** Инструмент GM; `null` — брать инструмент каждой партии из файла. */
    readonly program: number | null;
}

export const TIMBRES: readonly Timbre[] = [
    { id: "piano", title: "Рояль", program: 0 },
    { id: "epiano", title: "Электропиано", program: 4 },
    { id: "vibraphone", title: "Вибрафон", program: 11 },
    { id: "organ", title: "Орган", program: 16 },
    { id: "guitar", title: "Гитара", program: 24 },
    { id: "strings", title: "Струнные", program: 48 },
    { id: "score", title: "как в файле", program: null }
];

/**
 * Тянется ли звук, пока держат клавишу. У рояля и гитары сэмпл затухает сам,
 * и зацикливать его нельзя — иначе нота будет звенеть вечно; орган, струнные
 * и духовые, наоборот, обязаны тянуться по петле.
 */
export function sustains(program: number): boolean {
    if (program >= 16 && program <= 23) return true;
    if (program >= 40 && program <= 79) return true;
    if (program >= 84 && program <= 103) return true;
    return false;
}

/** Одна звуковая таблица, которую нужно поднять. */
export interface BankNeed {
    readonly file: string;
    readonly program: number;
    /** Чья это таблица: индекс партии или -1 — общая для живой игры. */
    readonly part: number;
}

/**
 * Какие таблицы поднять для выбранного тембра. В режиме «как в файле» это
 * инструмент каждой партии плюс рояль: живая игра поверх файла не принадлежит
 * ни одной партии, а ударные звучат иначе и сюда не попадают.
 */
export function banksNeeded(timbre: string, score: Score | null): BankNeed[] {
    const chosen = TIMBRES.find((item) => item.id === timbre) ?? TIMBRES[0]!;
    const base = chosen.program ?? 0;
    const needed: BankNeed[] = [{ file: presetFile(base), program: base, part: -1 }];
    if (chosen.program !== null || !score) return needed;

    for (const part of score.parts) {
        if (part.channel === DRUM_CHANNEL) continue;
        const program = part.program ?? 0;
        needed.push({ file: presetFile(program), program, part: part.index });
    }
    return needed;
}
