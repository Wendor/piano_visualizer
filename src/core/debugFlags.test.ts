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
});
