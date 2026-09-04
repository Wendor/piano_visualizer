import { describe, expect, it } from "vitest";
import { Trial } from "./Trial";

/** Проехать дорогу столько раз, сколько просят, с одинаковой ценой. */
function drive(trial: Trial<string>, times: number, ms: number): void {
    for (let i = 0; i < times; i++) trial.sample(ms);
}

describe("Trial", () => {
    it("сначала идёт первой дорогой", () => {
        expect(new Trial(["pyramid", "filter"], 2, 3).road).toBe("pyramid");
    });

    it("разогрев не идёт в счёт", () => {
        const trial = new Trial(["pyramid", "filter"], 2, 3);
        // Два первых проезда — разогрев, значит отрезок кончится только на пятом.
        drive(trial, 4, 10);
        expect(trial.road).toBe("pyramid");
        trial.sample(10);
        expect(trial.road).toBe("filter");
    });

    it("остаётся на дешёвой дороге", () => {
        const trial = new Trial(["pyramid", "filter"], 1, 3);
        drive(trial, 4, 50);
        drive(trial, 4, 2);
        expect(trial.done).toBe(true);
        expect(trial.road).toBe("filter");
    });

    it("случайный всплеск решения не меняет", () => {
        const trial = new Trial(["pyramid", "filter"], 0, 5);
        // Пирамида дешевле, но один её проезд поймал чужую задержку.
        trial.sample(300);
        drive(trial, 4, 1);
        drive(trial, 5, 10);
        expect(trial.road).toBe("pyramid");
    });

    it("после выбора часы больше не нужны", () => {
        const trial = new Trial(["pyramid", "filter"], 0, 2);
        drive(trial, 2, 1);
        drive(trial, 2, 50);
        expect(trial.road).toBe("pyramid");

        drive(trial, 20, 500);
        expect(trial.road).toBe("pyramid");
    });

    it("перезапуск начинает с первой дороги и забывает замеры", () => {
        const trial = new Trial(["pyramid", "filter"], 0, 3);
        drive(trial, 3, 50);
        expect(trial.road).toBe("filter");

        trial.restart();
        expect(trial.road).toBe("pyramid");
        // Замеры прошлого размера забыты: теперь пирамида дешевле, и она победит.
        drive(trial, 3, 1);
        drive(trial, 3, 9);
        expect(trial.road).toBe("pyramid");
    });

    it("сделанный выбор перезапуск не отменяет", () => {
        const trial = new Trial(["pyramid", "filter"], 0, 2);
        drive(trial, 2, 9);
        drive(trial, 2, 1);
        expect(trial.road).toBe("filter");

        trial.restart();
        expect(trial.done).toBe(true);
        expect(trial.road).toBe("filter");
    });
});
