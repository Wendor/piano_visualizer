import { describe, expect, it } from "vitest";
import { fillImpulse } from "./impulse";

function make(length: number): [Float32Array, Float32Array] {
    return [new Float32Array(length), new Float32Array(length)];
}

/** Громкость участка: по ней видно огибающую затухания. */
function energy(data: Float32Array, from: number, to: number): number {
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
    return sum / (to - from);
}

describe("fillImpulse", () => {
    it("заполняет оба канала целиком", () => {
        const [left, right] = make(1000);
        fillImpulse(left, right);
        expect(left.some((value) => value !== 0)).toBe(true);
        expect(right.some((value) => value !== 0)).toBe(true);
    });

    it("затухает: начало громче конца", () => {
        const [left, right] = make(4000);
        fillImpulse(left, right);
        expect(energy(left, 0, 400)).toBeGreaterThan(energy(left, 3600, 4000) * 100);
    });

    it("затухает без ступеней: каждая треть тише предыдущей", () => {
        const [left, right] = make(3000);
        fillImpulse(left, right);
        const first = energy(left, 0, 1000);
        const second = energy(left, 1000, 2000);
        const third = energy(left, 2000, 3000);
        expect(second).toBeLessThan(first);
        expect(third).toBeLessThan(second);
    });

    it("хвост уходит в тишину", () => {
        const [left, right] = make(4000);
        fillImpulse(left, right);
        // К концу отражения должны стать неслышными, иначе свёртка звенит.
        expect(Math.max(...left.slice(3950))).toBeLessThan(0.01);
    });

    it("каналы не совпадают: зал должен быть широким", () => {
        const [left, right] = make(2000);
        fillImpulse(left, right);
        expect(left.some((value, i) => value !== right[i])).toBe(true);
    });

    it("не выходит за пределы допустимого сигнала", () => {
        const [left, right] = make(2000);
        fillImpulse(left, right);
        for (const data of [left, right]) {
            for (const value of data) expect(Math.abs(value)).toBeLessThanOrEqual(1);
        }
    });

    it("переживает пустой буфер", () => {
        const [left, right] = make(0);
        expect(() => fillImpulse(left, right)).not.toThrow();
    });
});
