import type { Viewport } from "../core/types";
import type { Score } from "../score/types";
import type { ParamValue } from "../settings/types";

/** Размер окна: у рабочего потока своего окна нет, ему о нём говорят. */
export interface WindowSize {
    width: number;
    height: number;
    devicePixelRatio: number;
}

/** Во что обошёлся кадр — всё, что показывает счётчик. */
export interface RenderStats {
    fps: number;
    work: number;
    /** Ступень качества словами: «авто · высокое». */
    title: string;
    stalls: number;
    worst: number;
    width: number;
    height: number;
    profiling: boolean;
    /** Чем рисуется сцена: «видеочип» или «холст 2D». */
    engine: string;
    /** Разбор кадра по слоям: метка и миллисекунды. */
    rows: Array<[string, number]>;
}

/**
 * Что главный поток говорит рисующему.
 *
 * Ноты приходят разобранными: педаль, повторное нажатие и партии решены в
 * главном потоке, где живёт звук. Рисующая копия сцены их только показывает.
 */
export type ToRenderer =
    | {
          type: "start";
          canvas: OffscreenCanvas;
          size: WindowSize;
          settings: Record<string, ParamValue>;
          /** Слои, которые не надо включать: список из адресной строки. */
          off: readonly string[];
          /** Разрешено ли рисовать видеочипом. */
          gl: boolean;
          /** Шагать по развёртке или по метке времени как есть. */
          clock: "even" | "raw";
      }
    | { type: "size"; size: WindowSize }
    | { type: "noteOn"; midi: number; velocity: number }
    | { type: "noteOff"; midi: number }
    | { type: "panic" }
    | { type: "setting"; id: string; value: ParamValue }
    | { type: "score"; score: Score | null }
    | { type: "time"; time: number }
    | { type: "parts"; muted: number[] }
    | { type: "profile"; on: boolean };

/** Что рисующий говорит в ответ. */
export type FromRenderer =
    | { type: "stats"; stats: RenderStats }
    /**
     * Каким вышел вид сцены. Геометрия клавиш выравнивается по целым
     * физическим пикселям, а плотность зависит от ступени качества — той, что
     * выбрал рисующий. Двойник берёт её же, иначе указатель будет попадать
     * мимо клавиш на полпикселя.
     */
    | { type: "viewport"; viewport: Viewport }
    | { type: "fault"; id: string; title: string; message: string };
