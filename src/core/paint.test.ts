import { describe, expect, it } from "vitest";
import { paintStack, updateStack } from "./paint";
import type { Scene } from "./Scene";
import type { Layer } from "./types";

/** Холст, помнящий только то, что слои реально трогают: alpha и режим наложения. */
class FakeContext {
    globalAlpha = 1;
    globalCompositeOperation = "source-over";
    private readonly stack: Array<{ alpha: number; op: string }> = [];

    save(): void {
        this.stack.push({ alpha: this.globalAlpha, op: this.globalCompositeOperation });
    }

    restore(): void {
        const saved = this.stack.pop();
        if (!saved) return;
        this.globalAlpha = saved.alpha;
        this.globalCompositeOperation = saved.op;
    }
}

const context = (): CanvasRenderingContext2D => new FakeContext() as unknown as CanvasRenderingContext2D;
const scene = {} as Scene;

function layer(id: string, body: Partial<Layer>): Layer {
    return { id, stage: 0, enabled: true, ...body };
}

describe("обход слоёв", () => {
    it("слой, не прибравший за собой, не портит следующему", () => {
        const seen: Array<{ alpha: number; op: string }> = [];
        const dirty = layer("dirty", {
            drawGlow: (g) => {
                g.globalAlpha = 0.2;
                g.globalCompositeOperation = "lighter";
            }
        });
        const next = layer("next", {
            drawGlow: (g) => seen.push({ alpha: g.globalAlpha, op: g.globalCompositeOperation })
        });

        paintStack(context(), [dirty, next], "drawGlow", scene);

        expect(seen).toEqual([{ alpha: 1, op: "source-over" }]);
    });

    it("выключенный слой не рисует", () => {
        const drawn: string[] = [];
        const off = layer("off", { enabled: false, draw: () => drawn.push("off") });
        const on = layer("on", { draw: () => drawn.push("on") });

        paintStack(context(), [off, on], "draw", scene);

        expect(drawn).toEqual(["on"]);
    });

    it("зовёт только запрошенный способ рисования", () => {
        const calls: string[] = [];
        const both = layer("both", {
            draw: () => calls.push("draw"),
            drawGlow: () => calls.push("drawGlow")
        });

        paintStack(context(), [both], "drawGlow", scene);

        expect(calls).toEqual(["drawGlow"]);
    });

    it("слой без нужного метода пропускается", () => {
        const quiet = layer("quiet", {});
        expect(() => paintStack(context(), [quiet], "draw", scene)).not.toThrow();
    });
});

describe("сбойный слой", () => {
    const broken = (id: string, where: "draw" | "update") =>
        layer(id, {
            [where]: () => {
                throw new Error("слой сломался");
            }
        });

    it("выключается и не мешает следующему рисовать", () => {
        const drawn: string[] = [];
        const bad = broken("bad", "draw");
        const next = layer("next", { draw: () => drawn.push("next") });

        paintStack(context(), [bad, next], "draw", scene);

        expect(bad.enabled).toBe(false);
        expect(drawn).toEqual(["next"]);
    });

    it("сообщает о себе один раз: со второго кадра его уже не зовут", () => {
        const faults: string[] = [];
        const bad = broken("bad", "draw");
        const report = (item: { id: string }) => faults.push(item.id);

        const g = context();
        paintStack(g, [bad], "draw", scene, report);
        paintStack(g, [bad], "draw", scene, report);

        expect(faults).toEqual(["bad"]);
    });

    it("та же защита на обновлении состояния", () => {
        const updated: string[] = [];
        const bad = broken("bad", "update");
        const next = layer("next", { update: () => updated.push("next") });

        updateStack([bad, next], scene, 0.016);

        expect(bad.enabled).toBe(false);
        expect(updated).toEqual(["next"]);
    });

    it("без обработчика ошибка не уходит наружу", () => {
        expect(() => paintStack(context(), [broken("bad", "draw")], "draw", scene)).not.toThrow();
        expect(() => updateStack([broken("bad", "update")], scene, 0.016)).not.toThrow();
    });

    it("исправный слой продолжает обновляться", () => {
        const updated: string[] = [];
        const good = layer("good", { update: () => updated.push("good") });

        updateStack([good], scene, 0.016);
        updateStack([good], scene, 0.016);

        expect(good.enabled).toBe(true);
        expect(updated).toEqual(["good", "good"]);
    });
});
