import { lerp, clamp } from "../core/math";
import type { KeyboardLayout } from "../core/layout";
import type { Palette } from "./types";
import { PALETTES } from "./palettes";

/**
 * Сколько разных строк цвета помним. Больше — уже не про сцену: значит ключ
 * слишком дробный, и проще начать заново, чем держать мёртвые строки.
 */
const CACHE_LIMIT = 4096;

/** Цветовая модель сцены: оттенок зависит от положения ноты на клавиатуре. */
export class Theme {
    palette: Palette;

    /**
     * Готовые строки цвета. За кадр их просят тысячи раз — по три-четыре на
     * каждую ноту, искру и ореол, — а каждая сборка это `toFixed`, склейка
     * строки и разбор её движком заново. Значения при этом повторяются:
     * оттенок берётся от клавиши, светлота задана в коде, громкость огрублена.
     */
    private readonly colors = new Map<number, string>();

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
        // Ключ числовой: собирать строку ради поиска строки — та же работа,
        // от которой уходим. Десятая доля градуса, целый процент светлоты и
        // сотая доля прозрачности — мельче глаз не различает.
        const h = Math.round(hue * 10);
        const l = Math.round(lightness);
        const a = Math.round(alpha * 100);
        const s = Math.round(saturation);
        const key = ((h * 128 + l) * 128 + a) * 128 + s;

        const found = this.colors.get(key);
        if (found !== undefined) return found;

        if (this.colors.size >= CACHE_LIMIT) this.colors.clear();
        const made = `hsla(${(h / 10).toFixed(1)}, ${s}%, ${l}%, ${a / 100})`;
        this.colors.set(key, made);
        return made;
    }
}

export { PALETTES };
export type { Palette };
