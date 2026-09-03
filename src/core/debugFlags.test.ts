import { describe, expect, it } from "vitest";
import { parseDebugFlags } from "./debugFlags";

describe("parseDebugFlags", () => {
    it("без параметров ничего не включает", () => {
        expect(parseDebugFlags("")).toEqual({});
    });

    it("включает разбор кадра", () => {
        expect(parseDebugFlags("?profile=1")).toEqual({ profile: true });
    });

    it("понимает флаг без значения: с пульта короче набирать", () => {
        expect(parseDebugFlags("?profile")).toEqual({ profile: true });
    });

    it("выключает разбор явным нулём", () => {
        expect(parseDebugFlags("?profile=0")).toEqual({ profile: false });
    });

    it("задаёт ступень качества", () => {
        expect(parseDebugFlags("?quality=low")).toEqual({ quality: "low" });
    });

    it("пропускает ступень, которой нет", () => {
        expect(parseDebugFlags("?quality=ultra")).toEqual({});
    });

    it("читает оба параметра сразу", () => {
        expect(parseDebugFlags("?profile=1&quality=medium")).toEqual({ profile: true, quality: "medium" });
    });

    it("переживает мусор в строке запроса", () => {
        expect(parseDebugFlags("?=&&%")).toEqual({});
    });

    it("выключает названный слой", () => {
        expect(parseDebugFlags("?off=effects.bloom")).toEqual({ off: ["effects.bloom"] });
    });

    it("выключает несколько слоёв через запятую", () => {
        expect(parseDebugFlags("?off=effects.bloom,effects.dust")).toEqual({
            off: ["effects.bloom", "effects.dust"]
        });
    });

    it("не спотыкается о пробелы и пустые куски: с пульта набирают как придётся", () => {
        expect(parseDebugFlags("?off=effects.bloom, ,effects.dust,")).toEqual({
            off: ["effects.bloom", "effects.dust"]
        });
    });

    it("пустой список слоёв — это не список", () => {
        expect(parseDebugFlags("?off=")).toEqual({});
    });

    it("читает подмену настройки", () => {
        expect(parseDebugFlags("?set=notes.style/roundness=0")).toEqual({
            set: [["notes.style/roundness", "0"]]
        });
    });

    it("читает несколько подмен через запятую", () => {
        expect(parseDebugFlags("?set=notes.style/roundness=0,effects.bloom/strength=0.5")).toEqual({
            set: [
                ["notes.style/roundness", "0"],
                ["effects.bloom/strength", "0.5"]
            ]
        });
    });

    it("пропускает подмену без значения", () => {
        expect(parseDebugFlags("?set=notes.style/roundness")).toEqual({});
    });

    it("пустая подмена — это не подмена", () => {
        expect(parseDebugFlags("?set=")).toEqual({});
    });
});
