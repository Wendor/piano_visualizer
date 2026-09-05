import { describe as suite, expect, it } from "vitest";
import { GradientBook, bucket, sample, stop } from "./Gradient";
import { tint, TRANSPARENT } from "./Tint";

const WHITE = tint("rgba(255, 255, 255, 1)");
const BLACK = tint("rgba(0, 0, 0, 1)");

/** Цвет в доле пути: четыре числа, как их видит видеочип. */
function at(stops: ReturnType<typeof stop>[], t: number): number[] {
    const out = new Float32Array(4);
    sample(stops, t, out, 0);
    return [...out].map((part) => Math.round(part * 1000) / 1000);
}

suite("книга градиентов", () => {
    it("отдаёт одно и то же описание на один и тот же ключ", () => {
        const book = new GradientBook();
        const first = book.get("свет", () => [stop(0, BLACK), stop(1, WHITE)]);
        expect(book.get("свет", () => [stop(0, WHITE), stop(1, BLACK)])).toBe(first);
    });

    it("начинает заново, когда ключей стало слишком много", () => {
        const book = new GradientBook(2);
        book.get("а", () => [stop(0, BLACK)]);
        book.get("б", () => [stop(0, BLACK)]);
        book.get("в", () => [stop(0, BLACK)]);
        expect(book.size).toBe(1);
    });

    it("округляет до шага, чтобы близкие значения делили одно описание", () => {
        expect(bucket(101, 4)).toBe(100);
        expect(bucket(103, 4)).toBe(104);
    });
});

suite("цвет градиента", () => {
    it("на краях берёт крайние точки", () => {
        const stops = [stop(0, BLACK), stop(1, WHITE)];
        expect(at(stops, 0)).toEqual([0, 0, 0, 1]);
        expect(at(stops, 1)).toEqual([1, 1, 1, 1]);
    });

    it("за краями держит крайние, а не уходит в пустоту", () => {
        const stops = [stop(0.2, BLACK), stop(0.8, WHITE)];
        expect(at(stops, 0)).toEqual([0, 0, 0, 1]);
        expect(at(stops, 1)).toEqual([1, 1, 1, 1]);
    });

    it("смешивает посередине", () => {
        expect(at([stop(0, BLACK), stop(1, WHITE)], 0.5)).toEqual([0.5, 0.5, 0.5, 1]);
    });

    it("прозрачный край не тянет за собой черноту", () => {
        // Смешивать надо цвет, уже умноженный на прозрачность: иначе по дороге
        // к прозрачному краю всё сереет, хотя гаснуть должно только свечение.
        const half = at([stop(0, WHITE), stop(1, TRANSPARENT)], 0.5);
        expect(half).toEqual([0.5, 0.5, 0.5, 0.5]);
    });

    it("уважает середину, поставленную не по центру", () => {
        const stops = [stop(0, BLACK), stop(0.25, WHITE), stop(1, BLACK)];
        expect(at(stops, 0.25)).toEqual([1, 1, 1, 1]);
        expect(at(stops, 0.125)).toEqual([0.5, 0.5, 0.5, 1]);
    });

    it("пустое описание не роняет кадр", () => {
        expect(at([], 0.5)).toEqual([0, 0, 0, 0]);
    });
});
