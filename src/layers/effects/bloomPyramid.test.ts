import { describe, expect, it } from "vitest";
import { bloomPyramid } from "./bloomPyramid";

const passes = [
    { blur: 4, alpha: 0.62 },
    { blur: 14, alpha: 0.52 },
    { blur: 40, alpha: 0.42 }
];

describe("bloomPyramid", () => {
    it("мягкому проходу хватает буфера как есть", () => {
        const levels = bloomPyramid(160, 90, [{ blur: 4, alpha: 0.6 }], 0.16);
        expect(levels).toEqual([{ scale: 1, width: 160, height: 90, alpha: 0.6 }]);
    });

    it("широкому проходу отдаёт уменьшенный уровень: размытие делает сама развёртка", () => {
        // 40 × 0.16 — это радиус около шести пикселей, то есть уменьшение в восемь раз.
        const levels = bloomPyramid(160, 96, [{ blur: 40, alpha: 0.4 }], 0.16);
        expect(levels).toEqual([{ scale: 8, width: 20, height: 12, alpha: 0.4 }]);
    });

    it("выстраивает уровни от крупного к мелкому: каждый следующий берётся из предыдущего", () => {
        const levels = bloomPyramid(160, 96, passes, 0.16);
        const scales = levels.map((level) => level.scale);
        expect(scales).toEqual([...scales].sort((a, b) => a - b));
        expect(new Set(scales).size).toBe(scales.length);
    });

    it("каждый уровень вдвое меньше предыдущего", () => {
        for (const level of bloomPyramid(160, 96, passes, 0.16)) {
            expect(Math.log2(level.scale) % 1).toBe(0);
        }
    });

    it("не даёт уровню выродиться в ничто", () => {
        for (const level of bloomPyramid(3, 2, passes, 1)) {
            expect(level.width).toBeGreaterThanOrEqual(1);
            expect(level.height).toBeGreaterThanOrEqual(1);
        }
    });

    it("сохраняет вес прохода", () => {
        const levels = bloomPyramid(320, 180, passes, 0.16);
        expect(levels.map((level) => level.alpha).sort()).toEqual([0.42, 0.52, 0.62].sort());
    });

    it("без проходов не строит ничего", () => {
        expect(bloomPyramid(160, 90, [], 0.16)).toEqual([]);
    });

    it("на пустом буфере не строит ничего", () => {
        expect(bloomPyramid(0, 0, passes, 0.16)).toEqual([]);
    });

    it("сводит проходы, попавшие на один уровень, в один", () => {
        const levels = bloomPyramid(
            160,
            96,
            [
                { blur: 4, alpha: 0.3 },
                { blur: 4.2, alpha: 0.2 }
            ],
            0.16
        );
        expect(levels).toHaveLength(1);
        expect(levels[0]!.alpha).toBeCloseTo(0.5, 5);
    });
});
