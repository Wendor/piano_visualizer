import { describe, expect, it } from "vitest";
import { Cadence } from "./Cadence";

/** Сколько раз работа случилась за секунду кадров длиной `frameMs`. */
function perSecond(cadence: Cadence, frameMs: number): number {
    let done = 0;
    for (let i = 0; i < Math.round(1000 / frameMs); i++) if (cadence.due(frameMs / 1000)) done++;
    return done;
}

describe("Cadence", () => {
    it("первый кадр не ждёт", () => {
        expect(new Cadence(40).due(0.001)).toBe(true);
    });

    it("на быстром экране пропускает кадры, но держит заданную частоту", () => {
        // 60 Гц: период 25 мс не укладывается в кадр 16.7 мс, работа идёт через кадр.
        expect(perSecond(new Cadence(40), 1000 / 60)).toBe(30);
    });

    it("на очень быстром экране пропускает больше", () => {
        expect(perSecond(new Cadence(40), 1000 / 120)).toBeLessThan(45);
    });

    it("на медленной машине работает каждый кадр", () => {
        // Кадры по 170 мс: ждать с ними нечего, иначе свечение будет отставать.
        const cadence = new Cadence(40);
        expect(perSecond(cadence, 170)).toBe(Math.round(1000 / 170));
    });

    it("после force работа случается в ближайшем кадре", () => {
        const cadence = new Cadence(40);
        cadence.due(1);
        expect(cadence.due(0.001)).toBe(false);
        cadence.force();
        expect(cadence.due(0.001)).toBe(true);
    });
});
