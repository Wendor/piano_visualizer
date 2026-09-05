import { Sampler } from "./audio/Sampler";
import { parseDebugFlags } from "./core/debugFlags";
import { createSurface } from "./core/surface";
import { makeEngine } from "./paint/engine";
import { Visualizer } from "./core/Visualizer";
import { RendererHost } from "./render/RendererHost";
import type { Layer } from "./core/types";
import { DEFAULT_STACK, registerBuiltinLayers } from "./layers";
import { noteStyle } from "./layers/notes/style";
import { NotesDirector } from "./layers/notes/NotesDirector";
import { registerBuiltinInputs } from "./input";
import type { MidiInput } from "./input/MidiInput";
import { PointerInput } from "./input/PointerInput";
import { parseMidiFile } from "./score/smf";
import { SettingsStore } from "./settings/SettingsStore";
import { SettingsPersistence } from "./settings/persistence";
import { registerGlobalParams } from "./settings/globalParams";
import { applyOverrides } from "./settings/overrides";
import type { ParamGroup } from "./settings/types";
import { Controls } from "./ui/Controls";
import { FileDrop } from "./ui/FileDrop";
import { Hud } from "./ui/Hud";
import { FpsMeter, localStats } from "./ui/FpsMeter";
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

const debugFlags = parseDebugFlags(window.location.search);
/**
 * Рисовать сцену в рабочем потоке, если браузер умеет отдать ему холст.
 * Кадр на слабой машине занимает двести миллисекунд, и всё это время нажатая
 * клавиша ждала бы своей очереди: в главном потоке остаются ввод, звук и
 * разметка, а картину собирает другой.
 */
const inWorker = RendererHost.supported && debugFlags.worker !== false;

// Двойник держит сцену, слои и их настройки: с ним работают ввод, звук и
// панель. Холст ему не нужен — картину собирает рабочий поток.
const wantsGL = debugFlags.gl !== false;
const wantsClock = debugFlags.clock ?? "even";
const visualizer = new Visualizer({
    canvas: inWorker ? createSurface() : canvas,
    paints: !inWorker,
    engine: (surface) => makeEngine(surface, wantsGL),
    clock: wantsClock
});
const scene = visualizer.scene;

/** Куда в панели попадёт переключатель слоя. */
function groupOf(layer: Layer): ParamGroup {
    if (layer.id.startsWith("effects.")) return "effects";
    if (layer.id.startsWith("notes.")) return "notes";
    return "view";
}

const settingsStore = new SettingsStore();
const persistence = new SettingsPersistence(settingsStore);
const renderer = inWorker ? new RendererHost(canvas, visualizer, settingsStore) : null;
const fpsMeter = new FpsMeter(renderer ?? localStats(visualizer));

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

// Флаги из адреса — после загрузки настроек и до подписки на сохранение: с
// пульта их вводят затем, чтобы посмотреть на конкретный случай, а не чтобы
// поменять сохранённое. Иначе опыт «а как оно без свечения» возвращался бы
// при каждом следующем запуске, и объяснить это было бы нечем.
if (debugFlags.quality) visualizer.quality.setMode(debugFlags.quality);
if (debugFlags.profile !== undefined) fpsMeter.setProfiling(debugFlags.profile);

// Выключить с замера можно и то, чего нет в панели: узнать цену клавиатуры
// или самих нот иначе нечем, а выключателя у них нет — без них сцена теряет
// смысл. Поэтому список идёт мимо настроек: двойнику здесь, рисующему —
// сообщением при запуске.
const off = debugFlags.off ?? [];
const unknownLayers = off.filter((id) => !visualizer.layer(id));
for (const id of off) visualizer.toggleLayer(id, false);
const rejectedSettings = applyOverrides(settingsStore, debugFlags.set ?? []);

persistence.start();

const hud = new Hud(hudRoot);

// Об опечатке надо сказать вслух, иначе человек решит, что слой ничего не
// стоит, а он всё это время работал.
const complaints = [...unknownLayers, ...rejectedSettings];
if (complaints.length > 0) {
    const complaint = `Не понял: ${complaints.join(", ")}`;
    console.warn(complaint);
    // Статус MIDI приходит асинхронно и ляжет поверх: жалобу показываем после
    // него. Молча проглотить опечатку нельзя — иначе выключённым сочтут то,
    // что всё это время работало, и замер соврёт.
    window.setTimeout(() => hud.flash(complaint, 5), 1200);
}

// Ошибка внутри эффекта гасит только его, а не всю сцену.
visualizer.onLayerFault((layer, error) => {
    const reason = error instanceof Error ? error.message : String(error);
    hud.flash(`Слой «${layer.title ?? layer.id}» отключён: ${reason}`, 4);
    console.error(`Слой ${layer.id} отключён`, error);
});
renderer?.onFault((title, message) => {
    hud.flash(`Слой «${title}» отключён: ${message}`, 4);
    console.error(`Слой ${title} отключён`, message);
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
// Указателю нужен холст страницы: у двойника его нет, а события мыши
// приходят именно сюда.
visualizer.addInput(new PointerInput(canvas));
visualizer.createInput("input.demo");

// Рисующий поток заводится последним: к этому времени настройки прочитаны,
// слои собраны и флаги из адреса применены — ему остаётся всё повторить.
renderer?.start(off, wantsGL, wantsClock);
visualizer.start();

// Точка входа для экспериментов из консоли: visualizer.toggleLayer("effects.sparks")
declare global {
    interface Window {
        visualizer: Visualizer;
        settings: SettingsStore;
        sampler: Sampler;
        /** Мост к рисующему потоку; в окне рисует сам visualizer, и его нет. */
        renderer: RendererHost | null;
    }
}
window.visualizer = visualizer;
window.settings = settingsStore;
window.sampler = sampler;
window.renderer = renderer;

void controls;
