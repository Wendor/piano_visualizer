import type { QualityMode } from "./Quality";

/** Что можно включить прямо из адресной строки. */
export interface DebugFlags {
    /** Разбор кадра по слоям поверх сцены. */
    profile?: boolean;
    /** Ступень качества вместо автоматической. */
    quality?: QualityMode;
    /**
     * Слои, которые не надо включать. Замер таймером видит только работу
     * JavaScript, а холст платит за неё позже и на стороне ускорителя; на
     * слабой машине единственный честный ответ «во что обходится слой» —
     * выключить его и посмотреть на кадры.
     */
    off?: string[];
    /**
     * Рисовать в рабочем потоке или прямо в окне. Обычно первое; второе
     * нужно, чтобы сравнить одно с другим на замере.
     */
    worker?: boolean;
    /**
     * Рисовать видеочипом или холстом 2D. Обычно первое, если он есть;
     * второе — чтобы сравнить движки на одной машине.
     */
    gl?: boolean;
    /**
     * Подмена настроек: пары «идентификатор — значение как написано».
     * Значение остаётся строкой: какого оно типа, знает только описание
     * параметра, а оно живёт в реестре настроек.
     */
    set?: Array<[string, string]>;
}

const MODES: readonly QualityMode[] = ["auto", "high", "medium", "low"];

/**
 * Отладочные флаги из строки запроса.
 *
 * У телевизора нет клавиатуры: `\`` для панели настроек с пульта не нажать,
 * а адрес ввести можно. Поэтому замер должен включаться и отсюда.
 */
export function parseDebugFlags(search: string): DebugFlags {
    const query = new URLSearchParams(search);
    const flags: DebugFlags = {};

    if (query.has("profile")) {
        // Флаг без значения — это «включить»: с пульта каждый символ дорог.
        const value = query.get("profile") ?? "";
        flags.profile = value !== "0" && value !== "false";
    }

    if (query.has("worker")) {
        const value = query.get("worker") ?? "";
        flags.worker = value !== "0" && value !== "false";
    }

    if (query.has("gl")) {
        const value = query.get("gl") ?? "";
        flags.gl = value !== "0" && value !== "false";
    }

    const quality = query.get("quality");
    if (quality && MODES.includes(quality as QualityMode)) flags.quality = quality as QualityMode;

    const off = (query.get("off") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    if (off.length > 0) flags.off = off;

    const overrides = (query.get("set") ?? "")
        .split(",")
        .map((pair) => pair.split("="))
        .filter((parts): parts is [string, string] => parts.length === 2)
        .map(([id, value]) => [id.trim(), value.trim()] as [string, string])
        .filter(([id, value]) => id.length > 0 && value.length > 0);
    if (overrides.length > 0) flags.set = overrides;

    return flags;
}
