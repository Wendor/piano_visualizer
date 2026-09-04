/**
 * Холст без привязки к потоку.
 *
 * Сцена рисует и в окне, и в рабочем потоке, где `document` не существует, а
 * холст называется `OffscreenCanvas`. Рисующие вызовы у них одни и те же —
 * расходятся только типы и способ завести новый холст, и это расхождение
 * собрано здесь, чтобы слои о нём не знали.
 */

/** Холст: элемент страницы или холст рабочего потока. */
export type Surface = HTMLCanvasElement | OffscreenCanvas;

/** Контекст рисования любого из них. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Есть ли под рукой страница: в рабочем потоке её нет. */
export const hasDocument = typeof document !== "undefined";

/** Новый холст под кэш или буфер. */
export function createSurface(width = 1, height = 1): Surface {
    if (hasDocument) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    return new OffscreenCanvas(width, height);
}

/** Контекст холста. Отсутствие контекста — беда, о которой лучше сказать сразу. */
export function context2d(surface: Surface, reason: string): Ctx2D {
    const ctx = surface.getContext("2d");
    if (!ctx) throw new Error(`2D-контекст недоступен: ${reason}`);
    return ctx as Ctx2D;
}
