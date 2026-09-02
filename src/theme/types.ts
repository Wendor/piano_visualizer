/** Палитра описывает, как цвет ноты меняется по высоте инструмента. */
export interface Palette {
    readonly id: string;
    readonly title: string;
    /** Оттенок самой низкой ноты. Значения > 360 допустимы: CSS берёт остаток. */
    readonly hueLow: number;
    /** Оттенок самой высокой ноты. */
    readonly hueHigh: number;
    readonly saturation: number;
    readonly background: string;
    /** Подсветка фона у линии удара. */
    readonly backgroundGlow: string;
}
