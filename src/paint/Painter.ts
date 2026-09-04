import type { Gradient } from "./Gradient";
import type { Tint } from "./Tint";
import type { Surface } from "../core/surface";
import type { Viewport } from "../core/types";

/** Вдоль какой оси идёт градиент внутри своего прямоугольника. */
export type Axis = "x" | "y";

/** Как краска ложится на уже нарисованное. */
export type Blend = "normal" | "add";

/** Четыре скругления: верх-лево, верх-право, низ-право, низ-лево. */
export type Corners = readonly [number, number, number, number];

/** Без скруглений — чтобы не рождать кортеж на каждый прямоугольник. */
export const SQUARE: Corners = [0, 0, 0, 0];

/**
 * Художник — всё, чем слой умеет рисовать.
 *
 * Слой описывает картину, а не способ её положить: прямоугольник, скругление,
 * градиент вдоль оси. Как это станет пикселями — дело движка: холст 2D делает
 * это процессором, видеочип — своими руками, и разница между ними больше, чем
 * между слабой и сильной машиной.
 *
 * Все координаты — в точках сцены (CSS-пиксели), начало в левом верхнем углу.
 * Плотность экрана художник берёт на себя.
 */
export interface Painter {
    /** Куда рисуем: на экран или в буфер свечения. */
    readonly target: "scene" | "glow";

    /** Общая прозрачность: множитель к цвету любой заливки. */
    alpha: number;
    /** Режим наложения. */
    blend: Blend;

    /** Вернуть прозрачность и наложение к обычным — между слоями. */
    reset(): void;

    // --- заливки -------------------------------------------------------------

    /** Прямоугольник ровным цветом. */
    fill(x: number, y: number, w: number, h: number, tint: Tint): void;

    /** Прямоугольник градиентом вдоль оси; градиент растянут по этой стороне. */
    fillGradient(x: number, y: number, w: number, h: number, gradient: Gradient, axis: Axis): void;

    /** Скруглённый прямоугольник ровным цветом. */
    fillRound(x: number, y: number, w: number, h: number, radii: Corners, tint: Tint): void;

    /** Скруглённый прямоугольник градиентом. */
    fillRoundGradient(
        x: number,
        y: number,
        w: number,
        h: number,
        radii: Corners,
        gradient: Gradient,
        axis: Axis
    ): void;

    /**
     * Радиальный градиент из точки, обрезанный прямоугольником. Обрезка — не
     * прихоть: свет клавиши занимает половину круга, а вторая половина ушла бы
     * под клавиатуру.
     */
    fillRadial(
        x: number,
        y: number,
        w: number,
        h: number,
        cx: number,
        cy: number,
        radius: number,
        gradient: Gradient
    ): void;

    /**
     * Кант по скруглённому прямоугольнику: линия идёт по самому контуру,
     * половина её ширины ложится внутрь, половина наружу. Кому нужен кант
     * строго внутри, тот и ужимает прямоугольник — как это делает нота.
     */
    strokeRound(x: number, y: number, w: number, h: number, radii: Corners, width: number, tint: Tint): void;

    /**
     * Пачка отрезков с круглыми концами: по четыре числа на отрезок —
     * `x0, y0, x1, y1`. Пачкой, а не поштучно: у искр цвет и толщина общие на
     * десяток, и ставить их сто раз за кадр дороже, чем нарисовать сами линии.
     */
    lines(points: Float32Array, count: number, width: number, tint: Tint): void;

    /**
     * Облачный узор внутри скруглённого прямоугольника, сложением.
     * Своя фаза у каждой фигуры: иначе облака идут парадом.
     */
    cloud(
        x: number,
        y: number,
        w: number,
        h: number,
        radii: Corners,
        amount: number,
        phaseX: number,
        phaseY: number
    ): void;

    /** Готовая картинка: кэш клавиатуры и прочее, что не меняется каждый кадр. */
    sprite(image: Surface, x: number, y: number, w: number, h: number): void;

    /** Картинка перерисована — движку пора забыть то, что он о ней помнил. */
    invalidate(image: Surface): void;

    /**
     * Положить накопленное свечение на сцену, размыв его.
     *
     * Это не фигура, а обработка целого кадра, и делает её движок: холст 2D —
     * пирамидой уменьшений или фильтром, видеочип — парой проходов шейдера.
     * Слою остаётся сказать, где в порядке рисования это случится и насколько
     * ярко. `passes` — сколько масштабов размытия позволяет ступень качества.
     */
    bloom(strength: number, passes: number): void;
}

/**
 * Движок рисования: владеет холстом, выдаёт художников и знает, когда кадр
 * начат и закончен. Слои его не видят — им хватает художника.
 */
export interface Engine {
    /** Как называть его в замере и в отладке. */
    readonly name: string;
    /** Размер холста под новый вид сцены. */
    resize(viewport: Viewport): void;
    /** Начать кадр; вернёт художника для экрана. */
    begin(viewport: Viewport): Painter;
    /** Доля экрана, в которой живёт буфер свечения. Меняется вместе с качеством. */
    setGlowScale(scale: number): void;
    /** Начать наполнение буфера свечения; `null` — если буфера нет. */
    beginGlow(viewport: Viewport): Painter | null;
    /** Свечение наполнено. */
    endGlow(): void;
    /** Кадр закончен: показать то, что нарисовано. */
    end(): void;
    dispose(): void;
}
