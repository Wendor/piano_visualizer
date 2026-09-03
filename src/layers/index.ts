import { layerRegistry } from "../core/registry";
import { BackgroundLayer } from "./BackgroundLayer";
import { KeyboardLayer } from "./KeyboardLayer";
import { RisingNotesLayer } from "./notes/RisingNotesLayer";
import { FallingNotesLayer } from "./notes/FallingNotesLayer";
import { BloomLayer } from "./effects/BloomLayer";
import { DustLayer } from "./effects/DustLayer";
import { NebulaLayer } from "./effects/NebulaLayer";
import { KeyLightLayer } from "./effects/KeyLightLayer";
import { SparksLayer } from "./effects/SparksLayer";
import { StrikeLineLayer } from "./effects/StrikeLineLayer";
import { TopFadeLayer } from "./effects/TopFadeLayer";

export { BackgroundLayer, KeyboardLayer, RisingNotesLayer, FallingNotesLayer };
export { BloomLayer, KeyLightLayer, SparksLayer, StrikeLineLayer, TopFadeLayer };
export { DustLayer, NebulaLayer };

let registered = false;

/** Регистрация встроенных слоёв. Свои модули добавляются так же. */
export function registerBuiltinLayers(): void {
    if (registered) return;
    registered = true;

    layerRegistry
        .register("background", (_c, o) => new BackgroundLayer(o as never))
        .register("notes.rising", () => new RisingNotesLayer())
        .register("notes.falling", () => new FallingNotesLayer())
        .register("effects.nebula", (c, o) => new NebulaLayer(c.visualizer.quality, o as never))
        .register("effects.dust", (c, o) => new DustLayer(c.visualizer.quality, o as never))
        .register("effects.sparks", (c, o) => new SparksLayer(c.visualizer.quality, o as never))
        .register("effects.keyLight", (_c, o) => new KeyLightLayer(o as never))
        .register("effects.bloom", (c, o) => new BloomLayer(c.visualizer.glow, c.visualizer.quality, o as never))
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
    { id: "effects.nebula" },
    { id: "effects.dust" },
    { id: "notes.rising" },
    { id: "notes.falling" },
    { id: "effects.sparks" },
    { id: "effects.keyLight" },
    { id: "effects.bloom" },
    { id: "effects.topFade" },
    { id: "effects.strikeLine" },
    { id: "keyboard" }
];
