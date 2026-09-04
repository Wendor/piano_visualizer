import { Cadence } from "./Cadence";
import { FrameProfiler } from "./FrameProfiler";
import { GlowBuffer } from "./GlowBuffer";
import { paintStack, updateStack } from "./paint";
import { Quality } from "./Quality";
import { layerRegistry, inputRegistry } from "./registry";
import { coalesce } from "./schedule";
import { Scene } from "./Scene";
import type { LayerFault } from "./paint";
import type { Layer } from "./types";
import { canvasSize, resolveViewport } from "./viewport";
import type { InputSource } from "../input/types";

/**
 * Частота обновления буфера свечения. Свет размыт и инерционен: между 40 и 60
 * обновлениями в секунду глаз разницы не видит, а работа — размытие плюс всё,
 * что слои рисуют в буфер, — сокращается на треть и больше.
 */
const GLOW_HZ = 40;

/** Слой добавлен (`added = true`) или удалён. */
export type LayerHook = (layer: Layer, added: boolean) => void;

export interface VisualizerOptions {
    canvas: HTMLCanvasElement;
    /** Потолок devicePixelRatio: 2 хватает и на Retina. */
    maxDpr?: number;
    glowScale?: number;
}

/**
 * Оркестратор: холст, цикл кадров, набор слоёв и источников ввода.
 * Слои и источники можно добавлять и убирать на ходу.
 */
export class Visualizer {
    readonly scene = new Scene();
    readonly canvas: HTMLCanvasElement;
    readonly ctx: CanvasRenderingContext2D;
    readonly glow: GlowBuffer;
    /** Ступень качества: она же решает, в каком разрешении рисовать. */
    readonly quality = new Quality();
    /** Замер кадра по слоям. Выключен, пока его не попросят. */
    readonly profiler = new FrameProfiler();

    private readonly layerList: Layer[] = [];
    private readonly inputList: InputSource[] = [];
    private readonly maxDpr: number;
    private frame = 0;
    private lastTime = 0;
    private running = false;
    private readonly layerHooks = new Set<LayerHook>();
    private readonly faultHooks = new Set<LayerFault>();
    // Событий resize приходит поток, а перестройка холста и кэшей дорогая:
    // на кадр хватает одной.
    private readonly onResize = coalesce(() => this.resize());
    /** Буфер свечения наполняется реже кадра — см. `GLOW_HZ`. */
    private readonly glowClock = new Cadence(GLOW_HZ);

    constructor(options: VisualizerOptions) {
        this.canvas = options.canvas;
        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("2D-контекст недоступен");
        this.ctx = ctx;
        this.maxDpr = options.maxDpr ?? 2;
        this.glow = new GlowBuffer(options.glowScale ?? this.quality.profile.glowScale);
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
        window.addEventListener("resize", this.onResize);
        this.resize();
        this.lastTime = performance.now();
        this.frame = requestAnimationFrame(this.tick);
        return this;
    }

    stop(): void {
        this.running = false;
        cancelAnimationFrame(this.frame);
        window.removeEventListener("resize", this.onResize);
    }

    dispose(): void {
        this.stop();
        for (const input of this.inputList) input.detach();
        this.inputList.length = 0;
        for (const layer of this.layerList) layer.dispose?.();
        this.layerList.length = 0;
    }

    resize(): void {
        const { renderScale, glowScale, maxPixels } = this.quality.profile;
        // Холст меньше экрана, а CSS-размер прежний: браузер растянет картинку
        // при выводе — это самый дешёвый способ вернуть кадр в бюджет.
        const viewport = resolveViewport({
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            maxDpr: this.maxDpr,
            renderScale,
            maxPixels
        });
        const size = canvasSize(viewport);
        this.glow.setScale(glowScale);

        this.canvas.width = size.width;
        this.canvas.height = size.height;
        this.canvas.style.width = `${viewport.width}px`;
        this.canvas.style.height = `${viewport.height}px`;
        this.ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

        this.glow.resize(viewport);
        // Буфер только что очищен пересозданием холста: ждать своей очереди
        // ему нельзя, иначе кадр выйдет без свечения вовсе.
        this.glowClock.force();
        this.scene.resize(viewport);
        for (const layer of this.layerList) layer.resize?.(this.scene);
    }

    private readonly onFault: LayerFault = (layer, error) => {
        for (const hook of this.faultHooks) hook(layer, error);
    };

    private readonly tick = (now: number): void => {
        const frameMs = now - this.lastTime;
        const dt = Math.min(0.05, frameMs / 1000);
        this.lastTime = now;

        const started = performance.now();
        this.scene.advance(dt);
        this.render(dt);
        this.quality.sample(performance.now() - started, frameMs);
        this.profiler.endFrame();
        if (this.running) this.frame = requestAnimationFrame(this.tick);
    };

    /**
     * Один кадр: обновление → буфер свечения → основной холст. Свечение
     * наполняется реже кадра, поэтому средний кадр обходится одним проходом
     * по слоям вместо двух.
     */
    render(dt: number): void {
        const { scene, ctx } = this;

        updateStack(this.layerList, scene, dt, this.onFault, this.profiler);

        if (this.glowClock.due(dt)) {
            const glowCtx = this.glow.begin(scene.viewport);
            paintStack(glowCtx, this.layerList, "drawGlow", scene, this.onFault, this.profiler);
        }

        ctx.setTransform(scene.viewport.dpr, 0, 0, scene.viewport.dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.filter = "none";
        paintStack(ctx, this.layerList, "draw", scene, this.onFault, this.profiler);
    }
}
