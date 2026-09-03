import type { Viewport } from "./types";

/** Ниже этого холст мылит картинку до неузнаваемости. */
const MIN_DPR = 0.25;

export interface ViewportRequest {
    /** Размер окна в CSS-пикселях. */
    width: number;
    height: number;
    devicePixelRatio: number;
    /** Потолок плотности: 2 хватает и на Retina. */
    maxDpr: number;
    /** Множитель ступени качества. */
    renderScale: number;
    /** Потолок площади холста в пикселях. */
    maxPixels: number;
}

/** Размер холста в пикселях под этот вид. */
export function canvasSize(viewport: Viewport): { width: number; height: number } {
    // Вниз, а не к ближайшему: округление вверх перебрало бы выданный потолок.
    return {
        width: Math.max(1, Math.floor(viewport.width * viewport.dpr)),
        height: Math.max(1, Math.floor(viewport.height * viewport.dpr))
    };
}

/**
 * Размер холста под окно и ступень качества.
 *
 * Одной плотности мало: телевизор на 4K отдаёт `devicePixelRatio` равный
 * единице и тем самым просит 8.3 мегапикселя — вчетверо больше ноутбука с
 * Retina, при несопоставимо более слабом ускорителе. Поэтому площадь холста
 * ограничена прямо: CSS-размер остаётся прежним, а картинка растягивается
 * при выводе.
 */
export function resolveViewport(request: ViewportRequest): Viewport {
    const { width, height, devicePixelRatio, maxDpr, renderScale, maxPixels } = request;

    let dpr = Math.min(devicePixelRatio, maxDpr) * renderScale;
    const pixels = width * dpr * height * dpr;
    // Площадь растёт как квадрат плотности, поэтому поправка — корень.
    if (pixels > maxPixels) dpr *= Math.sqrt(maxPixels / pixels);

    return { width, height, dpr: Math.max(MIN_DPR, dpr) };
}
