import { clamp } from "../core/math";

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
