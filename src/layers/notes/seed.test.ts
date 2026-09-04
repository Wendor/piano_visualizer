import { describe, expect, it } from "vitest";
import { Scene } from "../../core/Scene";
import { makeScore } from "../../score/types";
import { NoteStyle, seedOf } from "./style";
import type { NoteBar } from "./style";
import type { Painter } from "../../paint/Painter";
import { RisingNotesLayer } from "./RisingNotesLayer";
import { FallingNotesLayer } from "./FallingNotesLayer";

/** Вместо рисования запоминает ноты, которые слой ему отдал. */
class Recorder extends NoteStyle {
    readonly seen: NoteBar[] = [];

    override draw(_p: Painter, _theme: never, bar: NoteBar): void {
        this.seen.push(bar);
    }

    override drawGlow(): void {}
}

const canvas = {} as Painter;

function ready(): Scene {
    const scene = new Scene();
    scene.resize({ width: 1280, height: 720, dpr: 1 });
    return scene;
}

/** Прогнать слой и забрать ноты, которые он собрал. */
function bars(layer: RisingNotesLayer | FallingNotesLayer, style: Recorder, scene: Scene): NoteBar[] {
    style.seen.length = 0;
    layer.update(scene, 1 / 60);
    layer.draw(canvas, scene);
    return [...style.seen];
}

describe("зерно ноты", () => {
    it("лежит в пределах доли", () => {
        for (let i = 0; i < 200; i++) {
            const seed = seedOf(i);
            expect(seed).toBeGreaterThanOrEqual(0);
            expect(seed).toBeLessThan(1);
        }
    });

    it("для одного номера всегда одно", () => {
        expect(seedOf(17)).toBe(seedOf(17));
    });

    it("шестьдесят четыре подряд ложатся вразброс, а не лесенкой", () => {
        const sorted = Array.from({ length: 64 }, (_, i) => seedOf(i)).sort((a, b) => a - b);
        let smallest = 1;
        for (let i = 1; i < sorted.length; i++) smallest = Math.min(smallest, sorted[i]! - sorted[i - 1]!);
        expect(smallest).toBeGreaterThan(0.005);
    });
});

describe("растущие ноты", () => {
    it("две ноты одной высоты получают разные зёрна", () => {
        const scene = ready();
        const style = new Recorder();
        const layer = new RisingNotesLayer(style);
        layer.init(scene);

        scene.noteOn(60, 100);
        scene.advance(0.2);
        scene.noteOff(60);
        scene.advance(0.2);
        scene.noteOn(60, 100);
        scene.advance(0.2);

        const seeds = bars(layer, style, scene).map((bar) => bar.seed);
        expect(seeds).toHaveLength(2);
        expect(seeds[0]).not.toBe(seeds[1]);
    });

    it("зерно ноты не меняется между кадрами", () => {
        const scene = ready();
        const style = new Recorder();
        const layer = new RisingNotesLayer(style);
        layer.init(scene);

        scene.noteOn(60, 100);
        scene.advance(0.2);
        const first = bars(layer, style, scene)[0]!.seed;
        scene.advance(0.2);
        const second = bars(layer, style, scene)[0]!.seed;

        expect(second).toBe(first);
    });
});

describe("падающие ноты", () => {
    const score = makeScore(
        "seeds.mid",
        [
            { midi: 60, velocity: 90, start: 1, end: 1.4, part: 0 },
            { midi: 60, velocity: 90, start: 1.5, end: 1.9, part: 0 },
            { midi: 67, velocity: 90, start: 1, end: 1.4, part: 0 }
        ],
        [],
        [{ index: 0, track: 0, channel: 0, name: "Рояль", program: 0 }]
    );

    function loaded(): { scene: Scene; layer: FallingNotesLayer; style: Recorder } {
        const scene = ready();
        const style = new Recorder();
        const layer = new FallingNotesLayer(style);
        scene.playback.load(score, scene);
        return { scene, layer, style };
    }

    it("у всех нот партитуры зёрна разные", () => {
        const { scene, layer, style } = loaded();
        scene.playback.seek(0.9, scene);

        const seeds = bars(layer, style, scene).map((bar) => bar.seed);
        expect(seeds).toHaveLength(3);
        expect(new Set(seeds).size).toBe(3);
    });

    it("зерно ноты переживает перемотку", () => {
        const { scene, layer, style } = loaded();
        scene.playback.seek(0.9, scene);
        const before = bars(layer, style, scene).map((bar) => bar.seed);

        scene.playback.seek(0.2, scene);
        scene.playback.seek(0.9, scene);
        const after = bars(layer, style, scene).map((bar) => bar.seed);

        expect(after).toEqual(before);
    });
});
