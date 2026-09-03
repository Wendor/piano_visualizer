import type { ProfileRow } from "../core/FrameProfiler";

/**
 * Сколько строк показываем. Встроенный стек — одиннадцать слоёв, и дешёвые
 * в нём не менее интересны: строка «этот слой почти ничего не стоит» тоже
 * ответ. Предел нужен лишь против бесконечного хвоста своих слоёв.
 */
const MAX_LINES = 14;

/**
 * Отчёт замера в строках для экрана. Доля считается от суммы замеренного,
 * а не от бюджета кадра: вопрос, на который отвечает отчёт, — «что именно
 * съедает время», а не «укладываемся ли мы».
 */
export function profileLines(rows: readonly ProfileRow[]): string[] {
    const total = rows.reduce((sum, row) => sum + row.ms, 0);
    return rows.slice(0, MAX_LINES).map((row) => {
        const share = total > 0 ? Math.round((row.ms / total) * 100) : 0;
        return `${row.label} · ${row.ms.toFixed(1)} мс · ${share}%`;
    });
}
