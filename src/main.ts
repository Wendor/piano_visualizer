import { Visualizer } from "./core/Visualizer";
import { DEFAULT_STACK, registerBuiltinLayers } from "./layers";
import { registerBuiltinInputs } from "./input";
import type { MidiInput } from "./input/MidiInput";
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
for (const entry of DEFAULT_STACK) visualizer.createLayer(entry.id, entry.options);

const hud = new Hud(hudRoot);
const settings = new SettingsPanel(visualizer);
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
    }
}
window.visualizer = visualizer;

void controls;
