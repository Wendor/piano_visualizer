import type { FrameProfiler } from "./FrameProfiler";
import type { Scene } from "./Scene";
import type { Layer } from "./types";

/** Куда слой рисует: в основной холст или в буфер свечения. */
export type Brush = "draw" | "drawGlow";

/** Слой сломался и выключен. */
export type LayerFault = (layer: Layer, error: unknown) => void;

/**
 * Просит ли кто-нибудь буфер свечения. Пока о нём никто не просит — выключен
 * блум или его сила на нуле, — наполнять буфер незачем: это половина работы
 * всех светящихся слоёв, и она уходила бы в никуда.
 */
export function wantsGlow(layers: readonly Layer[]): boolean {
    for (const layer of layers) if (layer.enabled && layer.needsGlow?.()) return true;
    return false;
}

/**
 * Обойти слои, изолируя состояние контекста. Слой волен ставить свой режим
 * наложения и прозрачность и не обязан прибираться: следующий начинает с
 * чистого листа. Иначе забытый `lighter` тихо уезжает в чужую отрисовку.
 */
export function paintStack(
    g: CanvasRenderingContext2D,
    layers: readonly Layer[],
    brush: Brush,
    scene: Scene,
    onFault?: LayerFault,
    profiler?: FrameProfiler
): void {
    for (const layer of layers) {
        const paint = layer[brush];
        if (!layer.enabled || !paint) continue;
        g.save();
        try {
            if (profiler) profiler.measure(layer.id, () => paint.call(layer, g, scene));
            else paint.call(layer, g, scene);
        } catch (error) {
            fault(layer, error, onFault);
        } finally {
            // Слой мог упасть, не сняв собственный save: кадр выйдет кривым,
            // но следующий начнётся заново — контекст сцена задаёт с нуля.
            g.restore();
        }
    }
}

/** Шаг обновления состояния слоёв — с той же защитой, что и отрисовка. */
export function updateStack(
    layers: readonly Layer[],
    scene: Scene,
    dt: number,
    onFault?: LayerFault,
    profiler?: FrameProfiler
): void {
    for (const layer of layers) {
        const update = layer.update;
        if (!layer.enabled || !update) continue;
        try {
            if (profiler) profiler.measure(layer.id, () => update.call(layer, scene, dt));
            else update.call(layer, scene, dt);
        } catch (error) {
            fault(layer, error, onFault);
        }
    }
}

/**
 * Сбойный слой выключается: одна ошибка в эффекте не должна навсегда и молча
 * уносить весь цикл кадров. Выключенный слой больше не зовут, поэтому и
 * сообщение приходит один раз.
 */
function fault(layer: Layer, error: unknown, onFault?: LayerFault): void {
    layer.enabled = false;
    onFault?.(layer, error);
}
