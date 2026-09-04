import { context2d, createSurface } from "../core/surface";
import type { Surface } from "../core/surface";

/** Сторона тайла в пикселях. Фаза узора отсчитывается в них же. */
export const CLOUD_TILE = 64;

/**
 * Облачный тайл для живой заливки нот. Каждое пятно рисуется девять раз со
 * сдвигом на размер тайла — тогда текстура повторяется без видимых швов.
 *
 * Один на всю сцену: узор внутри ноты не про конкретную ноту, а про то, что
 * свет живой. Разводить его на каждую — платить за одно и то же сто раз.
 */
export function cloudTile(size = CLOUD_TILE): Surface {
    const canvas = createSurface(size, size);
    const g = context2d(canvas, "облачный тайл");

    for (let i = 0; i < 14; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        // Пятна мельче ширины ноты — иначе внутри узкого диеза не видно жизни.
        const radius = 5 + Math.random() * 14;
        const alpha = 0.22 + Math.random() * 0.38;
        for (const dx of [-size, 0, size]) {
            for (const dy of [-size, 0, size]) {
                const gradient = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
                gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
                g.fillStyle = gradient;
                g.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
            }
        }
    }
    return canvas;
}
