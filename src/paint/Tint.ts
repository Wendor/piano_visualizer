/**
 * Цвет, понятный обоим движкам сразу.
 *
 * Холсту 2D нужна строка, видеочипу — четыре числа. Считать одно из другого в
 * кадре нельзя: разбор строки цвета стоит дороже самой заливки, а строк этих
 * за кадр просят тысячи. Поэтому цвет собирается один раз и носит с собой обе
 * своих формы.
 */
export interface Tint {
    /** Как его понимает холст 2D. */
    readonly css: string;
    /** Как его понимает видеочип: доли от нуля до единицы. */
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

/**
 * Сколько разобранных строк помним. Строки в коде наперечёт, но тему можно
 * сменить, а палитр много: предел спасает от бесконечного роста.
 */
const CACHE_LIMIT = 1024;

const parsed = new Map<string, Tint>();

/**
 * Цвет из строки: `#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `hsl()`, `hsla()`.
 *
 * Разбор идёт один раз на строку. В коде слоёв цвета записаны буквально —
 * «rgba(0, 0, 0, 0.45)» и подобное, — и каждая такая строка встречается в
 * кадре десятки раз.
 */
export function tint(css: string): Tint {
    const found = parsed.get(css);
    if (found) return found;
    if (parsed.size >= CACHE_LIMIT) parsed.clear();
    const made = parse(css);
    parsed.set(css, made);
    return made;
}

/** Цвет по составляющим тона: та же запись, что у холста, и сразу числами. */
export function hsla(h: number, s: number, l: number, a: number): Tint {
    const [r, g, b] = hslToRgb(h, s / 100, l / 100);
    return { css: `hsla(${h.toFixed(1)}, ${s}%, ${l}%, ${a})`, r, g, b, a };
}

/** Полностью прозрачный: им гасят край градиента. */
export const TRANSPARENT: Tint = { css: "rgba(0, 0, 0, 0)", r: 0, g: 0, b: 0, a: 0 };

/**
 * Непонятный цвет — не повод ронять кадр: в худшем случае что-то окажется
 * белым, и это видно глазом, в отличие от погасшей сцены.
 */
const FALLBACK: Tint = { css: "#ffffff", r: 1, g: 1, b: 1, a: 1 };

function parse(css: string): Tint {
    const text = css.trim().toLowerCase();

    if (text.startsWith("#")) return fromHex(text);

    const open = text.indexOf("(");
    if (open < 0) return FALLBACK;
    const name = text.slice(0, open);
    const parts = text
        .slice(open + 1, text.lastIndexOf(")"))
        .split(/[\s,/]+/)
        .filter((piece) => piece.length > 0);
    if (parts.length < 3) return FALLBACK;

    const alpha = parts.length > 3 ? number(parts[3]!) : 1;

    if (name === "rgb" || name === "rgba") {
        return {
            css,
            r: channel(parts[0]!),
            g: channel(parts[1]!),
            b: channel(parts[2]!),
            a: alpha
        };
    }

    if (name === "hsl" || name === "hsla") {
        const [r, g, b] = hslToRgb(number(parts[0]!), number(parts[1]!) / 100, number(parts[2]!) / 100);
        return { css, r, g, b, a: alpha };
    }

    return FALLBACK;
}

function fromHex(text: string): Tint {
    const digits = text.slice(1);
    const wide = digits.length >= 6;
    const step = wide ? 2 : 1;
    const at = (index: number): number => {
        const piece = digits.slice(index * step, index * step + step);
        if (piece.length === 0) return wide ? 255 : 15;
        const value = Number.parseInt(wide ? piece : piece + piece, 16);
        return Number.isNaN(value) ? 255 : value;
    };
    const has = digits.length === 4 || digits.length === 8;
    return {
        css: text,
        r: at(0) / 255,
        g: at(1) / 255,
        b: at(2) / 255,
        a: has ? at(3) / 255 : 1
    };
}

/** Доля канала: «255» и «100%» одинаково законны. */
function channel(piece: string): number {
    return piece.endsWith("%") ? number(piece) / 100 : number(piece) / 255;
}

function number(piece: string): number {
    const value = Number.parseFloat(piece);
    return Number.isFinite(value) ? value : 0;
}

/** Тон, насыщенность и светлота в доли красного, зелёного и синего. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const hue = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    // Шесть секторов круга: в каждом один канал полон, второй растёт, третий пуст.
    const [r, g, b] =
        hue < 60
            ? [c, x, 0]
            : hue < 120
              ? [x, c, 0]
              : hue < 180
                ? [0, c, x]
                : hue < 240
                  ? [0, x, c]
                  : hue < 300
                    ? [x, 0, c]
                    : [c, 0, x];

    return [r! + m, g! + m, b! + m];
}
