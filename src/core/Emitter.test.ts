import { describe, expect, it } from "vitest";
import { Emitter } from "./Emitter";

interface Events extends Record<string, unknown> {
    ping: { value: number };
    pong: Record<string, never>;
}

describe("эмиттер", () => {
    it("зовёт подписчиков события с полезной нагрузкой", () => {
        const emitter = new Emitter<Events>();
        const seen: number[] = [];
        emitter.on("ping", ({ value }) => seen.push(value));
        emitter.on("ping", ({ value }) => seen.push(value * 10));

        emitter.emit("ping", { value: 2 });

        expect(seen).toEqual([2, 20]);
    });

    it("не трогает подписчиков чужого события", () => {
        const emitter = new Emitter<Events>();
        let calls = 0;
        emitter.on("pong", () => calls++);

        emitter.emit("ping", { value: 1 });

        expect(calls).toBe(0);
    });

    it("возвращает отписку", () => {
        const emitter = new Emitter<Events>();
        let calls = 0;
        const off = emitter.on("ping", () => calls++);

        off();
        emitter.emit("ping", { value: 1 });

        expect(calls).toBe(0);
    });

    it("отписка во время рассылки не сбивает её", () => {
        const emitter = new Emitter<Events>();
        const seen: string[] = [];
        const off = emitter.on("ping", () => {
            seen.push("первый");
            off();
        });
        emitter.on("ping", () => seen.push("второй"));

        emitter.emit("ping", { value: 1 });
        emitter.emit("ping", { value: 1 });

        expect(seen).toEqual(["первый", "второй", "второй"]);
    });

    it("рассылка без подписчиков ничего не делает", () => {
        const emitter = new Emitter<Events>();
        expect(() => emitter.emit("ping", { value: 1 })).not.toThrow();
    });

    it("clear снимает всех", () => {
        const emitter = new Emitter<Events>();
        let calls = 0;
        emitter.on("ping", () => calls++);

        emitter.clear();
        emitter.emit("ping", { value: 1 });

        expect(calls).toBe(0);
    });
});
