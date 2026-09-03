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

describe("запас истории", () => {
    it("отпущенная нота живёт запрошенное слоем время", () => {
        const scene = ready();
        scene.requestRetention("test", 2);
        scene.noteOn(60, 100);
        scene.noteOff(60);

        scene.advance(1.5);
        expect(scene.notes.length).toBe(1);

        scene.advance(1);
        expect(scene.notes.length).toBe(0);
    });

    it("зажатая нота не уходит из истории, сколько бы ни прошло", () => {
        const scene = ready();
        scene.requestRetention("test", 2);
        scene.noteOn(60, 100);

        for (let i = 0; i < 600; i++) scene.advance(1 / 60);
        expect(scene.notes.length).toBe(1);
    });

    it("запас берётся по самому жадному слою", () => {
        const scene = ready();
        scene.requestRetention("short", 2);
        scene.requestRetention("long", 6);
        scene.noteOn(60, 100);
        scene.noteOff(60);

        scene.advance(4);
        expect(scene.notes.length).toBe(1);
    });

    it("уборка не роняет сцену на длинной истории", () => {
        const scene = ready();
        scene.requestRetention("test", 2);

        scene.advance(2.4);
        scene.noteOn(60, 100); // одинокая нота, которая выйдет из запаса первой
        scene.noteOff(60);
        scene.advance(0.1);

        for (let i = 0; i < 130_000; i++) {
            scene.noteOn(60 + (i % 24), 100);
            scene.noteOff(60 + (i % 24));
        }

        // Запас перешагнул одинокую ноту, но не догнал остальные: уборка
        // должна оставить всю сотню тысяч.
        expect(() => scene.advance(1.95)).not.toThrow();
        expect(scene.notes.length).toBe(130_000);
    });
});
