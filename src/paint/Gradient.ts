import type { Tint } from "./Tint";

/** Точка градиента: доля пути вдоль оси и цвет в ней. */
export interface Stop {
    readonly at: number;
    readonly tint: Tint;
}

export const stop = (at: number, tint: Tint): Stop => ({ at, tint });

/**
 * Градиент — описание, а не объект движка.
 *
 * Холст 2D строит из него `CanvasGradient` под конкретную длину, видеочип —
 * строку в атласе; ни одному из них не нужно знать, откуда взялись цвета.
 * Само описание живёт между кадрами и служит ключом к обоим кэшам.
 */
export interface Gradient {
    /** Чем он отличается от других: по этому же ключу лежит в книге. */
    readonly key: string;
    readonly stops: readonly Stop[];
}

/**
 * Книга градиентов слоя. Собрать градиент — это разобрать несколько строк
 * цвета и разложить их по долям; делать это на каждую ноту в каждом кадре
 * значит отдавать сборщику мусора тысячи объектов в секунду за один и тот же
 * ответ.
 */
export class GradientBook {
    private readonly items = new Map<string, Gradient>();

    constructor(private readonly limit = 512) {}

    get(key: string, build: () => Stop[]): Gradient {
        const found = this.items.get(key);
        if (found) return found;
        // Переполнение — признак того, что ключ слишком дробный: проще начать
        // заново, чем держать сотни мёртвых описаний.
        if (this.items.size >= this.limit) this.items.clear();
        const made: Gradient = { key, stops: build() };
        this.items.set(key, made);
        return made;
    }

    clear(): void {
        this.items.clear();
    }

    get size(): number {
        return this.items.size;
    }
}

/** Округление до шага — чтобы близкие значения делили один градиент. */
export const bucket = (value: number, step: number): number => Math.round(value / step) * step;

/**
 * Цвет градиента в доле пути. Нужен видеочипу, который печёт градиент в
 * строку пикселей, и не нужен холсту 2D — тот умеет это сам.
 */
export function sample(stops: readonly Stop[], at: number, out: Float32Array, offset = 0): void {
    const count = stops.length;
    if (count === 0) {
        out[offset] = 0;
        out[offset + 1] = 0;
        out[offset + 2] = 0;
        out[offset + 3] = 0;
        return;
    }

    let next = 0;
    while (next < count && stops[next]!.at < at) next++;

    if (next === 0) return write(stops[0]!.tint, out, offset);
    if (next >= count) return write(stops[count - 1]!.tint, out, offset);

    const before = stops[next - 1]!;
    const after = stops[next]!;
    const span = after.at - before.at;
    const t = span > 0 ? (at - before.at) / span : 0;

    // Смешиваем с учётом прозрачности: иначе прозрачный край градиента тянет
    // за собой свой чёрный цвет и по дороге к нему всё сереет.
    const a = before.tint.a + (after.tint.a - before.tint.a) * t;
    out[offset] = mix(before.tint.r * before.tint.a, after.tint.r * after.tint.a, t);
    out[offset + 1] = mix(before.tint.g * before.tint.a, after.tint.g * after.tint.a, t);
    out[offset + 2] = mix(before.tint.b * before.tint.a, after.tint.b * after.tint.a, t);
    out[offset + 3] = a;
}

function write(tint: Tint, out: Float32Array, offset: number): void {
    out[offset] = tint.r * tint.a;
    out[offset + 1] = tint.g * tint.a;
    out[offset + 2] = tint.b * tint.a;
    out[offset + 3] = tint.a;
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
