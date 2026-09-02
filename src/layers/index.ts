import { layerRegistry } from "../core/registry";
import { BackgroundLayer } from "./BackgroundLayer";
import { KeyboardLayer } from "./KeyboardLayer";
import { RisingNotesLayer } from "./notes/RisingNotesLayer";
import { BloomLayer } from "./effects/BloomLayer";
import { KeyLightLayer } from "./effects/KeyLightLayer";
import { SparksLayer } from "./effects/SparksLayer";
import { StrikeLineLayer } from "./effects/StrikeLineLayer";
import { TopFadeLayer } from "./effects/TopFadeLayer";

export { BackgroundLayer, KeyboardLayer, RisingNotesLayer };
export { BloomLayer, KeyLightLayer, SparksLayer, StrikeLineLayer, TopFadeLayer };

let registered = false;

/** Регистрация встроенных слоёв. Свои модули добавляются так же. */
export function registerBuiltinLayers(): void {
    if (registered) return;
    registered = true;

    layerRegistry
        .register("background", (_c, o) => new BackgroundLayer(o as never))
        .register("notes.rising", (_c, o) => new RisingNotesLayer(o as never))
        .register("effects.sparks", (_c, o) => new SparksLayer(o as never))
        .register("effects.keyLight", (_c, o) => new KeyLightLayer(o as never))
        .register("effects.bloom", (c, o) => new BloomLayer(c.visualizer.glow, o as never))
        .register("effects.topFade", (_c, o) => new TopFadeLayer(o as never))
        .register("effects.strikeLine", (_c, o) => new StrikeLineLayer(o as never))
        .register("keyboard", (_c, o) => new KeyboardLayer(o as never));
}

export interface StackEntry {
    id: string;
    options?: Record<string, unknown>;
}

/** Набор слоёв по умолчанию. Порядок не важен — сцена сортирует по ступени. */
export const DEFAULT_STACK: readonly StackEntry[] = [
    { id: "background" },
    { id: "notes.rising", options: { hollowNaturals: true } },
    { id: "effects.sparks" },
    { id: "effects.keyLight" },
    { id: "effects.bloom" },
    { id: "effects.topFade" },
    { id: "effects.strikeLine" },
    { id: "keyboard" }
];
