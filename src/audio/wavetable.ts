/**
 * Разбор звуковых таблиц WebAudioFont. Файл данных — это JavaScript вида
 * `var _tone_0000_FluidR3_GM_sf2_file = { zones: [ ... ] }`, где каждая зона
 * описывает один сэмпл и диапазон клавиш, на который он натянут.
 *
 * Файл не выполняется: мы превращаем его в JSON и разбираем. Чужой код,
 * пришедший по сети, исполнять незачем — из него нужны только числа и base64.
 */

export interface WavetableZone {
    /** Высота сэмпла в сотых долях полутона: 6000 — до первой октавы. */
    originalPitch: number;
    keyRangeLow: number;
    keyRangeHigh: number;
    /** Точки петли в отсчётах исходного сэмпла. */
    loopStart: number;
    loopEnd: number;
    coarseTune: number;
    fineTune: number;
    sampleRate: number;
    /** Сжатый звук (ogg или mp3) в base64. */
    file?: string;
    /** Несжатый 16-битный звук в base64 — встречается в старых пресетах. */
    sample?: string;
}

export interface Wavetable {
    name: string;
    zones: WavetableZone[];
}

/** Готовая к игре зона: сэмпл уже раскодирован, петля пересчитана в секунды. */
export interface Voiceable {
    low: number;
    high: number;
    /** Высота сэмпла с учётом подстройки, в сотых долях полутона. */
    detune: number;
    buffer: AudioBuffer;
    loopStart: number;
    loopEnd: number;
    loopable: boolean;
}

export function parseWavetable(source: string): Wavetable {
    const declaration = /var\s+(_tone_[A-Za-z0-9_]+)\s*=/.exec(source);
    if (!declaration) throw new Error("Это не звуковая таблица WebAudioFont");

    const from = source.indexOf("{", declaration.index);
    const to = source.lastIndexOf("}");
    if (from < 0 || to <= from) throw new Error("Звуковая таблица повреждена");

    const table = JSON.parse(toJson(source.slice(from, to + 1))) as { zones?: WavetableZone[] };
    if (!table.zones?.length) throw new Error("В звуковой таблице нет зон");
    return { name: declaration[1]!, zones: table.zones };
}

/**
 * Объектный литерал JavaScript → JSON. Строки в таблице заключены в одинарные
 * кавычки и внутри содержат только base64, поэтому текст можно просто разрезать
 * по кавычкам: нечётные куски — строки, чётные — код с ключами и комментариями.
 */
function toJson(source: string): string {
    const parts = source.split("'");
    let out = "";
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (i % 2 === 1) out += JSON.stringify(part);
        else out += part.replace(/\/\/[^\n]*/g, "").replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
    }
    return out;
}

/**
 * Base64 → байты руками браузера, а не циклом по символам.
 *
 * Банк рояля — это десятки зон по десятку килобайт, и цикл по каждому байту
 * складывался в одну задачу на сотню миллисекунд. Пока сцену рисовал рабочий
 * поток, её никто не замечал; в главном это ровно тот рывок на первой ноте.
 * Адрес `data:` браузер разбирает сам и не в главном потоке, а зон много —
 * значит, и работа рассыпается на столько же мелких кусков.
 */
const base64 = async (text: string): Promise<Uint8Array> => {
    const response = await fetch(`data:application/octet-stream;base64,${text}`);
    return new Uint8Array(await response.arrayBuffer());
};

/** Раскодировать все зоны таблицы. Зоны, которые не читаются, просто выпадают. */
export async function decodeWavetable(ctx: BaseAudioContext, table: Wavetable): Promise<Voiceable[]> {
    const decoded = await Promise.all(table.zones.map((zone) => decodeZone(ctx, zone)));
    const zones = decoded.filter((zone): zone is Voiceable => zone !== null);
    if (zones.length === 0) throw new Error("Ни одна зона не раскодировалась");
    return zones.sort((a, b) => a.low - b.low);
}

async function decodeZone(ctx: BaseAudioContext, zone: WavetableZone): Promise<Voiceable | null> {
    try {
        const buffer = zone.file
            ? await ctx.decodeAudioData((await base64(zone.file)).buffer as ArrayBuffer)
            : zone.sample
              ? pcm(ctx, await base64(zone.sample), zone.sampleRate)
              : null;
        if (!buffer) return null;

        const rate = zone.sampleRate || buffer.sampleRate;
        const loopStart = zone.loopStart / rate;
        const loopEnd = zone.loopEnd / rate;

        return {
            low: zone.keyRangeLow,
            high: zone.keyRangeHigh,
            // Именно эту высоту сэмпл звучит без растяжения.
            detune: zone.originalPitch - 100 * (zone.coarseTune ?? 0) - (zone.fineTune ?? 0),
            buffer,
            loopStart,
            loopEnd,
            loopable: loopEnd > loopStart + 0.01 && loopEnd <= buffer.duration + 0.01
        };
    } catch {
        return null;
    }
}

/** Несжатый сэмпл: 16-битные отсчёты со знаком, младший байт первый. */
function pcm(ctx: BaseAudioContext, bytes: Uint8Array, sampleRate: number): AudioBuffer {
    const count = bytes.length >> 1;
    const buffer = ctx.createBuffer(1, Math.max(1, count), sampleRate || 44100);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    return buffer;
}

/** Зона, натянутая на эту клавишу; если точной нет — ближайшая по диапазону. */
export function zoneFor(zones: readonly Voiceable[], midi: number): Voiceable | null {
    let nearest: Voiceable | null = null;
    let distance = Infinity;
    for (const zone of zones) {
        if (midi >= zone.low && midi <= zone.high) return zone;
        const gap = midi < zone.low ? zone.low - midi : midi - zone.high;
        if (gap < distance) {
            distance = gap;
            nearest = zone;
        }
    }
    return nearest;
}
