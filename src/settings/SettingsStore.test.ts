import { describe as suite, expect, it, vi } from "vitest";
import { SettingsStore } from "./SettingsStore";
import type { ParamSpec } from "./types";
import type { Layer } from "../core/types";

interface Box {
    speed: number;
    palette: string;
    hollow: boolean;
}

function box(): Box {
    return { speed: 240, palette: "ion", hollow: true };
}

function specs(state: Box, run = (): void => {}): ParamSpec[] {
    return [
        {
            type: "number",
            key: "speed",
            label: "Скорость",
            group: "notes",
            min: 80,
            max: 600,
            step: 20,
            get: () => state.speed,
            set: (value) => {
                state.speed = value;
            }
        },
        {
            type: "enum",
            key: "palette",
            label: "Палитра",
            group: "view",
            variants: [
                { value: "ion", title: "Ion" },
                { value: "ember", title: "Ember" },
                { value: "emerald", title: "Emerald" }
            ],
            get: () => state.palette,
            set: (value) => {
                state.palette = value;
            }
        },
        {
            type: "boolean",
            key: "hollow",
            label: "Контур",
            group: "notes",
            get: () => state.hollow,
            set: (value) => {
                state.hollow = value;
            }
        },
        { type: "action", key: "reset", label: "Сброс", group: "system", hint: "↵", run }
    ];
}

function store(state: Box, run?: () => void): SettingsStore {
    const result = new SettingsStore();
    result.addOwner("demo", () => specs(state, run));
    return result;
}

suite("SettingsStore", () => {
    it("двигает число шагом и зажимает по краям", () => {
        const state = box();
        const s = store(state);

        s.step("demo/speed", 1);
        expect(state.speed).toBe(260);

        for (let i = 0; i < 100; i++) s.step("demo/speed", 1);
        expect(state.speed).toBe(600);

        for (let i = 0; i < 100; i++) s.step("demo/speed", -1);
        expect(state.speed).toBe(80);
    });

    it("ходит по вариантам enum по кругу в обе стороны", () => {
        const state = box();
        const s = store(state);

        s.step("demo/palette", -1);
        expect(state.palette).toBe("emerald");

        s.step("demo/palette", 1);
        expect(state.palette).toBe("ion");
    });

    it("инвертирует boolean и вызывает action", () => {
        const state = box();
        const run = vi.fn();
        const s = store(state, run);

        s.step("demo/hollow", 1);
        expect(state.hollow).toBe(false);

        s.step("demo/reset", 1);
        expect(run).toHaveBeenCalledOnce();
    });

    it("отвергает неизвестный id и чужой тип значения", () => {
        const state = box();
        const s = store(state);

        expect(s.set("demo/нет-такого", 1)).toBe(false);
        expect(s.set("demo/speed", "быстро")).toBe(false);
        expect(s.set("demo/palette", "фиолетовый")).toBe(false);
        expect(s.set("demo/reset", true)).toBe(false);
        expect(state.speed).toBe(240);
    });

    it("раскладывает параметры по группам в объявленном порядке", () => {
        const s = store(box());
        expect(s.groups().map((group) => group.group)).toEqual(["view", "notes", "system"]);
        expect(s.entries().map((entry) => entry.id)).toEqual([
            "demo/palette",
            "demo/speed",
            "demo/hollow",
            "demo/reset"
        ]);
    });

    it("снимает и восстанавливает состояние целиком", () => {
        const state = box();
        const s = store(state);
        const snapshot = s.snapshot();

        state.speed = 500;
        state.palette = "ember";
        state.hollow = false;

        expect(s.restore(snapshot)).toBe(true);
        expect(state).toEqual({ speed: 240, palette: "ion", hollow: true });
    });

    it("возвращает дефолты, зафиксированные при добавлении владельца", () => {
        const state = box();
        const s = store(state);

        s.set("demo/speed", 480);
        s.set("demo/palette", "ember");
        s.reset();

        expect(state.speed).toBe(240);
        expect(state.palette).toBe("ion");
    });

    it("убирает параметры вместе с владельцем и сообщает о перестройке", () => {
        const s = store(box());
        const structure = vi.fn();
        s.events.on("structure", structure);

        expect(s.removeOwner("demo")).toBe(true);
        expect(s.entries()).toHaveLength(0);
        expect(structure).toHaveBeenCalledOnce();
        expect(s.removeOwner("demo")).toBe(false);
    });

    it("не даёт добавить одного владельца дважды", () => {
        const s = store(box());
        expect(() => s.addOwner("demo", () => [])).toThrow(/уже добавлен/);
    });

    it("подхватывает сторонний слой без правки UI", () => {
        const s = new SettingsStore();
        const layer = {
            id: "effects.confetti",
            stage: 300,
            enabled: true,
            title: "Конфетти",
            params: (): ParamSpec[] => [
                {
                    type: "number",
                    key: "amount",
                    label: "Плотность",
                    group: "effects",
                    min: 0,
                    max: 10,
                    step: 1,
                    get: () => 5,
                    set: () => {}
                }
            ]
        } satisfies Layer;

        s.addLayer(layer, "effects");
        expect(s.entries().map((entry) => entry.id)).toEqual([
            "effects.confetti/enabled",
            "effects.confetti/amount"
        ]);
        expect(s.get("effects.confetti/enabled")).toBe(true);

        s.step("effects.confetti/enabled", 1);
        expect(layer.enabled).toBe(false);
    });

    it("не добавляет переключатель невыключаемому слою", () => {
        const s = new SettingsStore();
        s.addLayer({ id: "keyboard", stage: 600, enabled: true, toggleable: false } satisfies Layer, "view");
        expect(s.entries()).toHaveLength(0);
    });
});
