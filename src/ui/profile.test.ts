import { describe, expect, it } from "vitest";
import { profileLines } from "./profile";

describe("profileLines", () => {
    it("показывает время и долю кадра, дорогое сверху", () => {
        expect(
            profileLines([
                { label: "effects.bloom", ms: 6 },
                { label: "effects.dust", ms: 2 }
            ])
        ).toEqual(["effects.bloom · 6.0 мс · 75%", "effects.dust · 2.0 мс · 25%"]);
    });

    it("молчит, когда замеров нет", () => {
        expect(profileLines([])).toEqual([]);
    });

    it("переживает кадр, в котором всё уложилось в ноль", () => {
        expect(profileLines([{ label: "keyboard", ms: 0 }])).toEqual(["keyboard · 0.0 мс · 0%"]);
    });

    it("показывает стек слоёв целиком: их дюжина, и дешёвые тоже важны", () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({ label: `layer${i}`, ms: 12 - i }));
        expect(profileLines(rows)).toHaveLength(12);
    });

    it("не растёт бесконечно: длинный хвост обрезается", () => {
        const rows = Array.from({ length: 40 }, (_, i) => ({ label: `layer${i}`, ms: 40 - i }));
        const lines = profileLines(rows);
        expect(lines.length).toBeLessThanOrEqual(14);
        expect(lines[0]).toContain("layer0");
    });
});
