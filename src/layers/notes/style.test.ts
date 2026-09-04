import { describe, expect, it } from "vitest";
import { NoteBars, NoteStyle } from "./style";
import { Quality } from "../../core/Quality";

function styleAt(level: "high" | "medium" | "low"): NoteStyle {
    const style = new NoteStyle();
    const quality = new Quality();
    quality.setMode(level);
    style.useQuality(quality);
    return style;
}

describe("NoteStyle: ровная заливка", () => {
    it("на высокой ступени тело ноты остаётся с поперечным градиентом", () => {
        expect(styleAt("high").flatFill).toBe(false);
    });

    it("на низкой ступени заливка ровная", () => {
        // Растеризация градиента считает интерполяцию на каждый пиксель;
        // на машине без ускорения холста это дороже всей остальной ноты.
        expect(styleAt("low").flatFill).toBe(true);
    });

    it("без сведений о качестве рисуем в полную силу", () => {
        expect(new NoteStyle().flatFill).toBe(false);
    });
});

describe("NoteBars", () => {
    it("после сброса выдаёт те же полосы, а не новые", () => {
        const bars = new NoteBars();
        const first = bars.take();
        bars.clear();
        expect(bars.take()).toBe(first);
    });

    it("длина считает только взятые в этом кадре", () => {
        const bars = new NoteBars();
        bars.take();
        bars.take();
        expect(bars.length).toBe(2);

        bars.clear();
        expect(bars.length).toBe(0);
        bars.take();
        expect(bars.length).toBe(1);
    });

    it("отдаёт полосы по порядку взятия", () => {
        const bars = new NoteBars();
        bars.take().x = 10;
        bars.take().x = 20;
        expect([bars.at(0).x, bars.at(1).x]).toEqual([10, 20]);
    });

    it("растёт под кадр, где нот больше", () => {
        const bars = new NoteBars();
        bars.take();
        bars.clear();
        bars.take();
        bars.take();
        expect(bars.length).toBe(2);
    });
});
