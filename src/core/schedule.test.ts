import { describe, expect, it } from "vitest";
import { coalesce } from "./schedule";

/** Ручной планировщик вместо кадров браузера. */
function frames(): { schedule: (run: () => void) => void; flush: () => void } {
    let pending: Array<() => void> = [];
    return {
        schedule: (run) => void pending.push(run),
        flush: () => {
            const list = pending;
            pending = [];
            for (const run of list) run();
        }
    };
}

describe("склейка вызовов", () => {
    it("серия вызовов до кадра складывается в один запуск", () => {
        const { schedule, flush } = frames();
        let runs = 0;
        const ask = coalesce(() => runs++, schedule);

        ask();
        ask();
        ask();
        expect(runs).toBe(0); // до кадра не выполняется ничего

        flush();
        expect(runs).toBe(1);
    });

    it("после кадра снова можно запланировать", () => {
        const { schedule, flush } = frames();
        let runs = 0;
        const ask = coalesce(() => runs++, schedule);

        ask();
        flush();
        ask();
        flush();

        expect(runs).toBe(2);
    });

    it("без вызовов ничего не запускается", () => {
        const { schedule, flush } = frames();
        let runs = 0;
        coalesce(() => runs++, schedule);

        flush();
        expect(runs).toBe(0);
    });
});
