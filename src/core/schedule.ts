/**
 * Кадры бывают не везде: в окне их выдаёт развёртка экрана, в рабочем потоке —
 * тоже, если движок это умеет. Если не умеет — ровный ход по таймеру: хуже
 * развёртки, но лучше, чем ничего.
 */
const canAnimate = typeof requestAnimationFrame === "function";

/** Попросить следующий кадр. Возвращает номер, по которому его можно отменить. */
export function askFrame(run: (now: number) => void): number {
    if (canAnimate) return requestAnimationFrame(run);
    return setTimeout(() => run(performance.now()), 16) as unknown as number;
}

/** Отменить заказанный кадр. */
export function dropFrame(id: number): void {
    if (canAnimate) cancelAnimationFrame(id);
    else clearTimeout(id);
}

/** Кадр браузера: планировщик по умолчанию. */
const nextFrame = (run: () => void): void => void askFrame(() => run());

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
