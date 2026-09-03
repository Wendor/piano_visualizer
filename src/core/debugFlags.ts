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

    const quality = query.get("quality");
    if (quality && MODES.includes(quality as QualityMode)) flags.quality = quality as QualityMode;

    const off = (query.get("off") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    if (off.length > 0) flags.off = off;

    return flags;
}
