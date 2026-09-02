import type { SettingsStore } from "./SettingsStore";

export interface PersistenceOptions {
    key?: string;
    /** Подставное хранилище для тестов; по умолчанию — localStorage. */
    storage?: Storage | null;
    /** Задержка записи после последнего изменения, мс. */
    debounce?: number;
}

const DEFAULT_KEY = "piano-visualizer/settings";

/**
 * Сохранение настроек между запусками. Хранилище считается ненадёжным:
 * приватный режим, чужая версия схемы и битый JSON не должны ронять старт.
 */
export class SettingsPersistence {
    private readonly key: string;
    private readonly enabledKey: string;
    private readonly storage: Storage | null;
    private readonly debounce: number;

    private enabledFlag: boolean;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private detach: (() => void) | null = null;

    constructor(
        private readonly store: SettingsStore,
        options: PersistenceOptions = {}
    ) {
        this.key = options.key ?? DEFAULT_KEY;
        this.enabledKey = `${this.key}-enabled`;
        this.storage = options.storage === undefined ? safeStorage() : options.storage;
        this.debounce = options.debounce ?? 250;
        this.enabledFlag = this.read(this.enabledKey) !== "0";
    }

    get enabled(): boolean {
        return this.enabledFlag;
    }

    /**
     * Флаг живёт отдельным ключом: внутри снапшота выключенное сохранение
     * не смогло бы запомнить само себя.
     */
    setEnabled(on: boolean): void {
        if (this.enabledFlag === on) return;
        this.enabledFlag = on;
        this.write(this.enabledKey, on ? "1" : "0");
        if (on) this.save();
        else this.remove(this.key);
    }

    /** Прочитать и применить. Вызывается после добавления всех владельцев. */
    load(): void {
        if (!this.enabledFlag) return;
        const raw = this.read(this.key);
        if (raw === null) return;
        try {
            this.store.restore(JSON.parse(raw));
        } catch {
            this.remove(this.key);
        }
    }

    start(): void {
        if (this.detach) return;
        this.detach = this.store.events.on("change", () => this.schedule());
    }

    stop(): void {
        this.detach?.();
        this.detach = null;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    save(): void {
        if (!this.enabledFlag) return;
        this.write(this.key, JSON.stringify(this.store.snapshot()));
    }

    clear(): void {
        this.remove(this.key);
    }

    private schedule(): void {
        if (!this.enabledFlag) return;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.save();
        }, this.debounce);
    }

    private read(key: string): string | null {
        try {
            return this.storage?.getItem(key) ?? null;
        } catch {
            return null;
        }
    }

    private write(key: string, value: string): void {
        try {
            this.storage?.setItem(key, value);
        } catch {
            /* приватный режим или переполнение — работаем без сохранения */
        }
    }

    private remove(key: string): void {
        try {
            this.storage?.removeItem(key);
        } catch {
            /* см. write */
        }
    }
}

/** localStorage может бросать уже на обращении к свойству. */
function safeStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}
