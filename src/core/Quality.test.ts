import { describe, expect, it } from "vitest";
import { Quality } from "./Quality";

/** Прогнать несколько секунд одинаковых кадров: работа и промежуток. */
function run(quality: Quality, workMs: number, frameMs: number, seconds: number): void {
    const dt = frameMs / 1000;
    for (let i = 0; i < Math.ceil(seconds / dt); i++) quality.sample(workMs, frameMs, dt);
}

describe("Quality", () => {
    it("по умолчанию авто на высокой ступени", () => {
        const quality = new Quality();
        expect(quality.mode).toBe("auto");
        expect(quality.level).toBe("high");
        expect(quality.profile.renderScale).toBe(1);
    });

    it("опускает ступень, когда кадры стабильно долгие", () => {
        const quality = new Quality();
        const seen: string[] = [];
        quality.events.on("change", ({ level }) => seen.push(level));

        run(quality, 20, 40, 3);
        expect(quality.level).toBe("medium");
        // Сразу после смены — пауза: холст и кэши перестраиваются.
        expect(seen).toEqual(["medium"]);

        run(quality, 20, 40, 5);
        expect(quality.level).toBe("low");
        expect(quality.profile.renderScale).toBeLessThan(1);
    });

    it("не опускает ниже низкой ступени", () => {
        const quality = new Quality();
        run(quality, 30, 60, 30);
        expect(quality.level).toBe("low");
    });

    it("возвращает ступень, когда появился запас", () => {
        const quality = new Quality();
        run(quality, 20, 40, 3);
        expect(quality.level).toBe("medium");

        run(quality, 3, 16.7, 12);
        expect(quality.level).toBe("high");
    });

    it("вертикальная синхронизация не мешает поднять ступень", () => {
        const quality = new Quality();
        run(quality, 20, 40, 3);
        expect(quality.level).toBe("medium");
        // Кадры идут ровно по 16.7 мс — по промежутку запаса не видно,
        // но работы в кадре мало, значит ступень можно вернуть.
        run(quality, 4, 16.7, 12);
        expect(quality.level).toBe("high");
    });

    it("длинный кадр из фоновой вкладки не считается тормозом", () => {
        const quality = new Quality();
        for (let i = 0; i < 60; i++) quality.sample(5, 4000, 0.05);
        expect(quality.level).toBe("high");
    });

    it("ручной режим не двигает ступень сам", () => {
        const quality = new Quality();
        quality.setMode("medium");
        expect(quality.level).toBe("medium");
        run(quality, 30, 60, 20);
        expect(quality.level).toBe("medium");
        expect(quality.title).toBe("среднее");
    });
});
