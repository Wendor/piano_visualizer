import { Visualizer } from "./core/Visualizer";
import type { Layer } from "./core/types";
import { DEFAULT_STACK, registerBuiltinLayers } from "./layers";
import { noteStyle } from "./layers/notes/style";
import { NotesDirector } from "./layers/notes/NotesDirector";
import { registerBuiltinInputs } from "./input";
import type { MidiInput } from "./input/MidiInput";
import { parseMidiFile } from "./score/smf";
import { SettingsStore } from "./settings/SettingsStore";
import { SettingsPersistence } from "./settings/persistence";
import { registerGlobalParams } from "./settings/globalParams";
import type { ParamGroup } from "./settings/types";
import { Controls } from "./ui/Controls";
import { FileDrop } from "./ui/FileDrop";
import { Hud } from "./ui/Hud";
import { FpsMeter } from "./ui/FpsMeter";
import { SettingsPanel } from "./ui/SettingsPanel";
import { TransportBar } from "./ui/TransportBar";
import { notesWord } from "./ui/text";

const canvas = document.getElementById("stage");
const hudRoot = document.getElementById("hud");
if (!(canvas instanceof HTMLCanvasElement) || !hudRoot) {
    throw new Error("Разметка сцены не найдена");
}

registerBuiltinLayers();
registerBuiltinInputs();

const visualizer = new Visualizer({ canvas });
const scene = visualizer.scene;

/** Куда в панели попадёт переключатель слоя. */
function groupOf(layer: Layer): ParamGroup {
    if (layer.id.startsWith("effects.")) return "effects";
    if (layer.id.startsWith("notes.")) return "notes";
    return "view";
}

const settingsStore = new SettingsStore();
const persistence = new SettingsPersistence(settingsStore);
const fpsMeter = new FpsMeter(visualizer.quality);

// Порядок владельцев задаёт порядок строк внутри группы: качество должно
// стоять раньше «Сбросить всё», иначе оно окажется в хвосте панели.
settingsStore.addOwner("quality", () => [...visualizer.quality.params(), ...fpsMeter.params()]);
registerGlobalParams(settingsStore, visualizer, persistence);
settingsStore.addOwner("notes.style", () => noteStyle.params());
noteStyle.useQuality(visualizer.quality);

// Подписка до сборки стека: слои сами приносят свои параметры, в том числе те,
// что добавлены уже после старта.
visualizer.onLayerChange((layer, added) => {
    if (added) settingsStore.addLayer(layer, groupOf(layer));
    else settingsStore.removeOwner(layer.id);
});

for (const entry of DEFAULT_STACK) visualizer.createLayer(entry.id, entry.options);

const director = new NotesDirector(visualizer, scene.playback);
settingsStore.addOwner("notes.direction", () => director.params());

persistence.load();
persistence.start();

const hud = new Hud(hudRoot);
const settings = new SettingsPanel(settingsStore);
const transportBar = new TransportBar(scene.playback, scene);
const controls = new Controls(visualizer, hud, settings, transportBar);

async function openFile(file: File): Promise<void> {
    try {
        const score = parseMidiFile(await file.arrayBuffer(), file.name);
        scene.playback.load(score, scene);
        scene.playback.transport.play();
        transportBar.wake();
        hud.flash(`${file.name} · ${score.notes.length} ${notesWord(score.notes.length)}`, 2.4);
    } catch (error) {
        hud.flash(error instanceof Error ? error.message : "Не удалось открыть файл", 3);
    }
}

const fileDrop = new FileDrop((file) => void openFile(file));
hud.fileLink?.addEventListener("click", () => fileDrop.open());

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
