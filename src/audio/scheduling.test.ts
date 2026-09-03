import { describe, expect, it } from "vitest";
import { LOOKAHEAD, startAt } from "./scheduling";

describe("когда начинать голос", () => {
    it("живая нота начинается немедленно", () => {
        expect(startAt(10, null)).toBe(10);
    });

    it("ноты файла расходятся ровно на разницу своих возрастов", () => {
        // Главное свойство: дрожь кадра не должна доезжать до звука.
        const first = startAt(10, 0.008);
        const second = startAt(10, 0.004);
        expect(second - first).toBeCloseTo(0.004, 10);
    });

    it("нота с конца кадра уходит вперёд на всё упреждение", () => {
        expect(startAt(10, 0)).toBeCloseTo(10 + LOOKAHEAD, 10);
    });

    it("возраст больше упреждения не уводит старт в прошлое", () => {
        expect(startAt(10, LOOKAHEAD + 0.2)).toBe(10);
    });
});
