import { describe, expect, it } from "vitest";
import { Scene } from "./Scene";

function ready(): Scene {
    const scene = new Scene();
    scene.resize({ width: 1280, height: 720, dpr: 1 });
    return scene;
}

describe("энергия сцены", () => {
    it("растёт от нот, но каждая следующая добавляет меньше", () => {
        const scene = ready();
        scene.noteOn(60, 100);
        const first = scene.energy;
        scene.noteOn(64, 100);
        const second = scene.energy - first;
        scene.noteOn(67, 100);
        const third = scene.energy - first - second;

        expect(first).toBeGreaterThan(0);
        expect(third).toBeLessThan(second);
        expect(scene.energy).toBeLessThan(1);
    });

    it("плотная игра не упирает энергию в единицу", () => {
        const scene = ready();
        for (let i = 0; i < 40; i++) scene.noteOn(40 + (i % 40), 127);
        expect(scene.energy).toBeLessThan(1);
    });

    it("держится, пока клавиши зажаты, и гаснет в тишине", () => {
        const scene = ready();
        for (const midi of [60, 64, 67, 71, 74, 77]) scene.noteOn(midi, 90);
        for (let i = 0; i < 120; i++) scene.advance(1 / 60);
        // Шесть зажатых клавиш держат энергию на уровне «звучит аккорд».
        expect(scene.energy).toBeGreaterThan(0.4);

        scene.panic();
        for (let i = 0; i < 300; i++) scene.advance(1 / 60);
        expect(scene.energy).toBeLessThan(0.05);
    });
});
