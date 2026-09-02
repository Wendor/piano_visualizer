import { lerp, clamp } from "../core/math";
import type { KeyboardLayout } from "../core/layout";
import type { Palette } from "./types";
import { PALETTES } from "./palettes";

/** Цветовая модель сцены: оттенок зависит от положения ноты на клавиатуре. */
export class Theme {
    palette: Palette;

    constructor(palette: Palette = PALETTES[0]!) {
        this.palette = palette;
    }

    hueFor(midi: number, layout: KeyboardLayout): number {
        const t = clamp(layout.position(midi), 0, 1);
        return lerp(this.palette.hueLow, this.palette.hueHigh, t);
    }

    get midHue(): number {
        return (this.palette.hueLow + this.palette.hueHigh) / 2;
    }

    /** Цвет по оттенку: светлота 0–100, альфа 0–1. */
    color(hue: number, lightness: number, alpha = 1, saturation = this.palette.saturation): string {
        return `hsla(${hue.toFixed(1)}, ${saturation}%, ${lightness}%, ${alpha})`;
    }
}

export { PALETTES };
export type { Palette };
