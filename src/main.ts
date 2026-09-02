import { Visualizer } from "./core/Visualizer";
import type { Layer } from "./core/types";
import { DEFAULT_STACK, registerBuiltinLayers } from "./layers";
import { registerBuiltinInputs } from "./input";
import type { MidiInput } from "./input/MidiInput";
import { SettingsStore } from "./settings/SettingsStore";
import { SettingsPersistence } from "./settings/persistence";
import { registerGlobalParams } from "./settings/globalParams";
import type { ParamGroup } from "./settings/types";
import { Controls } from "./ui/Controls";
import { Hud } from "./ui/Hud";
import { SettingsPanel } from "./ui/SettingsPanel";

const canvas = document.getElementById("stage");
const hudRoot = document.getElementById("hud");
if (!(canvas instanceof HTMLCanvasElement) || !hudRoot) {
    throw new Error("Разметка сцены не найдена");
}

registerBuiltinLayers();
registerBuiltinInputs();

const visualizer = new Visualizer({ canvas });

/** Куда в панели попадёт переключатель слоя. */
function groupOf(layer: Layer): ParamGroup {
    if (layer.id.startsWith("effects.")) return "effects";
    if (layer.id.startsWith("notes.")) return "notes";
    return "view";
}

const settingsStore = new SettingsStore();
const persistence = new SettingsPersistence(settingsStore);
registerGlobalParams(settingsStore, visualizer, persistence);

// Подписка до сборки стека: слои сами приносят свои параметры, в том числе те,
// что добавлены уже после старта.
visualizer.onLayerChange((layer, added) => {
    if (added) settingsStore.addLayer(layer, groupOf(layer));
    else settingsStore.removeOwner(layer.id);
});

for (const entry of DEFAULT_STACK) visualizer.createLayer(entry.id, entry.options);

persistence.load();
persistence.start();

const hud = new Hud(hudRoot);
const settings = new SettingsPanel(settingsStore);
const controls = new Controls(visualizer, hud, settings);

const midi = visualizer.createInput("input.midi") as MidiInput;
midi.onStatus((status) => hud.setMidiStatus(status));
visualizer.createInput("input.computerKeyboard");
visualizer.createInput("input.pointer");
visualizer.createInput("input.demo");

visualizer.start();

// Точка входа для экспериментов из консоли: visualizer.toggleLayer("effects.sparks")
declare global {
    interface Window {
        visualizer: Visualizer;
        settings: SettingsStore;
    }
}
window.visualizer = visualizer;
window.settings = settingsStore;

void controls;
