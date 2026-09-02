/** Мелкая математика и утилиты рисования, общие для всех слоёв. */

export const clamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Округление до целого физического пикселя — иначе края клавиш «плывут». */
export const snap = (value: number, dpr: number): number => Math.round(value * dpr) / dpr;

export type Radii = number | [number, number, number, number];

/** Прямоугольник со скруглениями; fallback для движков без roundRect. */
export function roundRectPath(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: Radii
): void {
    if (typeof g.roundRect === "function") {
        g.beginPath();
        g.roundRect(x, y, w, h, radii as number | number[]);
        return;
    }
    const [tl, tr, br, bl] = typeof radii === "number" ? [radii, radii, radii, radii] : radii;
    g.beginPath();
    g.moveTo(x + tl, y);
    g.lineTo(x + w - tr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + tr);
    g.lineTo(x + w, y + h - br);
    g.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    g.lineTo(x + bl, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - bl);
    g.lineTo(x, y + tl);
    g.quadraticCurveTo(x, y, x + tl, y);
}
