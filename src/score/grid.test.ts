import { describe, expect, it } from "vitest";
import { buildGrid, firstLineAtOrAfter } from "./grid";
import type { MeterPoint, TempoPoint } from "./grid";

/** Тиков на четверть — как в большинстве файлов. */
const DIVISION = 480;
const at120: TempoPoint[] = [{ tick: 0, micros: 500_000 }];
const four: MeterPoint[] = [{ tick: 0, numerator: 4, denominator: 4 }];

/** Секунды с точностью до миллисекунды: считать в плавающей точке иначе больно. */
const ms = (times: readonly number[]): number[] => times.map((t) => Math.round(t * 1000) / 1000);

describe("сетка тактов", () => {
    it("четыре четверти при 120 ударах: такт каждые две секунды", () => {
        const grid = buildGrid(at120, four, DIVISION, 8);
        expect(ms(grid.bars)).toEqual([0, 2, 4, 6, 8]);
    });

    it("доля — четверть, и линии тактов она не повторяет", () => {
        const grid = buildGrid(at120, four, DIVISION, 4);
        expect(ms(grid.beats)).toEqual([0.5, 1, 1.5, 2.5, 3, 3.5]);
        expect(grid.beats.some((beat) => grid.bars.includes(beat))).toBe(false);
    });

    it("без размера в файле считаем четыре четверти", () => {
        expect(ms(buildGrid(at120, [], DIVISION, 8).bars)).toEqual([0, 2, 4, 6, 8]);
    });

    it("в три четверти такт короче", () => {
        const grid = buildGrid(at120, [{ tick: 0, numerator: 3, denominator: 4 }], DIVISION, 4.5);
        expect(ms(grid.bars)).toEqual([0, 1.5, 3, 4.5]);
    });

    it("в шесть восьмых доля — восьмая", () => {
        const grid = buildGrid(at120, [{ tick: 0, numerator: 6, denominator: 8 }], DIVISION, 3);
        expect(ms(grid.bars)).toEqual([0, 1.5, 3]);
        expect(ms(grid.beats).slice(0, 5)).toEqual([0.25, 0.5, 0.75, 1, 1.25]);
    });

    it("смена темпа двигает последующие такты", () => {
        const tempos: TempoPoint[] = [
            { tick: 0, micros: 500_000 },
            { tick: 1920, micros: 250_000 } // с третьего такта вдвое быстрее
        ];
        expect(ms(buildGrid(tempos, four, DIVISION, 5).bars)).toEqual([0, 2, 3, 4, 5]);
    });

    it("смена размера начинает новый такт прямо на себе", () => {
        const meters: MeterPoint[] = [
            { tick: 0, numerator: 4, denominator: 4 },
            { tick: 960, numerator: 3, denominator: 4 } // посреди первого такта
        ];
        expect(ms(buildGrid(at120, meters, DIVISION, 5).bars)).toEqual([0, 1, 2.5, 4]);
    });

    it("сетка не выходит за длительность", () => {
        const grid = buildGrid(at120, four, DIVISION, 3.3);
        expect(Math.max(...grid.bars, ...grid.beats)).toBeLessThanOrEqual(3.3);
    });

    it("пустая партитура даёт пустую сетку", () => {
        expect(buildGrid(at120, four, DIVISION, 0)).toEqual({ bars: [], beats: [] });
    });

    it("мусорный размер не роняет разбор и не уводит в бесконечность", () => {
        const meters: MeterPoint[] = [{ tick: 0, numerator: 0, denominator: 0 }];
        const grid = buildGrid(at120, meters, DIVISION, 10);
        expect(grid.bars.length).toBeGreaterThan(0);
        expect(grid.bars.length + grid.beats.length).toBeLessThan(10_000);
        expect(grid.bars.every(Number.isFinite)).toBe(true);
    });

    it("без карты темпа берёт 120 ударов", () => {
        expect(ms(buildGrid([], four, DIVISION, 4).bars)).toEqual([0, 2, 4]);
    });
});

describe("поиск линии", () => {
    const times = [0, 1.5, 3, 4.5];

    it("находит первую линию не раньше времени", () => {
        expect(firstLineAtOrAfter(times, 1.6)).toBe(2);
    });

    it("линию ровно на времени считает первой", () => {
        expect(firstLineAtOrAfter(times, 3)).toBe(2);
    });

    it("до начала возвращает ноль, за концом — длину", () => {
        expect(firstLineAtOrAfter(times, -1)).toBe(0);
        expect(firstLineAtOrAfter(times, 10)).toBe(times.length);
        expect(firstLineAtOrAfter([], 1)).toBe(0);
    });
});
