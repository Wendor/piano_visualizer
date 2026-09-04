import { describe, expect, it } from "vitest";
import { FrameProfiler } from "./FrameProfiler";

/** Часы под управлением теста: замер не должен зависеть от реальной машины. */
function clock(): { now: () => number; advance: (ms: number) => void } {
    let value = 0;
    return { now: () => value, advance: (ms) => void (value += ms) };
}

describe("FrameProfiler", () => {
    it("выключенный не замеряет, но работу выполняет", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);
        let ran = false;

        profiler.measure("bloom", () => {
            ran = true;
            time.advance(10);
        });
        profiler.endFrame();

        expect(ran).toBe(true);
        expect(profiler.rows()).toEqual([]);
    });

    it("показывает время участка после первого же кадра", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);
        profiler.setEnabled(true);

        profiler.measure("bloom", () => time.advance(8));
        profiler.endFrame();

        expect(profiler.rows()).toEqual([{ label: "bloom", ms: 8 }]);
    });

    it("складывает повторные замеры одной метки за кадр", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);
        profiler.setEnabled(true);

        profiler.measure("notes", () => time.advance(3));
        profiler.measure("notes", () => time.advance(4));
        profiler.endFrame();

        expect(profiler.rows()).toEqual([{ label: "notes", ms: 7 }]);
    });

    it("ставит самый дорогой участок первым", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);
        profiler.setEnabled(true);

        profiler.measure("dust", () => time.advance(1));
        profiler.measure("bloom", () => time.advance(9));
        profiler.measure("keyboard", () => time.advance(4));
        profiler.endFrame();

        expect(profiler.rows().map((row) => row.label)).toEqual(["bloom", "keyboard", "dust"]);
    });

    it("сглаживает скачок одного кадра", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);
        profiler.setEnabled(true);

        profiler.measure("bloom", () => time.advance(4));
        profiler.endFrame();
        profiler.measure("bloom", () => time.advance(40));
        profiler.endFrame();

        const ms = profiler.rows()[0]!.ms;
        expect(ms).toBeGreaterThan(4);
        expect(ms).toBeLessThan(20);
    });

    it("забывает метку, которая перестала встречаться", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);
        profiler.setEnabled(true);

        profiler.measure("sparks", () => time.advance(5));
        profiler.endFrame();
        expect(profiler.rows()).toHaveLength(1);

        // Метка уходит не мгновенно: работа, идущая реже кадра, из отчёта
        // выпадать не должна.
        for (let i = 0; i < 40; i++) {
            profiler.measure("bloom", () => time.advance(5));
            profiler.endFrame();
        }

        expect(profiler.rows().map((row) => row.label)).toEqual(["bloom"]);
    });

    it("работа реже кадра остаётся в отчёте, но средним по кадрам", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);
        profiler.setEnabled(true);

        // Свечение обновляется через кадр: в отчёте должна стоять его доля в
        // среднем кадре, иначе сумма строк не сойдётся со временем кадра.
        for (let i = 0; i < 60; i++) {
            if (i % 2 === 0) profiler.measure("glow", () => time.advance(10));
            profiler.endFrame();
        }

        const row = profiler.rows()[0]!;
        expect(row.label).toBe("glow");
        expect(row.ms).toBeGreaterThan(3);
        expect(row.ms).toBeLessThan(7);
    });

    it("возвращает результат измеряемой работы", () => {
        const profiler = new FrameProfiler(clock().now);
        profiler.setEnabled(true);
        expect(profiler.measure("x", () => 42)).toBe(42);
    });

    it("не копит замеры, пока выключен, и начинает с чистого листа", () => {
        const time = clock();
        const profiler = new FrameProfiler(time.now);

        profiler.measure("bloom", () => time.advance(100));
        profiler.endFrame();
        profiler.setEnabled(true);
        profiler.measure("bloom", () => time.advance(2));
        profiler.endFrame();

        expect(profiler.rows()).toEqual([{ label: "bloom", ms: 2 }]);
    });
});
