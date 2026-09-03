import { describe, expect, it } from "vitest";
import { applyOverrides } from "./overrides";
import { SettingsStore } from "./SettingsStore";

/** Реестр с одним параметром каждого типа — как у настоящего слоя. */
function store(): { store: SettingsStore; state: { size: number; on: boolean; mode: string } } {
    const state = { size: 10, on: true, mode: "soft" };
    const settings = new SettingsStore();
    settings.addOwner("probe", () => [
        {
            type: "number",
            key: "size",
            label: "Размер",
            group: "view",
            min: 0,
            max: 100,
            step: 1,
            get: () => state.size,
            set: (value) => {
                state.size = value;
            }
        },
        {
            type: "boolean",
            key: "on",
            label: "Включено",
            group: "view",
            get: () => state.on,
            set: (value) => {
                state.on = value;
            }
        },
        {
            type: "enum",
            key: "mode",
            label: "Режим",
            group: "view",
            variants: [
                { value: "soft", title: "мягкий" },
                { value: "hard", title: "резкий" }
            ],
            get: () => state.mode,
            set: (value) => {
                state.mode = value;
            }
        }
    ]);
    return { store: settings, state };
}

describe("applyOverrides", () => {
    it("ставит число", () => {
        const { store: s, state } = store();
        expect(applyOverrides(s, [["probe/size", "42"]])).toEqual([]);
        expect(state.size).toBe(42);
    });

    it("зажимает число в допустимый диапазон", () => {
        const { store: s, state } = store();
        applyOverrides(s, [["probe/size", "999"]]);
        expect(state.size).toBe(100);
    });

    it("понимает выключение и нулём, и словом", () => {
        const { store: s, state } = store();
        applyOverrides(s, [["probe/on", "0"]]);
        expect(state.on).toBe(false);
        applyOverrides(s, [["probe/on", "true"]]);
        expect(state.on).toBe(true);
        applyOverrides(s, [["probe/on", "false"]]);
        expect(state.on).toBe(false);
    });

    it("ставит вариант перечисления", () => {
        const { store: s, state } = store();
        expect(applyOverrides(s, [["probe/mode", "hard"]])).toEqual([]);
        expect(state.mode).toBe("hard");
    });

    it("возвращает несуществующий параметр: с пульта легко ошибиться", () => {
        const { store: s } = store();
        expect(applyOverrides(s, [["probe/нету", "1"]])).toEqual(["probe/нету"]);
    });

    it("возвращает вариант, которого нет в перечислении", () => {
        const { store: s, state } = store();
        expect(applyOverrides(s, [["probe/mode", "средний"]])).toEqual(["probe/mode"]);
        expect(state.mode).toBe("soft");
    });

    it("возвращает нечисло там, где ждут число", () => {
        const { store: s, state } = store();
        expect(applyOverrides(s, [["probe/size", "много"]])).toEqual(["probe/size"]);
        expect(state.size).toBe(10);
    });

    it("применяет годные подмены, даже если рядом есть негодная", () => {
        const { store: s, state } = store();
        expect(
            applyOverrides(s, [
                ["probe/size", "7"],
                ["probe/нету", "1"]
            ])
        ).toEqual(["probe/нету"]);
        expect(state.size).toBe(7);
    });
});
