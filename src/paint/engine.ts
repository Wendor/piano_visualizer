import { createSurface } from "../core/surface";
import type { Surface } from "../core/surface";
import { Canvas2DEngine } from "./canvas/Canvas2DEngine";
import { GLEngine } from "./gl/GLEngine";
import { SHAPE_FRAGMENT, SHAPE_VERTEX } from "./gl/glsl";
import { link } from "./gl/program";
import type { Engine } from "./Painter";

let probed: boolean | null = null;

/**
 * Умеет ли эта машина рисовать сцену видеочипом.
 *
 * Проверяем не наличием объекта, а делом: заводим маленький холст и собираем
 * на нём ту самую программу, которой рисуется сцена. Драйвер, который на
 * словах умеет всё, а на деле не собирает шейдер, — не редкость, и узнать об
 * этом лучше до того, как холст сцены отдан навсегда: обратно его не забрать.
 */
export function supportsGL(): boolean {
    if (probed !== null) return probed;
    probed = false;
    try {
        const surface = createSurface(1, 1);
        const gl = surface.getContext("webgl2") as WebGL2RenderingContext | null;
        if (!gl) return probed;
        const program = link(gl, SHAPE_VERTEX, SHAPE_FRAGMENT);
        gl.deleteProgram(program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        probed = true;
    } catch (error) {
        // Молча откатываться нельзя: «почему-то медленно» без единой строки в
        // журнале — худший вид беды, а на телевизоре другого журнала и нет.
        console.warn("Видеочип не берётся за сцену", error);
        probed = false;
    }
    return probed;
}

/**
 * Чем рисовать. Видеочип быстрее везде, где холст растеризует процессор, — а
 * это, как показал замер, весь Firefox и любой телевизор. Но его может не
 * оказаться вовсе, и тогда картинка обязана появиться хоть как-нибудь.
 */
export function makeEngine(canvas: Surface, wanted = true): Engine {
    if (wanted && supportsGL()) {
        try {
            return new GLEngine(canvas);
        } catch (error) {
            console.warn("Видеочип отказал, рисуем холстом", error);
        }
    }
    return new Canvas2DEngine(canvas);
}
