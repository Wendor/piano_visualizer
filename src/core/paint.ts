import type { Scene } from "./Scene";
import type { Layer } from "./types";

/** Куда слой рисует: в основной холст или в буфер свечения. */
export type Brush = "draw" | "drawGlow";

/**
 * Обойти слои, изолируя состояние контекста. Слой волен ставить свой режим
 * наложения и прозрачность и не обязан прибираться: следующий начинает с
 * чистого листа. Иначе забытый `lighter` тихо уезжает в чужую отрисовку.
 */
export function paintStack(
    g: CanvasRenderingContext2D,
    layers: readonly Layer[],
    brush: Brush,
    scene: Scene
): void {
    for (const layer of layers) {
        const paint = layer[brush];
        if (!layer.enabled || !paint) continue;
        g.save();
        paint.call(layer, g, scene);
        g.restore();
    }
}
