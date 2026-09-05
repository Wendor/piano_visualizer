import { describe as suite, expect, it } from "vitest";
import { hsla, tint, TRANSPARENT } from "./Tint";

/** Доли красного, зелёного и синего с точностью, которой хватает глазу. */
const rgb = (value: { r: number; g: number; b: number }): number[] =>
    [value.r, value.g, value.b].map((part) => Math.round(part * 255));

suite("цвет", () => {
    it("понимает шестнадцатеричную запись", () => {
        expect(rgb(tint("#ff8000"))).toEqual([255, 128, 0]);
        expect(tint("#ff8000").a).toBe(1);
    });

    it("понимает короткую шестнадцатеричную", () => {
        expect(rgb(tint("#f80"))).toEqual([255, 136, 0]);
    });

    it("понимает rgba", () => {
        const value = tint("rgba(12, 16, 24, 0.5)");
        expect(rgb(value)).toEqual([12, 16, 24]);
        expect(value.a).toBe(0.5);
    });

    it("понимает hsla", () => {
        const value = tint("hsla(0, 100%, 50%, 0.25)");
        expect(rgb(value)).toEqual([255, 0, 0]);
        expect(value.a).toBe(0.25);
    });

    it("держит строку нетронутой: холст получит ровно то, что дали", () => {
        expect(tint("rgba(1, 2, 3, 0.7)").css).toBe("rgba(1, 2, 3, 0.7)");
    });

    it("отдаёт один и тот же цвет на одну и ту же строку", () => {
        // На этом стоит весь кэш: цвет ищут по нему самому, а не по строке.
        expect(tint("#123456")).toBe(tint("#123456"));
    });

    it("не роняет кадр на непонятной строке", () => {
        const value = tint("совершенно не цвет");
        expect(value.a).toBe(1);
        expect(Number.isFinite(value.r)).toBe(true);
    });

    it("собирает цвет по тону так же, как его пишет холст", () => {
        const value = hsla(210.5, 60, 50, 0.8);
        expect(value.css).toBe("hsla(210.5, 60%, 50%, 0.8)");
        expect(value.a).toBe(0.8);
    });

    it("прозрачный не тянет за собой цвет", () => {
        expect(TRANSPARENT.a).toBe(0);
    });
});
