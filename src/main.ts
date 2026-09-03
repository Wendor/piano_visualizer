import { Sampler } from "./audio/Sampler";
import { parseDebugFlags } from "./core/debugFlags";
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
const fpsMeter = new FpsMeter(visualizer);

// Порядок владельцев задаёт порядок строк внутри группы: качество должно
// стоять раньше «Сбросить всё», иначе оно окажется в хвосте панели.
settingsStore.addOwner("quality", () => [...visualizer.quality.params(), ...fpsMeter.params()]);
registerGlobalParams(settingsStore, visualizer, persistence);
settingsStore.addOwner("notes.style", () => noteStyle.params());
noteStyle.useQuality(visualizer.quality);

const sampler = new Sampler();
settingsStore.addOwner("sound", () => sampler.params());

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

// Флаги из адреса — после загрузки настроек: с пульта их вводят затем,
// чтобы посмотреть на конкретный случай, а не чтобы поменять сохранённое.
const debugFlags = parseDebugFlags(window.location.search);
if (debugFlags.quality) visualizer.quality.setMode(debugFlags.quality);
if (debugFlags.profile !== undefined) fpsMeter.setProfiling(debugFlags.profile);

const hud = new Hud(hudRoot);

// Ошибка внутри эффекта гасит только его, а не всю сцену.
visualizer.onLayerFault((layer, error) => {
    const reason = error instanceof Error ? error.message : String(error);
    hud.flash(`Слой «${layer.title ?? layer.id}» отключён: ${reason}`, 4);
    console.error(`Слой ${layer.id} отключён`, error);
});

// Звук идёт от сцены, а не от источника ввода: так звучат и живая игра,
// и файл, а педаль уже разобрана сценой — она держит ноту сама.
sampler.onStatus = (text) => hud.flash(text, 1.6);
scene.events.on("noteon", ({ midi, velocity, part, age }) => sampler.noteOn(midi, velocity, part, age));
scene.events.on("noteoff", ({ midi }) => sampler.noteOff(midi));
scene.playback.events.on("score", ({ score }) => sampler.useScore(score));

// Браузер включает звук только после жеста — первый же и используем. Ловим
// на перехвате и несколькими видами событий: до нас их может съесть слой ввода.
for (const event of ["pointerdown", "mousedown", "touchstart", "keydown"] as const) {
    window.addEventListener(event, () => sampler.unlock(), { once: true, capture: true });
}
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
        sampler: Sampler;
    }
}
window.visualizer = visualizer;
window.settings = settingsStore;
window.sampler = sampler;

void controls;
