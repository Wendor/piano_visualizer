import type { Layer } from "./types";
import type { Visualizer } from "./Visualizer";
import type { InputSource } from "../input/types";
import type { Surface } from "./surface";

export interface ModuleContext {
    readonly visualizer: Visualizer;
    readonly canvas: Surface;
}

export type LayerFactory = (context: ModuleContext, options?: Record<string, unknown>) => Layer;
export type InputFactory = (context: ModuleContext, options?: Record<string, unknown>) => InputSource;

/**
 * Реестр модулей. Слой или источник ввода регистрируется один раз под своим
 * идентификатором, после чего сцену можно собрать по списку имён — включая
 * модули, написанные снаружи проекта.
 */
export class Registry<F extends (context: ModuleContext, options?: Record<string, unknown>) => unknown> {
    private readonly items = new Map<string, F>();

    register(id: string, factory: F): this {
        if (this.items.has(id)) throw new Error(`Уже зарегистрировано: ${id}`);
        this.items.set(id, factory);
        return this;
    }

    create(id: string, context: ModuleContext, options?: Record<string, unknown>): ReturnType<F> {
        const factory = this.items.get(id);
        if (!factory) throw new Error(`Не найдено: ${id}. Доступно: ${this.ids().join(", ")}`);
        return factory(context, options) as ReturnType<F>;
    }

    has(id: string): boolean {
        return this.items.has(id);
    }

    ids(): string[] {
        return [...this.items.keys()];
    }
}

export const layerRegistry = new Registry<LayerFactory>();
export const inputRegistry = new Registry<InputFactory>();
