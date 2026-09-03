import { describe, expect, it } from "vitest";
import { parseWavetable, zoneFor } from "./wavetable";
import type { Voiceable } from "./wavetable";

/** Кусок настоящего формата: комментарии, одинарные кавычки, ключи без кавычек. */
const SOURCE = `console.log('load _tone_0000_Test_sf2_file');
var _tone_0000_Test_sf2_file={
\tzones:[
\t\t{
\t\t\tmidi:0
\t\t\t,originalPitch:6000
\t\t\t,keyRangeLow:0
\t\t\t,keyRangeHigh:60
\t\t\t,loopStart:100
\t\t\t,loopEnd:200
\t\t\t,coarseTune:0
\t\t\t,fineTune:-5
\t\t\t,sampleRate:44100
\t\t\t,ahdsr:true
\t\t\t,sample:'AAAA//8='
\t\t\t//_tone.Test_low
\t\t}
\t\t,{
\t\t\tmidi:0
\t\t\t,originalPitch:8400
\t\t\t,keyRangeLow:61
\t\t\t,keyRangeHigh:108
\t\t\t,loopStart:0
\t\t\t,loopEnd:0
\t\t\t,coarseTune:0
\t\t\t,fineTune:0
\t\t\t,sampleRate:22050
\t\t\t,file:'T2dnUwAC//8='
\t\t\t//_tone.Test_high
\t\t}
\t]}
;`;

const zone = (low: number, high: number): Voiceable =>
    ({
        low,
        high,
        detune: 6000,
        buffer: null,
        loopStart: 0,
        loopEnd: 0,
        loopable: false
    }) as unknown as Voiceable;

describe("parseWavetable", () => {
    it("читает имя и зоны", () => {
        const table = parseWavetable(SOURCE);
        expect(table.name).toBe("_tone_0000_Test_sf2_file");
        expect(table.zones).toHaveLength(2);
        expect(table.zones[0]).toMatchObject({ originalPitch: 6000, keyRangeHigh: 60, fineTune: -5 });
        expect(table.zones[1]?.sampleRate).toBe(22050);
    });

    it("не портит base64: две косые внутри строки — не комментарий", () => {
        const table = parseWavetable(SOURCE);
        expect(table.zones[0]?.sample).toBe("AAAA//8=");
        expect(table.zones[1]?.file).toBe("T2dnUwAC//8=");
    });

    it("отбрасывает хвостовые комментарии", () => {
        const table = parseWavetable(SOURCE);
        expect(JSON.stringify(table)).not.toContain("_tone.Test_low");
    });

    it("отвергает файл, который не является таблицей", () => {
        expect(() => parseWavetable("просто текст")).toThrow(/WebAudioFont/);
        expect(() => parseWavetable("var _tone_x = ")).toThrow(/повреждена/);
    });
});

describe("zoneFor", () => {
    const zones = [zone(0, 60), zone(61, 108)];

    it("берёт зону, накрывающую клавишу", () => {
        expect(zoneFor(zones, 40)).toBe(zones[0]);
        expect(zoneFor(zones, 61)).toBe(zones[1]);
    });

    it("за пределами диапазонов берёт ближайшую", () => {
        expect(zoneFor(zones, 120)).toBe(zones[1]);
        expect(zoneFor([zone(20, 30)], 5)).toEqual(zone(20, 30));
    });

    it("без зон возвращает ничего", () => {
        expect(zoneFor([], 60)).toBeNull();
    });
});
