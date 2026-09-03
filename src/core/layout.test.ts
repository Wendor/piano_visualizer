import { describe, expect, it } from "vitest";
import { KeyboardLayout, DEFAULT_LAYOUT_OPTIONS, isAccidental, whiteKeysBelow } from "./layout";
import type { LayoutOptions } from "./layout";

function built(width: number, height = 900, dpr = 1, patch: Partial<LayoutOptions> = {}): KeyboardLayout {
    const layout = new KeyboardLayout({ ...DEFAULT_LAYOUT_OPTIONS, ...patch });
    layout.build({ width, height, dpr });
    return layout;
}

const whites = (layout: KeyboardLayout) => layout.keys.filter((key) => !key.accidental);

describe("счёт белых клавиш", () => {
    it("до ноты «до» первой октавы лежит целое число октав", () => {
        expect(whiteKeysBelow(60) - whiteKeysBelow(48)).toBe(7);
    });

    it("узнаёт диезы", () => {
        expect([61, 63, 66, 68, 70].every(isAccidental)).toBe(true);
        expect([60, 62, 64, 65, 67, 69, 71].some(isAccidental)).toBe(false);
    });
});

describe("раскладка рояля", () => {
    it("полный рояль — 88 клавиш, из них 52 белые", () => {
        const layout = built(1600);
        expect(layout.keys.length).toBe(88);
        expect(whites(layout).length).toBe(52);
    });

    it("белые клавиши идут вплотную, без щелей и нахлёстов", () => {
        for (const dpr of [1, 2]) {
            const layout = built(1600, 900, dpr);
            const row = whites(layout);
            for (let i = 1; i < row.length; i++) {
                expect(row[i]!.x).toBeCloseTo(row[i - 1]!.x + row[i - 1]!.width, 10);
            }
        }
    });

    it("ширина белой клавиши выровнена по целому физическому пикселю", () => {
        for (const dpr of [1, 2, 3]) {
            const layout = built(1367, 900, dpr);
            expect(layout.whiteWidth * dpr).toBeCloseTo(Math.round(layout.whiteWidth * dpr), 10);
        }
    });

    it("соль-диез стоит по стыку соль и ля", () => {
        for (const dpr of [1, 2]) {
            const layout = built(1600, 900, dpr);
            const gSharp = layout.get(68)!;
            const a = layout.get(69)!;
            // Ровно по стыку в модели; на экране — с точностью до половины
            // физического пикселя, на которую его сдвигает выравнивание.
            expect(Math.abs(gSharp.x + gSharp.width / 2 - a.x)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
        }
    });

    it("крайние диезы группы смещены наружу от стыков", () => {
        const layout = built(1600);
        const cSharp = layout.get(61)!;
        const dSharp = layout.get(63)!;
        const d = layout.get(62)!;
        const e = layout.get(64)!;

        // До-диез левее стыка «до|ре», ре-диез правее стыка «ре|ми».
        expect(cSharp.x + cSharp.width / 2).toBeLessThan(d.x);
        expect(dSharp.x + dSharp.width / 2).toBeGreaterThan(e.x);
    });

    it("чёрные клавиши короче белых и лежат внутри клавиатуры", () => {
        const layout = built(1600);
        for (const key of layout.keys) {
            expect(key.x).toBeGreaterThanOrEqual(0);
            expect(key.x + key.width).toBeLessThanOrEqual(layout.width + 0.001);
            if (key.accidental) expect(key.height).toBeLessThan(layout.height);
        }
    });
});

describe("узкий экран", () => {
    it("сужает диапазон, пока клавиша не станет шире порога", () => {
        const wide = built(1600);
        const narrow = built(420);

        expect(wide.lastMidi - wide.firstMidi).toBe(87);
        expect(narrow.lastMidi - narrow.firstMidi).toBeLessThan(87);
        expect(narrow.whiteWidth).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.minWhiteWidth);
    });

    it("с выключенным автосужением диапазон остаётся полным", () => {
        const layout = built(420, 900, 1, { autoRange: false });
        expect(layout.keys.length).toBe(88);
    });

    it("клавиатура не ниже минимальной высоты", () => {
        const layout = built(1600, 120);
        expect(layout.height).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.minHeight);
    });
});

describe("перенос нот внутрь диапазона", () => {
    it("поднимает низкую ноту октавами, сохраняя ступень", () => {
        const layout = built(420);
        const folded = layout.fold(24);
        expect(folded).toBeGreaterThanOrEqual(layout.firstMidi);
        expect(folded % 12).toBe(24 % 12);
    });

    it("опускает высокую ноту октавами, сохраняя ступень", () => {
        const layout = built(420);
        const folded = layout.fold(120);
        expect(folded).toBeLessThanOrEqual(layout.lastMidi);
        expect(folded % 12).toBe(120 % 12);
    });

    it("ноту внутри диапазона не трогает", () => {
        const layout = built(1600);
        expect(layout.fold(60)).toBe(60);
    });
});

describe("попадание по клавише", () => {
    it("выше клавиатуры клавиш нет", () => {
        const layout = built(1600);
        expect(layout.keyAt(400, layout.top - 1)).toBeUndefined();
    });

    it("чёрная клавиша выигрывает у белой под собой", () => {
        const layout = built(1600);
        const black = layout.get(61)!;
        const hit = layout.keyAt(black.x + black.width / 2, layout.top + black.height / 2);
        expect(hit?.midi).toBe(61);
    });

    it("ниже чёрной клавиши начинается белая", () => {
        const layout = built(1600);
        const black = layout.get(61)!;
        const hit = layout.keyAt(black.x + black.width / 2, layout.top + black.height + 5);
        expect(hit?.accidental).toBe(false);
    });

    it("каждая белая клавиша ловится по своей середине", () => {
        const layout = built(1600);
        for (const key of whites(layout)) {
            const hit = layout.keyAt(key.x + key.width / 2, layout.top + layout.height - 2);
            expect(hit?.midi).toBe(key.midi);
        }
    });
});

describe("положение в диапазоне", () => {
    it("от нуля на нижней клавише до единицы на верхней", () => {
        const layout = built(1600);
        expect(layout.position(layout.firstMidi)).toBe(0);
        expect(layout.position(layout.lastMidi)).toBe(1);
    });
});
