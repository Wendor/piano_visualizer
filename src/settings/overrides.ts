import type { SettingsStore } from "./SettingsStore";

/** Слова, которыми в адресе пишут «выключено». */
const FALSE_WORDS = new Set(["0", "false", "нет", "off"]);
const TRUE_WORDS = new Set(["1", "true", "да", "on"]);

/**
 * Подмена настроек значениями из адресной строки.
 *
 * Значение приходит строкой, а какого оно типа — знает описание параметра:
 * реестр и приводит его к делу. Возвращает идентификаторы, которые применить
 * не вышло, — об опечатке надо сказать, иначе человек решит, что настройка
 * ни на что не влияет.
 */
export function applyOverrides(store: SettingsStore, pairs: ReadonlyArray<[string, string]>): string[] {
    const rejected: string[] = [];

    for (const [id, raw] of pairs) {
        const spec = store.spec(id);
        if (!spec) {
            rejected.push(id);
            continue;
        }

        switch (spec.type) {
            case "number": {
                const value = Number(raw);
                if (!Number.isFinite(value) || !store.set(id, value)) rejected.push(id);
                break;
            }
            case "boolean": {
                const lower = raw.toLowerCase();
                if (TRUE_WORDS.has(lower)) store.set(id, true);
                else if (FALSE_WORDS.has(lower)) store.set(id, false);
                else rejected.push(id);
                break;
            }
            case "enum": {
                if (!store.set(id, raw)) rejected.push(id);
                break;
            }
            case "action":
                rejected.push(id);
                break;
        }
    }

    return rejected;
}
