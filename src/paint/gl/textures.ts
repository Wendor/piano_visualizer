import { sample } from "../Gradient";
import type { Gradient } from "../Gradient";
import type { Surface } from "../../core/surface";

/**
 * Место, куда картинку кладут, а не откуда её читают.
 *
 * Привязка живёт не у картинки, а у ячейки: заводя новую, легко выбить из
 * ячейки ту, которой сейчас рисуют, — и шейдер начнёт брать цвет не оттуда.
 * Поэтому вся заливка идёт через отдельную ячейку, которой никто не читает.
 */
const SCRATCH = 7;

/** Сколько точек на градиент. Больше глаз не различит даже на всю ширину экрана. */
const STEPS = 256;
/**
 * Сколько градиентов помещается в атлас разом.
 *
 * Считать надо по худшему случаю, а он немаленький: у клавиатуры свой градиент
 * на каждый оттенок и на каждую роль — тело, кромка, налив, — а оттенок берётся
 * от клавиши. Восемь десятков строк на одну только клавиатуру, столько же на
 * шлейфы, ореолы и дымку. Строк не хватило — и цвет каждый кадр достаётся
 * чужой: сцена мерцает, а искать причину приходится глазами.
 */
const ROWS = 512;

/**
 * Атлас градиентов: каждый описанный градиент занимает строку картинки, а
 * шейдер берёт из неё цвет по доле пути.
 *
 * Так любой градиент — хоть двухцветный, хоть на пять точек — стоит одну
 * выборку из картинки, и никакой разницы между ними для видеочипа нет.
 */
export class GradientAtlas {
    readonly texture: WebGLTexture;
    readonly rows = ROWS;

    private book = new WeakMap<Gradient, number>();
    private used = 0;
    private warned = false;
    /**
     * Что сделать перед тем, как раздать строки заново. Фигуры, уже собранные
     * в пачку, ссылаются на старые строки: не отправив их, мы перекрасили бы
     * половину кадра задним числом.
     */
    onWrap: (() => void) | null = null;
    private readonly line = new Uint8Array(STEPS * 4);
    private readonly rgba = new Float32Array(4);

    constructor(private readonly gl: WebGL2RenderingContext) {
        const texture = gl.createTexture();
        if (!texture) throw new Error("Не удалось завести атлас градиентов");
        this.texture = texture;
        gl.activeTexture(gl.TEXTURE0 + SCRATCH);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, STEPS, ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        // Вдоль строки цвет размазывается — иначе градиент вышел бы лесенкой.
        // Поперёк соседние строки не смешиваются: строка берётся по центру.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /** Номер строки, в которой лежит этот градиент. Печётся при первой встрече. */
    row(gradient: Gradient): number {
        const found = this.book.get(gradient);
        if (found !== undefined) return found;

        // Переполнение — признак того, что ключ градиента слишком дробный:
        // проще начать заново, чем городить вытеснение. Но сказать об этом
        // надо: если круг пошёл по второму разу в каждом кадре, сцена будет
        // мерцать, и на глаз это выглядит чем угодно, только не переполнением.
        if (this.used >= ROWS) {
            this.onWrap?.();
            this.book = new WeakMap();
            this.used = 0;
            if (!this.warned) {
                this.warned = true;
                console.warn(`Атлас градиентов переполнен: строк всего ${ROWS}`);
            }
        }

        const row = this.used++;
        this.bake(gradient, row);
        this.book.set(gradient, row);
        return row;
    }

    private bake(gradient: Gradient, row: number): void {
        const { line, rgba } = this;
        for (let i = 0; i < STEPS; i++) {
            sample(gradient.stops, i / (STEPS - 1), rgba, 0);
            const at = i * 4;
            line[at] = Math.round(Math.min(1, Math.max(0, rgba[0]!)) * 255);
            line[at + 1] = Math.round(Math.min(1, Math.max(0, rgba[1]!)) * 255);
            line[at + 2] = Math.round(Math.min(1, Math.max(0, rgba[2]!)) * 255);
            line[at + 3] = Math.round(Math.min(1, Math.max(0, rgba[3]!)) * 255);
        }
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0 + SCRATCH);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, STEPS, 1, gl.RGBA, gl.UNSIGNED_BYTE, line);
    }

    dispose(): void {
        this.gl.deleteTexture(this.texture);
    }
}

/**
 * Картинки, которые сцена рисует как есть: облачный тайл и кэш клавиатуры.
 * Холст перерисовывает их редко, видеочип держит копию у себя и обновляет
 * её только по слову «перерисовано».
 */
export class ImageBook {
    private readonly items = new WeakMap<Surface, WebGLTexture>();

    constructor(private readonly gl: WebGL2RenderingContext) {}

    /** Картинка на видеочипе. Заводится при первой встрече. */
    get(image: Surface, repeat = false): WebGLTexture | null {
        const found = this.items.get(image);
        if (found) return found;

        const { gl } = this;
        const texture = gl.createTexture();
        if (!texture) return null;
        gl.activeTexture(gl.TEXTURE0 + SCRATCH);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        this.items.set(image, texture);
        this.upload(image, texture);
        return texture;
    }

    /** Картинку перерисовали — залить её заново. */
    refresh(image: Surface): void {
        const texture = this.items.get(image);
        if (texture) this.upload(image, texture);
    }

    private upload(image: Surface, texture: WebGLTexture): void {
        const { gl } = this;
        if (image.width < 1 || image.height < 1) return;
        gl.activeTexture(gl.TEXTURE0 + SCRATCH);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // Цвет на холсте уже умножен на прозрачность — на видеочипе он должен
        // лежать так же, иначе полупрозрачное поедет по краям.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
}
