import { describe, expect, it } from "vitest";
import { NoteStyle } from "./style";
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
