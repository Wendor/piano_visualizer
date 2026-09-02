import { describe as suite, expect, it } from "vitest";
import { SettingsStore } from "./SettingsStore";
import { SettingsPersistence } from "./persistence";
import type { ParamSpec } from "./types";
import { SCHEMA_VERSION } from "./types";

class MemoryStorage implements Storage {
    private readonly map = new Map<string, string>();

    get length(): number {
        return this.map.size;
    }
    clear(): void {
        this.map.clear();
    }
    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    key(index: number): string | null {
        return [...this.map.keys()][index] ?? null;
    }
    removeItem(key: string): void {
        this.map.delete(key);
    }
    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

/** Хранилище приватного режима: бросает на любом обращении. */
class HostileStorage implements Storage {
    get length(): number {
        throw new Error("нет доступа");
    }
    clear(): void {
        throw new Error("нет доступа");
    }
    getItem(): string {
        throw new Error("нет доступа");
    }
    key(): string {
        throw new Error("нет доступа");
    }
    removeItem(): void {
        throw new Error("нет доступа");
    }
    setItem(): void {
        throw new Error("нет доступа");
    }
}

interface Box {
    speed: number;
    palette: string;
}

const KEY = "test/settings";

function setup(storage: Storage): { state: Box; store: SettingsStore; persistence: SettingsPersistence } {
    const state: Box = { speed: 240, palette: "ion" };
    const store = new SettingsStore();
    store.addOwner("demo", (): ParamSpec[] => [
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
                { value: "ember", title: "Ember" }
            ],
            get: () => state.palette,
            set: (value) => {
                state.palette = value;
            }
        }
    ]);
    const persistence = new SettingsPersistence(store, { key: KEY, storage, debounce: 0 });
    return { state, store, persistence };
}

function write(storage: Storage, values: Record<string, unknown>, version = SCHEMA_VERSION): void {
    storage.setItem(KEY, JSON.stringify({ version, values }));
}

suite("SettingsPersistence", () => {
    it("возвращает сохранённые значения после перезапуска", () => {
        const storage = new MemoryStorage();
        const first = setup(storage);
        first.store.set("demo/speed", 400);
        first.store.set("demo/palette", "ember");
        first.persistence.save();

        const second = setup(storage);
        second.persistence.load();
        expect(second.state).toEqual({ speed: 400, palette: "ember" });
    });

    it("пишет с задержкой после изменения", async () => {
        const storage = new MemoryStorage();
        const { store, persistence } = setup(storage);
        persistence.start();
        store.set("demo/speed", 320);
        await new Promise((resolve) => setTimeout(resolve, 5));
        persistence.stop();

        expect(JSON.parse(storage.getItem(KEY)!).values["demo/speed"]).toBe(320);
    });

    it("игнорирует снапшот чужой версии целиком", () => {
        const storage = new MemoryStorage();
        write(storage, { "demo/speed": 500 }, SCHEMA_VERSION + 1);
        const { state, persistence } = setup(storage);
        persistence.load();
        expect(state.speed).toBe(240);
    });

    it("пропускает неизвестный ключ, применяя соседние", () => {
        const storage = new MemoryStorage();
        write(storage, { "demo/нет-такого": 1, "demo/speed": 320 });
        const { state, persistence } = setup(storage);
        persistence.load();
        expect(state.speed).toBe(320);
    });

    it("зажимает число, вышедшее за диапазон", () => {
        const storage = new MemoryStorage();
        write(storage, { "demo/speed": 5000 });
        const { state, persistence } = setup(storage);
        persistence.load();
        expect(state.speed).toBe(600);
    });

    it("пропускает значение enum вне списка вариантов", () => {
        const storage = new MemoryStorage();
        write(storage, { "demo/palette": "неон", "demo/speed": 300 });
        const { state, persistence } = setup(storage);
        persistence.load();
        expect(state.palette).toBe("ion");
        expect(state.speed).toBe(300);
    });

    it("переживает битый JSON и чистит его", () => {
        const storage = new MemoryStorage();
        storage.setItem(KEY, "{не json");
        const { state, persistence } = setup(storage);
        expect(() => persistence.load()).not.toThrow();
        expect(state.speed).toBe(240);
        expect(storage.getItem(KEY)).toBeNull();
    });

    it("переживает снапшот не того вида", () => {
        const storage = new MemoryStorage();
        storage.setItem(KEY, "[1, 2, 3]");
        const { state, persistence } = setup(storage);
        persistence.load();
        expect(state.speed).toBe(240);
    });

    it("не падает на недоступном хранилище", () => {
        const { store, persistence } = setup(new HostileStorage());
        expect(() => persistence.load()).not.toThrow();
        expect(() => persistence.save()).not.toThrow();
        expect(() => store.set("demo/speed", 300)).not.toThrow();
    });

    it("выключение стирает снапшот и прекращает запись", () => {
        const storage = new MemoryStorage();
        const { store, persistence } = setup(storage);
        persistence.save();
        expect(storage.getItem(KEY)).not.toBeNull();

        persistence.setEnabled(false);
        expect(storage.getItem(KEY)).toBeNull();

        store.set("demo/speed", 300);
        persistence.save();
        expect(storage.getItem(KEY)).toBeNull();

        // Флаг переживает перезапуск и не даёт восстановиться.
        const next = setup(storage);
        expect(next.persistence.enabled).toBe(false);
    });

    it("включение сразу записывает текущее состояние", () => {
        const storage = new MemoryStorage();
        const { store, persistence } = setup(storage);
        persistence.setEnabled(false);
        store.set("demo/speed", 360);
        persistence.setEnabled(true);

        expect(JSON.parse(storage.getItem(KEY)!).values["demo/speed"]).toBe(360);
    });
});
