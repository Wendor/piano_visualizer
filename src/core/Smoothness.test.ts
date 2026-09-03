import { describe, expect, it } from "vitest";
import { Smoothness } from "./Smoothness";

/** Скормить подряд одинаковые кадры. */
function feed(smoothness: Smoothness, frameMs: number, count: number): void {
    for (let i = 0; i < count; i++) smoothness.sample(frameMs);
}

describe("Smoothness", () => {
    it("ровные кадры рывков не дают", () => {
        const smoothness = new Smoothness();
        feed(smoothness, 16.7, 120);
        expect(smoothness.stalls).toBe(0);
    });

    it("ровные кадры на быстром экране тоже не рывки", () => {
        // 120 Гц: кадр вдвое короче, и сам по себе это не повод жаловаться.
        const smoothness = new Smoothness();
        feed(smoothness, 8.3, 120);
        expect(smoothness.stalls).toBe(0);
    });

    it("замечает одиночный долгий кадр среди ровных", () => {
        const smoothness = new Smoothness();
        feed(smoothness, 16.7, 60);
        smoothness.sample(50);
        feed(smoothness, 16.7, 10);
        expect(smoothness.stalls).toBe(1);
        expect(smoothness.worst).toBe(50);
    });

    it("рваный ход ловится, даже когда кадров в секунду много", () => {
        // Ровно то, что видно на телефоне: экран просит 120 Гц, сцена его не
        // держит, среднее выходит красивым, а глаз видит рывки.
        const smoothness = new Smoothness();
        for (let i = 0; i < 60; i++) {
            smoothness.sample(8.3);
            smoothness.sample(8.3);
            smoothness.sample(30);
        }
        expect(smoothness.stalls).toBeGreaterThan(20);
        expect(smoothness.fps).toBeGreaterThan(60);
    });

    it("забывает то, что вышло из окна", () => {
        const smoothness = new Smoothness(60);
        smoothness.sample(90);
        feed(smoothness, 16.7, 60);
        expect(smoothness.stalls).toBe(0);
        expect(smoothness.worst).toBeLessThan(90);
    });

    it("не считает рывком возвращение из фона", () => {
        // Вкладку свернули на минуту — это не рывок отрисовки.
        const smoothness = new Smoothness();
        feed(smoothness, 16.7, 60);
        smoothness.sample(60_000);
        expect(smoothness.stalls).toBe(0);
    });

    it("на пустом счётчике не делит на ноль", () => {
        const smoothness = new Smoothness();
        expect(smoothness.stalls).toBe(0);
        expect(smoothness.worst).toBe(0);
        expect(Number.isFinite(smoothness.fps)).toBe(true);
    });

    it("сбрасывается вместе со сценой", () => {
        const smoothness = new Smoothness();
        feed(smoothness, 16.7, 30);
        smoothness.sample(80);
        smoothness.reset();
        expect(smoothness.stalls).toBe(0);
        expect(smoothness.worst).toBe(0);
    });
});
