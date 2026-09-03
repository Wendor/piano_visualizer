/** Кадр браузера: планировщик по умолчанию. */
const nextFrame = (run: () => void): void => void requestAnimationFrame(() => run());

/**
 * Свести серию вызовов к одному запуску на кадр. Перетаскивание угла окна
 * присылает десятки событий подряд, а каждая перестройка холста и кэшей слоёв
 * стоит дорого — делать её имеет смысл ровно один раз перед отрисовкой.
 */
export function coalesce(run: () => void, schedule: (run: () => void) => void = nextFrame): () => void {
    let queued = false;
    return () => {
        if (queued) return;
        queued = true;
        schedule(() => {
            queued = false;
            run();
        });
    };
}
