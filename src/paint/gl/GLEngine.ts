import { cloudTile, CLOUD_TILE } from "../cloud";
import { GLPainter, STRIDE } from "./GLPainter";
import { BLIT_FRAGMENT, BLIT_VERTEX, SHAPE_FRAGMENT, SHAPE_VERTEX } from "./glsl";
import { dropTarget, link, makeTarget, resizeTarget } from "./program";
import type { Target } from "./program";
import { GradientAtlas, ImageBook } from "./textures";
import type { Engine, Painter } from "../Painter";
import type { Sink } from "./GLPainter";
import type { Surface } from "../../core/surface";
import type { Viewport } from "../../core/types";

/**
 * Вклад ступеней размытия, от самой резкой к самой мягкой. Те же числа, что и
 * на холсте: дороги разные, а картинка должна быть одна.
 */
const PASSES = [0.62, 0.84, 0.81, 0.81];

/** Сколько фигур влезает в один вызов рисования. */
const CAPACITY = 4096;

/**
 * Движок на видеочипе.
 *
 * Сцена состоит из скруглённых прямоугольников с градиентами и складывающимся
 * светом — то есть ровно из того, что видеочип делает даром, а процессор
 * считает по пикселю. Замер это и показал: один и тот же кадр стоит
 * миллисекунду там, где холст рисует видеочип, и пятьдесят четыре там, где
 * его растеризует процессор.
 *
 * Смешать два холста нельзя: чтобы положить нарисованное видеочипом в холст
 * 2D, картинку пришлось бы читать обратно в память, и это съело бы всю выгоду.
 * Поэтому либо вся сцена здесь, либо ничего.
 */
export class GLEngine implements Engine, Sink {
    readonly name = "видеочип";
    readonly gl: WebGL2RenderingContext;
    readonly atlas: GradientAtlas;
    readonly images: ImageBook;

    private readonly shapes: WebGLProgram;
    private readonly blit: WebGLProgram;
    private readonly vao: WebGLVertexArrayObject;
    private readonly instances: WebGLBuffer;
    private readonly blitVao: WebGLVertexArrayObject;
    private readonly uniforms: {
        size: WebGLUniformLocation | null;
        scale: WebGLUniformLocation | null;
        rows: WebGLUniformLocation | null;
        tile: WebGLUniformLocation | null;
    };
    private readonly blitAlpha: WebGLUniformLocation | null;

    private readonly tile: Surface;
    private readonly scenePainter: GLPainter;
    private readonly glowPainter: GLPainter;

    /** Буфер свечения и ступени его размытия. */
    private glow: Target | null = null;
    private readonly steps: Target[] = [];
    private glowScale = 0.25;
    /** Есть ли в буфере свечения что-то в этом кадре. */
    private glowReady = false;

    private viewport: Viewport = { width: 1, height: 1, dpr: 1 };

    constructor(private readonly canvas: Surface) {
        const gl = canvas.getContext("webgl2", {
            alpha: false,
            depth: false,
            stencil: false,
            antialias: false,
            premultipliedAlpha: true,
            powerPreference: "high-performance"
        }) as WebGL2RenderingContext | null;
        if (!gl) throw new Error("WebGL2 недоступен");
        this.gl = gl;

        this.shapes = link(gl, SHAPE_VERTEX, SHAPE_FRAGMENT);
        this.blit = link(gl, BLIT_VERTEX, BLIT_FRAGMENT);
        this.atlas = new GradientAtlas(gl);
        this.images = new ImageBook(gl);
        this.tile = cloudTile();

        const corners = gl.createBuffer();
        const instances = gl.createBuffer();
        const vao = gl.createVertexArray();
        const blitVao = gl.createVertexArray();
        if (!corners || !instances || !vao || !blitVao) throw new Error("Не удалось завести буферы");
        this.instances = instances;
        this.vao = vao;
        this.blitVao = blitVao;

        // Четыре угла единичного квадрата — одни на все фигуры сразу; всё
        // остальное приходит по одному набору чисел на фигуру.
        gl.bindBuffer(gl.ARRAY_BUFFER, corners);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

        gl.bindVertexArray(vao);
        this.attribute(this.shapes, "a_corner", corners, 2, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        gl.bufferData(gl.ARRAY_BUFFER, CAPACITY * STRIDE * 4, gl.DYNAMIC_DRAW);
        this.instanced(this.shapes, "a_rect", 0);
        this.instanced(this.shapes, "a_radii", 4);
        this.instanced(this.shapes, "a_color", 8);
        this.instanced(this.shapes, "a_params", 12);
        this.instanced(this.shapes, "a_extra", 16);
        this.instanced(this.shapes, "a_core", 20);

        gl.bindVertexArray(blitVao);
        this.attribute(this.blit, "a_corner", corners, 2, 0, 0);
        gl.bindVertexArray(null);

        this.uniforms = {
            size: gl.getUniformLocation(this.shapes, "u_size"),
            scale: gl.getUniformLocation(this.shapes, "u_scale"),
            rows: gl.getUniformLocation(this.shapes, "u_rows"),
            tile: gl.getUniformLocation(this.shapes, "u_tile")
        };
        this.blitAlpha = gl.getUniformLocation(this.blit, "u_alpha");

        gl.useProgram(this.shapes);
        gl.uniform1i(gl.getUniformLocation(this.shapes, "u_grad"), 0);
        gl.uniform1i(gl.getUniformLocation(this.shapes, "u_cloud"), 1);
        gl.uniform1i(gl.getUniformLocation(this.shapes, "u_sprite"), 2);
        gl.uniform1f(this.uniforms.rows, this.atlas.rows);
        gl.uniform1f(this.uniforms.tile, CLOUD_TILE);
        gl.useProgram(this.blit);
        gl.uniform1i(gl.getUniformLocation(this.blit, "u_source"), 3);

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        this.scenePainter = new GLPainter("scene", this);
        this.glowPainter = new GLPainter("glow", this);
        this.scenePainter.useCloud(this.tile);
        this.glowPainter.useCloud(this.tile);
    }

    // --- жизнь кадра ---------------------------------------------------------

    setGlowScale(scale: number): void {
        this.glowScale = scale;
    }

    resize(viewport: Viewport): void {
        this.viewport = viewport;
        const width = Math.max(1, Math.round(viewport.width * this.glowScale));
        const height = Math.max(1, Math.round(viewport.height * this.glowScale));
        if (!this.glow) this.glow = makeTarget(this.gl, width, height);
        else resizeTarget(this.gl, this.glow, width, height);
        this.fitSteps(width, height);
    }

    begin(viewport: Viewport): Painter {
        this.viewport = viewport;
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.useShapes(viewport.width, viewport.height, viewport.dpr);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.scenePainter.open();
        return this.scenePainter;
    }

    beginGlow(viewport: Viewport): Painter | null {
        const glow = this.glow;
        if (!glow) return null;
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, glow.frame);
        gl.viewport(0, 0, glow.width, glow.height);
        this.useShapes(viewport.width, viewport.height, glow.width / viewport.width);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.glowPainter.open();
        return this.glowPainter;
    }

    endGlow(): void {
        this.glowPainter.flush();
        this.glowReady = true;
    }

    end(): void {
        this.scenePainter.flush();
    }

    dispose(): void {
        const { gl } = this;
        this.scenePainter.flush();
        for (const step of this.steps) dropTarget(gl, step);
        this.steps.length = 0;
        if (this.glow) dropTarget(gl, this.glow);
        this.glow = null;
        this.atlas.dispose();
        gl.deleteProgram(this.shapes);
        gl.deleteProgram(this.blit);
    }

    // --- отправка фигур ------------------------------------------------------

    draw(data: Float32Array, count: number, sprite: WebGLTexture | null): void {
        const { gl } = this;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * STRIDE);
        if (sprite) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, sprite);
        }
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }

    /**
     * Свечение на сцену: спуск по пирамиде, подъём обратно и одно сложение
     * поверх кадра. Уменьшение вдвое с мягкой выборкой — это усреднение по
     * четырём пикселям, то есть то же размытие, только каждая ступень вчетверо
     * дешевле предыдущей.
     */
    bloom(strength: number, passes: number): void {
        const glow = this.glow;
        if (!glow || strength <= 0.01 || !this.glowReady) return;
        const count = Math.max(1, Math.min(PASSES.length, passes, this.steps.length));
        const { gl } = this;

        gl.bindVertexArray(this.blitVao);
        gl.useProgram(this.blit);
        gl.activeTexture(gl.TEXTURE3);

        let source = glow;
        gl.disable(gl.BLEND);
        for (let i = 0; i < count; i++) {
            const step = this.steps[i]!;
            this.pass(source, step, 1);
            source = step;
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = count - 1; i > 0; i--) {
            this.pass(this.steps[i]!, this.steps[i - 1]!, PASSES[i] ?? 0.8);
        }

        // Обратно на сцену: сложением, во весь экран, с общей силой свечения.
        // Уровень здесь, а не внутри размытия, — тогда ползунок отзывается
        // сразу, даже в кадре, где размытие взято от прошлого раза.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.bindTexture(gl.TEXTURE_2D, this.steps[0]!.texture);
        gl.uniform1f(this.blitAlpha, Math.min(1, (PASSES[0] ?? 0.62) * strength));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Вернуть всё, чем рисуются фигуры: за блумом идут ещё слои.
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.useShapes(this.viewport.width, this.viewport.height, this.viewport.dpr);
        gl.bindVertexArray(this.vao);
    }

    // --- мелочи --------------------------------------------------------------

    private pass(source: Target, into: Target, alpha: number): void {
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, into.frame);
        gl.viewport(0, 0, into.width, into.height);
        gl.bindTexture(gl.TEXTURE_2D, source.texture);
        gl.uniform1f(this.blitAlpha, alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /** Программа фигур и её вид сцены. */
    private useShapes(width: number, height: number, scale: number): void {
        const { gl } = this;
        gl.useProgram(this.shapes);
        gl.bindVertexArray(this.vao);
        gl.uniform2f(this.uniforms.size, width, height);
        gl.uniform1f(this.uniforms.scale, scale);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
        const cloud = this.images.get(this.tile, true);
        if (cloud) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, cloud);
        }
    }

    /** Ступени пирамиды под текущий буфер свечения. */
    private fitSteps(width: number, height: number): void {
        const { gl } = this;
        let w = width;
        let h = height;
        for (let i = 0; i < PASSES.length; i++) {
            w = Math.max(1, w >> 1);
            h = Math.max(1, h >> 1);
            const step = this.steps[i];
            if (step) resizeTarget(gl, step, w, h);
            else this.steps[i] = makeTarget(gl, w, h);
        }
    }

    private attribute(
        program: WebGLProgram,
        name: string,
        buffer: WebGLBuffer,
        size: number,
        stride: number,
        offset: number
    ): void {
        const { gl } = this;
        const at = gl.getAttribLocation(program, name);
        if (at < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
    }

    /** Атрибут, у которого своё значение на каждую фигуру, а не на каждый угол. */
    private instanced(program: WebGLProgram, name: string, offset: number): void {
        const { gl } = this;
        const at = gl.getAttribLocation(program, name);
        if (at < 0) return;
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, 4, gl.FLOAT, false, STRIDE * 4, offset * 4);
        gl.vertexAttribDivisor(at, 1);
    }
}
