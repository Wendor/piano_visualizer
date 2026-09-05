import { Cadence } from "./Cadence";
import { FrameClock } from "./FrameClock";
import { FrameProfiler } from "./FrameProfiler";
import { paintStack, updateStack, wantsGlow } from "./paint";
import { Quality } from "./Quality";
import { layerRegistry, inputRegistry } from "./registry";
import { askFrame, coalesce, dropFrame } from "./schedule";
import { Scene } from "./Scene";
import type { LayerFault } from "./paint";
import type { Layer } from "./types";
import type { Surface } from "./surface";
import { makeEngine } from "../paint/engine";
import type { Engine } from "../paint/Painter";
import { canvasSize, resolveViewport } from "./viewport";
import type { InputSource } from "../input/types";

/** Слой добавлен (`added = true`) или удалён. */
export type LayerHook = (layer: Layer, added: boolean) => void;

/** Откуда сцена узнаёт размер окна. В рабочем потоке его сообщают снаружи. */
export type ViewportSource = () => { width: number; height: number; devicePixelRatio: number };

const windowViewport: ViewportSource = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1
});

/** Как завести движок рисования на этом холсте. */
export type EngineSource = (canvas: Surface) => Engine;

export interface VisualizerOptions {
    canvas: Surface;
    /**
     * Жёсткий потолок плотности холста сверх того, что называет ступень
     * качества. Обычно его нет: потолок — дело ступени.
     */
    maxDpr?: number;
    /**
     * Чем рисовать. По умолчанию — холст 2D: он есть везде. Видеочип быстрее
     * там, где холст растеризует процессор, но его может не оказаться вовсе.
     */
    engine?: EngineSource;
    /**
     * Размер окна. По умолчанию — само окно; в рабочем потоке окна нет, и его
     * размер приходит сообщением, как и всё остальное.
     */
    viewport?: ViewportSource;
    /**
     * Шагать по развёртке или по метке времени кадра. По развёртке — обычно:
     * метка приходит дрожащей, и это дрожание видно как рваный ход. «Как есть»
     * нужно ровно затем, чтобы это сравнить.
     */
    clock?: "even" | "raw";
    /**
     * Рисовать ли. Когда картину собирает рабочий поток, в главном остаётся
     * двойник: он держит сцену, слои и их настройки — ввод, звук и панель
     * настроек работают с ним, — но холста не касается.
     */
    paints?: boolean;
}

/**
 * Оркестратор: холст, цикл кадров, набор слоёв и источников ввода.
 * Слои и источники можно добавлять и убирать на ходу.
 */
export class Visualizer {
    readonly scene = new Scene();
    readonly canvas: Surface;
    /** Чем рисуем. У двойника, который не рисует, движка нет вовсе. */
    readonly engine: Engine | null;
    /** Ступень качества: она же решает, в каком разрешении рисовать. */
    readonly quality = new Quality();
    /** Замер кадра по слоям. Выключен, пока его не попросят. */
    readonly profiler = new FrameProfiler();

    private readonly layerList: Layer[] = [];
    private readonly inputList: InputSource[] = [];
    private readonly maxDpr: number;
    private readonly viewportOf: ViewportSource;
    private readonly paints: boolean;
    private frame = 0;
    private lastTime = 0;
    /** Часы кадра: ровный шаг по развёртке вместо дрожащей метки времени. */
    private readonly clock = new FrameClock();
    private readonly evenClock: boolean;
    private running = false;
    private readonly layerHooks = new Set<LayerHook>();
    private readonly frameHooks = new Set<(dt: number) => void>();
    private readonly faultHooks = new Set<LayerFault>();
    // Событий resize приходит поток, а перестройка холста и кэшей дорогая:
    // на кадр хватает одной.
    private readonly onResize = coalesce(() => this.resize());
    /** Как часто наполнять буфер свечения. Частоту называет движок. */
    private readonly glowClock: Cadence;

    constructor(options: VisualizerOptions) {
        this.canvas = options.canvas;
        this.maxDpr = options.maxDpr ?? Infinity;
        this.viewportOf = options.viewport ?? windowViewport;
        this.paints = options.paints ?? true;
        this.evenClock = options.clock !== "raw";
        // Двойнику движок не заводим вовсе: он держит сцену и настройки ради
        // ввода и звука, а холста не касается — незачем ему ни контекст, ни
        // буфер свечения, ни память под них.
        this.engine = this.paints ? (options.engine ?? ((c) => makeEngine(c)))(this.canvas) : null;
        this.engine?.setGlowScale(this.quality.profile.glowScale);
        this.glowClock = new Cadence(this.engine?.glowHz ?? 40);
        this.quality.events.on("change", () => this.resize());
    }

    // --- слои ---------------------------------------------------------------

    addLayer(layer: Layer): this {
        this.layerList.push(layer);
        this.layerList.sort((a, b) => a.stage - b.stage);
        layer.init?.(this.scene);
        if (this.scene.viewport.width > 0) layer.resize?.(this.scene);
        for (const hook of this.layerHooks) hook(layer, true);
        return this;
    }

    /**
     * Уведомление о появлении и уходе слоёв: так реестр настроек подхватывает
     * параметры слоя, добавленного уже после старта.
     */
    onLayerChange(hook: LayerHook): () => void {
        this.layerHooks.add(hook);
        return () => this.layerHooks.delete(hook);
    }

    /**
     * Уведомление о прошедшем кадре. Нужно тем, кто идёт в ногу со сценой, но
     * своего цикла заводить не хочет: второй цикл кадров в том же потоке —
     * лишний повод для рассинхрона.
     */
    onFrame(hook: (dt: number) => void): () => void {
        this.frameHooks.add(hook);
        return () => this.frameHooks.delete(hook);
    }

    /**
     * Уведомление о сбойном слое: он уже выключен, сцена жива. Подписчик
     * решает, показывать ли это человеку.
     */
    onLayerFault(hook: LayerFault): () => void {
        this.faultHooks.add(hook);
        return () => this.faultHooks.delete(hook);
    }

    addLayers(list: readonly Layer[]): this {
        for (const layer of list) this.addLayer(layer);
        return this;
    }

    removeLayer(id: string): boolean {
        const index = this.layerList.findIndex((layer) => layer.id === id);
        if (index < 0) return false;
        const layer = this.layerList[index]!;
        layer.dispose?.();
        this.layerList.splice(index, 1);
        for (const hook of this.layerHooks) hook(layer, false);
        return true;
    }

    layer<T extends Layer = Layer>(id: string): T | undefined {
        return this.layerList.find((item) => item.id === id) as T | undefined;
    }

    toggleLayer(id: string, enabled?: boolean): boolean {
        const layer = this.layer(id);
        if (!layer) return false;
        layer.enabled = enabled ?? !layer.enabled;
        return layer.enabled;
    }

    get layerIds(): string[] {
        return this.layerList.map((layer) => layer.id);
    }

    /** Собрать слой из реестра по идентификатору и сразу добавить в сцену. */
    createLayer(id: string, options?: Record<string, unknown>): Layer {
        const layer = layerRegistry.create(id, { visualizer: this, canvas: this.canvas }, options);
        this.addLayer(layer);
        return layer;
    }

    // --- ввод ---------------------------------------------------------------

    addInput(input: InputSource): this {
        this.inputList.push(input);
        input.attach(this.scene);
        return this;
    }

    createInput(id: string, options?: Record<string, unknown>): InputSource {
        const input = inputRegistry.create(id, { visualizer: this, canvas: this.canvas }, options);
        this.addInput(input);
        return input;
    }

    removeInput(id: string): boolean {
        const index = this.inputList.findIndex((input) => input.id === id);
        if (index < 0) return false;
        this.inputList[index]?.detach();
        this.inputList.splice(index, 1);
        return true;
    }

    input<T extends InputSource = InputSource>(id: string): T | undefined {
        return this.inputList.find((item) => item.id === id) as T | undefined;
    }

    // --- жизненный цикл -----------------------------------------------------

    start(): this {
        if (this.running) return this;
        this.running = true;
        // Окно само сообщает о своём размере; в рабочем потоке о нём говорят
        // снаружи вызовом `resize`.
        if (typeof window !== "undefined") window.addEventListener("resize", this.onResize);
        this.resize();
        this.lastTime = performance.now();
        this.frame = askFrame(this.tick);
        return this;
    }

    stop(): void {
        this.running = false;
        // Пока сцена стоит, время идёт: следующий кадр — первый заново.
        this.clock.reset();
        dropFrame(this.frame);
        if (typeof window !== "undefined") window.removeEventListener("resize", this.onResize);
    }

    dispose(): void {
        this.stop();
        for (const input of this.inputList) input.detach();
        this.inputList.length = 0;
        for (const layer of this.layerList) layer.dispose?.();
        this.layerList.length = 0;
    }

    resize(): void {
        const { renderScale, glowScale, maxPixels, maxDpr } = this.quality.profile;
        // Холст меньше экрана, а CSS-размер прежний: браузер растянет картинку
        // при выводе — это самый дешёвый способ вернуть кадр в бюджет.
        const outer = this.viewportOf();
        const viewport = resolveViewport({
            width: outer.width,
            height: outer.height,
            devicePixelRatio: outer.devicePixelRatio,
            maxDpr: Math.min(this.maxDpr, maxDpr),
            renderScale,
            maxPixels
        });
        this.engine?.setGlowScale(glowScale);
        this.scene.resize(viewport);
        // Двойнику холст не нужен: он живёт ради сцены и настроек. Слоям тоже
        // незачем перестраивать кэши картинки, которую никто не увидит.
        if (!this.paints) return;

        const size = canvasSize(viewport);
        this.canvas.width = size.width;
        this.canvas.height = size.height;
        // Растяжение до размера окна — дело разметки, и стиль есть только у
        // холста страницы: в рабочем потоке холст голый, а размером на экране
        // распоряжается тот, кто им владеет.
        if ("style" in this.canvas) {
            this.canvas.style.width = `${viewport.width}px`;
            this.canvas.style.height = `${viewport.height}px`;
        }
        this.engine?.resize(viewport);
        // Буфер только что очищен пересозданием холста: ждать своей очереди
        // ему нельзя, иначе кадр выйдет без свечения вовсе.
        this.glowClock.force();
        for (const layer of this.layerList) layer.resize?.(this.scene);
    }

    private readonly onFault: LayerFault = (layer, error) => {
        for (const hook of this.faultHooks) hook(layer, error);
    };

    private readonly tick = (now: number): void => {
        // Промежуток и шаг — разные вещи. Промежуток сырой: счётчик и
        // автоподбор качества обязаны видеть, как кадры шли на самом деле.
        // Шаг сцены — по развёртке: дрожание метки времени в картинку не идёт.
        const frameMs = now - this.lastTime;
        const dt = Math.min(0.05, this.evenClock ? this.clock.step(now) : frameMs / 1000);
        this.lastTime = now;

        const started = performance.now();
        this.scene.advance(dt);
        for (const hook of this.frameHooks) hook(dt);
        if (this.paints) {
            this.render(dt);
            this.quality.sample(performance.now() - started, frameMs);
            this.profiler.endFrame();
        }
        if (this.running) this.frame = askFrame(this.tick);
    };

    /**
     * Один кадр: обновление → буфер свечения → основной холст. Свечение
     * наполняется реже кадра, поэтому средний кадр обходится одним проходом
     * по слоям вместо двух.
     */
    render(dt: number): void {
        const { scene, engine } = this;
        if (!engine) return;

        updateStack(this.layerList, scene, dt, this.onFault, this.profiler);

        // Свечение рисуют, пока есть кому его показать. Выключенный блум —
        // это не «сцена без свечения», это сцена, которой незачем его считать.
        if (wantsGlow(this.layerList) && this.glowClock.due(dt)) {
            const glow = engine.beginGlow(scene.viewport);
            if (glow) {
                paintStack(glow, this.layerList, "drawGlow", scene, this.onFault, this.profiler);
                engine.endGlow();
            }
        }

        paintStack(engine.begin(scene.viewport), this.layerList, "draw", scene, this.onFault, this.profiler);
        engine.end();
    }
}
