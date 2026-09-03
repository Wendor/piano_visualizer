import { describe as suite, expect, it, vi } from "vitest";
import { Playback } from "./Playback";
import type { NoteSink } from "./Playback";
import { Transport } from "./Transport";
import { makeScore } from "./types";

/** Запоминает всё, что плеер отдал сцене. */
class Sink implements NoteSink {
    readonly calls: string[] = [];
    readonly held = new Set<number>();
    sustain = false;

    noteOn(midi: number, velocity: number): void {
        this.calls.push(`on:${midi}:${velocity}`);
        this.held.add(midi);
    }
    noteOff(midi: number): void {
        this.calls.push(`off:${midi}`);
        this.held.delete(midi);
    }
    setSustain(on: boolean): void {
        if (this.sustain === on) return;
        this.sustain = on;
        this.calls.push(`sustain:${on ? "on" : "off"}`);
    }
    panic(): void {
        this.calls.push("panic");
        this.held.clear();
    }
}

const score = makeScore(
    "test.mid",
    [
        { midi: 60, velocity: 90, start: 0, end: 1, part: 0 },
        { midi: 64, velocity: 80, start: 0.5, end: 1.5, part: 0 },
        { midi: 67, velocity: 70, start: 2, end: 2.5, part: 1 }
    ],
    [
        { time: 0.2, on: true },
        { time: 1.8, on: false }
    ],
    [
        { index: 0, track: 0, channel: 0, name: "Рояль", program: 0 },
        { index: 1, track: 0, channel: 1, name: "Бас", program: 33 }
    ]
);

function loaded(): { playback: Playback; sink: Sink } {
    const sink = new Sink();
    const playback = new Playback();
    playback.load(score, sink);
    sink.calls.length = 0;
    return { playback, sink };
}

suite("Transport", () => {
    it("стоит, пока не запущен", () => {
        const transport = new Transport();
        transport.duration = 10;
        expect(transport.advance(1)).toBeNull();
        expect(transport.time).toBe(0);
    });

    it("идёт со своей скоростью", () => {
        const transport = new Transport();
        transport.duration = 10;
        transport.setSpeed(2);
        transport.play();
        expect(transport.advance(1)).toEqual({ from: 0, to: 2 });
        expect(transport.time).toBe(2);
    });

    it("зажимает перемотку и скорость", () => {
        const transport = new Transport();
        transport.duration = 4;
        transport.seek(99);
        expect(transport.time).toBe(4);
        transport.seek(-5);
        expect(transport.time).toBe(0);
        transport.setSpeed(17);
        expect(transport.speed).toBe(2);
        transport.setSpeed(0);
        expect(transport.speed).toBe(0.25);
    });

    it("на конце файла останавливается и сообщает об этом", () => {
        const transport = new Transport();
        transport.duration = 1;
        const ended = vi.fn();
        transport.events.on("ended", ended);
        transport.play();
        transport.advance(2);

        expect(ended).toHaveBeenCalledOnce();
        expect(transport.state).toBe("paused");
        expect(transport.time).toBe(1);
    });

    it("с включённым повтором возвращается в начало", () => {
        const transport = new Transport();
        transport.duration = 1;
        transport.loop = true;
        transport.play();
        transport.advance(2);

        expect(transport.time).toBe(0);
        expect(transport.state).toBe("playing");
    });
});

suite("Playback", () => {
    it("берёт длительность из партитуры", () => {
        const { playback } = loaded();
        expect(playback.transport.duration).toBe(2.5);
        expect(playback.loaded).toBe(true);
    });

    it("раздаёт ноты и педаль по времени", () => {
        const { playback, sink } = loaded();
        playback.transport.play();

        playback.advance(0.3, sink);
        // Внутри кадра педаль применяется раньше нот — на слух это неразличимо,
        // зато нота, гаснущая в том же кадре, отпускается уже без педали.
        expect(sink.calls).toEqual(["sustain:on", "on:60:90"]);

        sink.calls.length = 0;
        playback.advance(0.4, sink); // 0.7
        expect(sink.calls).toEqual(["on:64:80"]);

        sink.calls.length = 0;
        playback.advance(0.5, sink); // 1.2
        expect(sink.calls).toEqual(["off:60"]);

        sink.calls.length = 0;
        playback.advance(0.8, sink); // 2.0
        expect(sink.calls).toEqual(["sustain:off", "off:64", "on:67:70"]);
    });

    it("после перемотки звучит то, что должно звучать в этой точке", () => {
        const { playback, sink } = loaded();
        playback.seek(0.75, sink);

        expect(sink.calls[0]).toBe("panic");
        expect([...sink.held].sort((a, b) => a - b)).toEqual([60, 64]);
        expect(sink.sustain).toBe(true);
    });

    it("перемотка в тишину гасит всё", () => {
        const { playback, sink } = loaded();
        playback.seek(0.75, sink);
        sink.calls.length = 0;

        playback.seek(1.9, sink);
        expect(sink.held.size).toBe(0);
        expect(sink.sustain).toBe(false);
    });

    it("повтор начинает партитуру заново", () => {
        const { playback, sink } = loaded();
        playback.transport.loop = true;
        playback.transport.play();
        playback.advance(2.4, sink);
        sink.calls.length = 0;

        playback.advance(0.3, sink); // выходим за конец и заворачиваемся
        expect(playback.time).toBe(0);
        expect(sink.held.size).toBe(0);

        playback.advance(0.1, sink);
        expect(sink.held.has(60)).toBe(true);
    });

    it("выгрузка гасит звучащее и убирает партитуру", () => {
        const { playback, sink } = loaded();
        playback.transport.play();
        playback.advance(0.3, sink);
        sink.calls.length = 0;

        playback.unload(sink);
        expect(sink.calls).toContain("panic");
        expect(playback.loaded).toBe(false);
        expect(playback.transport.duration).toBe(0);
    });

    it("не рассыпается на пустом плеере", () => {
        const sink = new Sink();
        const playback = new Playback();
        expect(() => playback.advance(1, sink)).not.toThrow();
        expect(sink.calls).toEqual([]);
    });
});
