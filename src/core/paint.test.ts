import { describe, expect, it } from "vitest";
import { paintStack } from "./paint";
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
