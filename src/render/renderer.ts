/**
 * Рисующий поток. Здесь живут холст, слои и копия сцены — всё, что стоит
 * миллисекунд. Главный поток остаётся свободным для ввода, звука и разметки:
 * на слабой машине кадр занимает двести миллисекунд, и всё это время нажатая
 * клавиша ждала бы своей очереди.
 *
 * Сцена здесь — копия, а не источник истины: ноты, время и настройки приходят
 * сообщениями. Считать их дважды дешевле, чем пересылать каждый кадр.
 */
import { Visualizer } from "../core/Visualizer";
import { DEFAULT_STACK, registerBuiltinLayers } from "../layers";
import { NotesDirector } from "../layers/notes/NotesDirector";
import { noteStyle } from "../layers/notes/style";
import { makeEngine } from "../paint/engine";
import { registerSceneParams } from "../settings/globalParams";
import { SettingsStore } from "../settings/SettingsStore";
import type { ParamGroup } from "../settings/types";
import type { Layer } from "../core/types";
import type { FromRenderer, RenderStats, ToRenderer, WindowSize } from "./protocol";

/** Как часто рассказывать о кадрах: чаще незачем, счётчик обновляется реже. */
const REPORT_MS = 250;

let visualizer: Visualizer | null = null;
let store: SettingsStore | null = null;
let size: WindowSize = { width: 1, height: 1, devicePixelRatio: 1 };
let reportTimer = 0;

/** Куда в панели попал бы переключатель слоя — здесь важен только его ключ. */
function groupOf(layer: Layer): ParamGroup {
    if (layer.id.startsWith("effects.")) return "effects";
    if (layer.id.startsWith("notes.")) return "notes";
    return "view";
}

const send = (message: FromRenderer): void => self.postMessage(message);

function start(
    canvas: OffscreenCanvas,
    first: WindowSize,
    settings: Record<string, unknown>,
    off: readonly string[],
    gl: boolean
): void {
    size = first;
    registerBuiltinLayers();

    const view = new Visualizer({ canvas, viewport: () => size, engine: (c) => makeEngine(c, gl) });
    const registry = new SettingsStore();

    registry.addOwner("quality", () => view.quality.params());
    registerSceneParams(registry, view);
    registry.addOwner("notes.style", () => noteStyle.params());
    noteStyle.useQuality(view.quality);

    view.onLayerChange((layer, added) => {
        if (added) registry.addLayer(layer, groupOf(layer));
        else registry.removeOwner(layer.id);
    });
    for (const entry of DEFAULT_STACK) view.createLayer(entry.id, entry.options);

    const director = new NotesDirector(view, view.scene.playback);
    registry.addOwner("notes.direction", () => director.params());

    // Настройки уже прочитаны из хранилища главным потоком: применяем разом,
    // чтобы первый же кадр вышел таким, каким его ждут.
    for (const [id, value] of Object.entries(settings)) {
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
            registry.set(id, value);
        }
    }

    // Выключенные с замера слои: их нет в настройках — ни клавиатуру, ни ноты
    // руками не отключить, а узнать их цену иначе нечем.
    for (const id of off) view.toggleLayer(id, false);

    view.onLayerFault((layer, error) => {
        send({
            type: "fault",
            id: layer.id,
            title: layer.title ?? layer.id,
            message: error instanceof Error ? error.message : String(error)
        });
    });

    visualizer = view;
    // Ручка наружу, как `window.visualizer` в окне: сцену рисует этот поток, и
    // добраться до неё для замера иначе нечем — из окна виден только двойник.
    (self as unknown as { visualizer: Visualizer }).visualizer = view;
    store = registry;
    view.start();
    send({ type: "viewport", viewport: view.scene.viewport });

    reportTimer = setInterval(report, REPORT_MS) as unknown as number;
}

function report(): void {
    const view = visualizer;
    if (!view) return;
    const { quality, profiler, canvas } = view;
    const stats: RenderStats = {
        fps: quality.fps,
        work: quality.work,
        title: quality.title,
        stalls: quality.smoothness.stalls,
        worst: quality.smoothness.worst,
        width: canvas.width,
        height: canvas.height,
        profiling: profiler.active,
        engine: view.engine?.name ?? "нет",
        rows: profiler.rows().map((row) => [row.label, row.ms] as [string, number])
    };
    send({ type: "stats", stats });
}

self.onmessage = (event: MessageEvent<ToRenderer>): void => {
    const message = event.data;
    if (message.type === "start") {
        start(message.canvas, message.size, message.settings, message.off, message.gl);
        return;
    }

    const view = visualizer;
    if (!view) return;
    const scene = view.scene;

    switch (message.type) {
        case "size":
            size = message.size;
            view.resize();
            send({ type: "viewport", viewport: view.scene.viewport });
            break;
        case "noteOn":
            scene.noteOn(message.midi, message.velocity);
            break;
        case "noteOff":
            // Педаль уже разобрана там, где живёт звук: сюда приходит только
            // то отпускание, которое и правда случилось.
            scene.noteOff(message.midi, true);
            break;
        case "panic":
            scene.panic();
            break;
        case "setting": {
            store?.set(message.id, message.value);
            // Ступень качества и диапазон клавиатуры меняют вид сцены: двойнику
            // о новом виде надо сказать, иначе его геометрия отстанет.
            send({ type: "viewport", viewport: scene.viewport });
            break;
        }
        case "score":
            scene.playback.mirror({ score: message.score });
            break;
        case "time":
            scene.playback.mirror({ time: message.time });
            break;
        case "parts":
            scene.playback.mirror({ muted: message.muted });
            break;
        case "profile":
            view.profiler.setEnabled(message.on);
            report();
            break;
    }
};

/** Остановиться по-хорошему: рабочий поток закрывают вместе со страницей. */
self.addEventListener("close", () => {
    clearInterval(reportTimer);
    visualizer?.dispose();
});
