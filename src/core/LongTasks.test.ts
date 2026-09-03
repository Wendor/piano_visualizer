import { describe, expect, it } from "vitest";
import { LongTasks } from "./LongTasks";

/** Наблюдатель под управлением теста вместо браузерного. */
function fake(): { tasks: LongTasks; report: (ms: number, at: number) => void } {
    let emit: (ms: number, at: number) => void = () => {};
    const tasks = new LongTasks((listener) => {
        emit = listener;
        return () => {};
    });
    return { tasks, report: (ms, at) => emit(ms, at) };
}

describe("LongTasks", () => {
    it("на чистой сцене молчит", () => {
        const { tasks } = fake();
        expect(tasks.count).toBe(0);
        expect(tasks.worst).toBe(0);
    });

    it("запоминает самую долгую блокировку", () => {
        const { tasks, report } = fake();
        report(80, 1000);
        report(120, 1200);
        report(60, 1400);
        expect(tasks.count).toBe(3);
        expect(tasks.worst).toBe(120);
    });

    it("забывает то, что было давно: жалуемся на сейчас, а не на загрузку", () => {
        const { tasks, report } = fake();
        report(200, 1000);
        tasks.forget(1000 + 11_000);
        expect(tasks.count).toBe(0);
        expect(tasks.worst).toBe(0);
    });

    it("недавнее держит", () => {
        const { tasks, report } = fake();
        report(200, 5000);
        tasks.forget(6000);
        expect(tasks.count).toBe(1);
    });

    it("отписывается", () => {
        let stopped = false;
        const tasks = new LongTasks(() => () => {
            stopped = true;
        });
        tasks.dispose();
        expect(stopped).toBe(true);
    });

    it("живёт там, где браузер о таких задачах не рассказывает", () => {
        // Safari про длинные задачи молчит — счётчик не должен ломаться.
        const tasks = new LongTasks(() => null);
        expect(tasks.count).toBe(0);
        expect(() => tasks.dispose()).not.toThrow();
    });
});
