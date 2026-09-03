import { describe, expect, it } from "vitest";
import { banksNeeded, presetFile } from "./instruments";
import { makeScore } from "../score/types";
import type { PartDraft } from "../score/types";

const score = (parts: readonly PartDraft[]) =>
    makeScore("test.mid", [{ midi: 60, velocity: 90, start: 0, end: 1, part: 0 }], [], parts);

const part = (index: number, channel: number, program: number | null): PartDraft => ({
    index,
    track: 0,
    channel,
    name: `партия ${index}`,
    program
});

describe("какие таблицы нужны", () => {
    it("простой тембр обходится одним банком", () => {
        expect(banksNeeded("strings", null)).toEqual([{ file: presetFile(48), program: 48, part: -1 }]);
    });

    it("неизвестный тембр падает на первый из каталога", () => {
        expect(banksNeeded("такого нет", null)).toEqual([{ file: presetFile(0), program: 0, part: -1 }]);
    });

    it("«как в файле» без партитуры просит только рояль", () => {
        expect(banksNeeded("score", null)).toEqual([{ file: presetFile(0), program: 0, part: -1 }]);
    });

    it("«как в файле» берёт инструмент каждой партии", () => {
        const needed = banksNeeded("score", score([part(0, 0, 48), part(1, 1, 33)]));
        expect(needed).toEqual([
            { file: presetFile(0), program: 0, part: -1 },
            { file: presetFile(48), program: 48, part: 0 },
            { file: presetFile(33), program: 33, part: 1 }
        ]);
    });

    it("партия без program change играет роялем", () => {
        const needed = banksNeeded("score", score([part(0, 0, null)]));
        expect(needed).toContainEqual({ file: presetFile(0), program: 0, part: 0 });
    });

    it("ударные пропускаются: у них на каждый удар свой сэмпл", () => {
        const needed = banksNeeded("score", score([part(0, 9, 0), part(1, 1, 33)]));
        expect(needed.map((item) => item.part)).toEqual([-1, 1]);
    });
});
