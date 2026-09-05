/** Мелочь вокруг WebGL: собрать программу, завести буфер, завести картинку. */

export function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Не удалось создать шейдер");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? "";
        gl.deleteShader(shader);
        throw new Error(`Шейдер не собрался: ${log}`);
    }
    return shader;
}

export function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
    const program = gl.createProgram();
    if (!program) throw new Error("Не удалось создать программу");
    const vs = compile(gl, gl.VERTEX_SHADER, vertex);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Шейдеры больше не нужны: программа собрана и держит их сама.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) ?? "";
        gl.deleteProgram(program);
        throw new Error(`Программа не собралась: ${log}`);
    }
    return program;
}

/** Картинка под цель отрисовки: свечение и ступени его размытия. */
export interface Target {
    frame: WebGLFramebuffer;
    texture: WebGLTexture;
    width: number;
    height: number;
}

export function makeTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
    const texture = gl.createTexture();
    const frame = gl.createFramebuffer();
    if (!texture || !frame) throw new Error("Не удалось завести цель отрисовки");

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // Сглаживание при уменьшении и увеличении — это и есть размытие: спуск по
    // пирамиде усредняет по четырём пикселям, подъём растягивает обратно.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { frame, texture, width, height };
}

/** Перевести цель на новый размер. Возвращает `true`, если размер сменился. */
export function resizeTarget(
    gl: WebGL2RenderingContext,
    target: Target,
    width: number,
    height: number
): boolean {
    if (target.width === width && target.height === height) return false;
    target.width = width;
    target.height = height;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return true;
}

export function dropTarget(gl: WebGL2RenderingContext, target: Target): void {
    gl.deleteFramebuffer(target.frame);
    gl.deleteTexture(target.texture);
}
