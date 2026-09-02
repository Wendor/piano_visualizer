import { GlowBuffer } from "./GlowBuffer";
import { layerRegistry, inputRegistry } from "./registry";
import { Scene } from "./Scene";
import type { Layer, Viewport } from "./types";
import type { InputSource } from "../input/types";

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

    private readonly layerList: Layer[] = [];
    private readonly inputList: InputSource[] = [];
    private readonly maxDpr: number;
    private frame = 0;
    private lastTime = 0;
    private running = false;
    private readonly onResize = () => this.resize();

    constructor(options: VisualizerOptions) {
        this.canvas = options.canvas;
        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("2D-контекст недоступен");
        this.ctx = ctx;
        this.maxDpr = options.maxDpr ?? 2;
        this.glow = new GlowBuffer(options.glowScale ?? 0.25);
    }

    // --- слои ---------------------------------------------------------------

    addLayer(layer: Layer): this {
        this.layerList.push(layer);
        this.layerList.sort((a, b) => a.stage - b.stage);
        layer.init?.(this.scene);
        if (this.scene.viewport.width > 0) layer.resize?.(this.scene);
        return this;
    }

    addLayers(list: readonly Layer[]): this {
        for (const layer of list) this.addLayer(layer);
        return this;
    }

    removeLayer(id: string): boolean {
        const index = this.layerList.findIndex((layer) => layer.id === id);
        if (index < 0) return false;
        this.layerList[index]?.dispose?.();
        this.layerList.splice(index, 1);
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
        const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
        const viewport: Viewport = { width: window.innerWidth, height: window.innerHeight, dpr };

        this.canvas.width = Math.round(viewport.width * dpr);
        this.canvas.height = Math.round(viewport.height * dpr);
        this.canvas.style.width = `${viewport.width}px`;
        this.canvas.style.height = `${viewport.height}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.glow.resize(viewport);
        this.scene.resize(viewport);
        for (const layer of this.layerList) layer.resize?.(this.scene);
    }

    private readonly tick = (now: number): void => {
        const dt = Math.min(0.05, (now - this.lastTime) / 1000);
        this.lastTime = now;
        this.scene.advance(dt);
        this.render(dt);
        if (this.running) this.frame = requestAnimationFrame(this.tick);
    };

    /** Один кадр: обновление → буфер свечения → основной холст. */
    render(dt: number): void {
        const { scene, ctx } = this;

        for (const layer of this.layerList) if (layer.enabled) layer.update?.(scene, dt);

        const glowCtx = this.glow.begin(scene.viewport);
        for (const layer of this.layerList) if (layer.enabled) layer.drawGlow?.(glowCtx, scene);

        ctx.setTransform(scene.viewport.dpr, 0, 0, scene.viewport.dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.filter = "none";
        for (const layer of this.layerList) {
            if (!layer.enabled || !layer.draw) continue;
            ctx.save();
            layer.draw(ctx, scene);
            ctx.restore();
        }
    }
}
