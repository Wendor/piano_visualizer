import type { BloomPass } from "./BloomLayer";

/** Дальше уменьшать нечего: уровень и так в несколько пикселей. */
const MAX_SCALE = 32;

/** Ступень пирамиды: во сколько раз уменьшен буфер и с каким весом ложится. */
export interface BloomLevel {
    /** Уменьшение относительно буфера свечения: 1, 2, 4, 8… */
    readonly scale: number;
    readonly width: number;
    readonly height: number;
    readonly alpha: number;
}

/**
 * Проходы размытия — в ступени пирамиды.
 *
 * Размывать честным фильтром незачем: уменьшение вдвое билинейной развёрткой
 * усредняет четыре пикселя в один, а обратное растягивание их же и размазывает.
 * Радиус в пикселях задаётся тем, во сколько раз уменьшен уровень, — и всю
 * работу делает та же выборка, которой картинка и так выводится на экран.
 * Проход радиусом R живёт на уровне, уменьшенном примерно в R раз.
 */
export function bloomPyramid(
    width: number,
    height: number,
    passes: readonly BloomPass[],
    blurScale: number
): BloomLevel[] {
    if (width < 1 || height < 1) return [];

    // Вес складывается: два прохода, попавшие на один уровень, — это один
    // уровень удвоенной яркости, а не два одинаковых рисунка подряд.
    const weights = new Map<number, number>();
    for (const pass of passes) {
        const radius = Math.max(1, pass.blur * blurScale);
        const steps = Math.round(Math.log2(radius));
        const scale = Math.min(MAX_SCALE, 2 ** Math.max(0, steps));
        weights.set(scale, (weights.get(scale) ?? 0) + pass.alpha);
    }

    return [...weights.keys()]
        .sort((a, b) => a - b)
        .map((scale) => ({
            scale,
            width: Math.max(1, Math.round(width / scale)),
            height: Math.max(1, Math.round(height / scale)),
            alpha: weights.get(scale)!
        }));
}
