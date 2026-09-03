import { describe, expect, it } from "vitest";
import { canvasSize, resolveViewport } from "./viewport";

/** Ноутбук с Retina: холст 2880×1800 и запас производительности. */
const RETINA = { width: 1440, height: 900, devicePixelRatio: 2, maxDpr: 2 };
/** Телевизор на 4K: плотность единичная, а пикселей вчетверо больше. */
const TV_4K = { width: 3840, height: 2160, devicePixelRatio: 1, maxDpr: 2 };

describe("resolveViewport", () => {
    it("на обычном экране берёт devicePixelRatio как есть", () => {
        const view = resolveViewport({ ...RETINA, renderScale: 1, maxPixels: 6_000_000 });
        expect(view).toEqual({ width: 1440, height: 900, dpr: 2 });
    });

    it("срезает devicePixelRatio до потолка", () => {
        const view = resolveViewport({
            width: 400,
            height: 800,
            devicePixelRatio: 3,
            maxDpr: 2,
            renderScale: 1,
            maxPixels: 6_000_000
        });
        expect(view.dpr).toBe(2);
    });

    it("умножает на ступень качества", () => {
        const view = resolveViewport({ ...RETINA, renderScale: 0.5, maxPixels: 6_000_000 });
        expect(view.dpr).toBe(1);
    });

    it("держит площадь холста в потолке на 4K-телевизоре", () => {
        const view = resolveViewport({ ...TV_4K, renderScale: 1, maxPixels: 2_000_000 });
        // CSS-размер прежний: браузер растянет картинку при выводе.
        expect(view.width).toBe(3840);
        expect(view.height).toBe(2160);
        const size = canvasSize(view);
        expect(size.width * size.height).toBeLessThanOrEqual(2_000_000);
    });

    it("не растягивает холст сверх devicePixelRatio ради потолка", () => {
        const view = resolveViewport({
            width: 800,
            height: 600,
            devicePixelRatio: 1,
            maxDpr: 2,
            renderScale: 1,
            maxPixels: 6_000_000
        });
        expect(view.dpr).toBe(1);
    });

    it("не опускает холст ниже различимого при абсурдном потолке", () => {
        const view = resolveViewport({
            width: 1920,
            height: 1080,
            devicePixelRatio: 1,
            maxDpr: 2,
            renderScale: 1,
            maxPixels: 1
        });
        expect(view.dpr).toBeGreaterThanOrEqual(0.25);
    });

    it("переживает нулевое окно", () => {
        const view = resolveViewport({
            width: 0,
            height: 0,
            devicePixelRatio: 2,
            maxDpr: 2,
            renderScale: 1,
            maxPixels: 6_000_000
        });
        expect(Number.isFinite(view.dpr)).toBe(true);
        expect(view.dpr).toBeGreaterThan(0);
    });
});

describe("canvasSize", () => {
    it("не даёт вырожденного холста на нулевом окне", () => {
        expect(canvasSize({ width: 0, height: 0, dpr: 1 })).toEqual({ width: 1, height: 1 });
    });
});
