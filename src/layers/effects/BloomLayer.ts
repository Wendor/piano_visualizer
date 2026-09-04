import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import type { GlowBuffer } from "../../core/GlowBuffer";
import type { Quality } from "../../core/Quality";
import { clamp } from "../../core/math";
import { Trial } from "../../core/Trial";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";

export interface BloomOptions {
    /** Общая сила свечения: 0 — выключено, 2 — максимум. */
    strength: number;
    /**
     * Вклад ступеней размытия, от самой резкой к самой мягкой. Длина списка —
     * сколько их всего; ступень качества может взять меньше.
     *
     * Числа перемножаются: ступень поднимается в предыдущую и только потом
     * попадает на экран, поэтому широкий свет виден как произведение всех
     * весов над ним. Здесь они подобраны так, чтобы вклады масштабов на экране
     * были 0.62, 0.52, 0.42 и 0.34.
     */
    passes: number[];
}

/** Холст с контекстом: ступень пирамиды или накопитель размытий. */
interface Surface {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
}

/** Каким способом движок размывает дешевле. Выясняется замером, а не догадкой. */
type Road = "pyramid" | "filter";

const supportsFilter = ((): boolean => {
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return false;
    probe.filter = "blur(2px)";
    return probe.filter === "blur(2px)";
})();

/**
 * Накопленный буфер свечения кладётся на сцену одним размытым рисунком.
 *
 * Размыть его можно двумя дорогами, и какая дешевле — зависит от движка, а не
 * от нашего вкуса:
 *
 * - **пирамида уменьшений.** Уменьшение вдвое — это усреднение по четырём
 *   пикселям, то есть то же размытие, только его цена падает вчетверо с каждой
 *   ступенью. В Chrome без ускорения холста она вдвое дешевле фильтра;
 * - **`ctx.filter = blur(...)`.** В Chrome фильтр стоит одинаково и на вчетверо
 *   меньшем буфере: платят не за пиксели, а за поверхность, которую движок
 *   заводит на каждый проход. Зато Firefox размывает им почти даром, а вот
 *   `drawImage` с уменьшением между холстами роняет на программный путь —
 *   пирамида там стоит пятьдесят миллисекунд вместо сотой доли.
 *
 * Поэтому сцена проезжает обе на живых кадрах и остаётся на дешёвой — см.
 * `Trial`. Яркость у дорог одна и та же, поэтому проба на глаз незаметна.
 */
export class BloomLayer extends BaseLayer {
    readonly id = "effects.bloom";
    readonly stage = Stage.Bloom;
    readonly title = "Свечение";
    readonly options: BloomOptions;

    /** Ступени пирамиды: каждая вдвое меньше предыдущей. */
    private readonly steps: Surface[] = [];
    /** Накопитель для дороги через фильтр: размером с буфер свечения. */
    private accumulator: Surface | null = null;
    /** Из какого обновления буфера свечения собрано размытие. */
    private painted = -1;
    /**
     * Какой дорогой размывать. Без фильтра выбора нет: пирамида — единственное,
     * что умеют все.
     */
    private readonly trial = new Trial<Road>(supportsFilter ? ["pyramid", "filter"] : ["pyramid"]);
    /** Размытие в этом кадре пересобрано — значит кадр годится для замера. */
    private rebuilt = false;

    constructor(
        private readonly glow: GlowBuffer,
        private readonly quality: Quality,
        options: Partial<BloomOptions> = {}
    ) {
        super();
        this.options = { strength: 1, passes: [0.62, 0.84, 0.81, 0.81], ...options };
    }

    override params(): ParamSpec[] {
        return [
            {
                type: "number",
                key: "strength",
                label: "Сила свечения",
                group: "effects",
                min: 0,
                max: 2,
                step: 0.1,
                format: percent,
                get: () => this.options.strength,
                set: (value) => this.setStrength(value)
            }
        ];
    }

    /** Пока сила на нуле, свечение никому не нужно — и наполнять его незачем. */
    needsGlow(): boolean {
        return this.options.strength > 0.01;
    }

    setStrength(value: number): number {
        this.options.strength = clamp(value, 0, 2);
        return this.options.strength;
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        const { strength } = this.options;
        if (strength <= 0.01) return;

        const { width, height } = scene.viewport;
        const source = this.glow.canvas;
        if (source.width < 2 || source.height < 2) return;

        const started = performance.now();
        const blurred = this.blurred(source);
        if (!blurred) return;

        // Общий уровень — на экране, а не внутри размытия: тогда ползунок силы
        // отзывается сразу, даже в кадре, где размытие взято от прошлого раза.
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = Math.min(1, (this.options.passes[0] ?? 0.62) * strength);
        g.drawImage(blurred, 0, 0, width, height);
        g.globalAlpha = 1;

        // Судим по цене всего слоя, а не одного размытия: рисование ленивое, и
        // отложенную работу оплачивает тот, кто первым попросит результат, —
        // здесь это вывод на экран. Замер имеет смысл только там, где размытие
        // и правда пересобрали.
        if (this.rebuilt && !this.trial.done) this.trial.sample(performance.now() - started);
    }

    /**
     * Готовое размытие. Буфер свечения наполняется реже кадра, и пока в нём то
     * же самое, размывать нечего.
     */
    private blurred(source: HTMLCanvasElement): HTMLCanvasElement | null {
        const count = clamp(
            Math.min(this.options.passes.length, this.quality.profile.bloomPasses),
            1,
            this.options.passes.length
        );
        // Перестройка холстов посреди пробы смешала бы замеры разных размеров:
        // ступень качества меняется как раз тогда, когда сцене тяжело. Пробу
        // начинаем заново — на буфере, с которым сцене и жить.
        if (this.fit(source, count)) this.trial.restart();
        if (this.steps.length === 0) return null;

        const road = this.trial.road;
        this.rebuilt = this.glow.version !== this.painted;
        if (this.rebuilt) {
            this.build(road, source, count);
            this.painted = this.glow.version;
        }
        return this.result(road);
    }

    private result(road: Road): HTMLCanvasElement | null {
        return road === "filter" ? (this.accumulator?.canvas ?? null) : (this.steps[0]?.canvas ?? null);
    }

    private build(road: Road, source: HTMLCanvasElement, count: number): void {
        if (road === "pyramid") this.buildPyramid(source, count);
        else this.buildFilter(source, count);
    }

    /** Спуск по пирамиде и подъём обратно: масштабы складываются в первой ступени. */
    private buildPyramid(source: HTMLCanvasElement, count: number): void {
        let previous: HTMLCanvasElement = source;
        for (let i = 0; i < count; i++) {
            const step = this.steps[i]!;
            // `copy` вместо очистки и рисования: прошлого кадра здесь не нужно.
            step.ctx.globalCompositeOperation = "copy";
            step.ctx.globalAlpha = 1;
            step.ctx.drawImage(previous, 0, 0, step.canvas.width, step.canvas.height);
            previous = step.canvas;
        }

        for (let i = count - 1; i > 0; i--) {
            const lower = this.steps[i - 1]!;
            lower.ctx.globalCompositeOperation = "lighter";
            lower.ctx.globalAlpha = Math.min(1, this.options.passes[i] ?? 0.8);
            lower.ctx.drawImage(this.steps[i]!.canvas, 0, 0, lower.canvas.width, lower.canvas.height);
            lower.ctx.globalAlpha = 1;
        }
    }

    /**
     * Те же масштабы, но радиусом фильтра: ступень пирамиды с номером `i`
     * усредняет по 2^(i+1) пикселям, столько же берёт и `blur`. Веса — те же
     * произведения, что складывались бы при подъёме, иначе дороги дали бы
     * разную картинку.
     */
    private buildFilter(source: HTMLCanvasElement, count: number): void {
        const acc = this.accumulator;
        if (!acc) return;

        acc.ctx.globalCompositeOperation = "copy";
        acc.ctx.globalAlpha = 1;
        acc.ctx.filter = "blur(2px)";
        acc.ctx.drawImage(source, 0, 0);

        acc.ctx.globalCompositeOperation = "lighter";
        let weight = 1;
        for (let i = 1; i < count; i++) {
            weight *= this.options.passes[i] ?? 0.8;
            acc.ctx.filter = `blur(${2 << i}px)`;
            acc.ctx.globalAlpha = Math.min(1, weight);
            acc.ctx.drawImage(source, 0, 0);
        }
        acc.ctx.filter = "none";
        acc.ctx.globalAlpha = 1;
    }

    /** Развести холсты под текущий буфер. Возвращает `true`, если размеры сменились. */
    private fit(source: HTMLCanvasElement, count: number): boolean {
        let changed = this.size(
            this.accumulator ?? (this.accumulator = this.make()),
            source.width,
            source.height
        );
        let width = source.width;
        let height = source.height;

        for (let i = 0; i < count; i++) {
            width = Math.max(1, width >> 1);
            height = Math.max(1, height >> 1);
            const step = this.steps[i] ?? (this.steps[i] = this.make());
            if (this.size(step, width, height)) changed = true;
        }
        // Лишние ступени остались от прежней ступени качества: они держат
        // память и путались бы под ногами при следующем сравнении размеров.
        if (this.steps.length > count) this.steps.length = count;
        return changed;
    }

    private size(surface: Surface, width: number, height: number): boolean {
        if (surface.canvas.width === width && surface.canvas.height === height) return false;
        surface.canvas.width = width;
        surface.canvas.height = height;
        return true;
    }

    private make(): Surface {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Контекст блума недоступен");
        return { canvas, ctx };
    }
}
