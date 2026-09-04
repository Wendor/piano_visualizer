import { coalesce } from "../core/schedule";
import type { Visualizer } from "../core/Visualizer";
import type { SettingsStore } from "../settings/SettingsStore";
import type { ParamValue } from "../settings/types";
import type { FromRenderer, RenderStats, ToRenderer, WindowSize } from "./protocol";

/** Пустая сводка: до первого кадра рассказывать не о чем. */
const NO_STATS: RenderStats = {
    fps: 0,
    work: 0,
    title: "—",
    stalls: 0,
    worst: 0,
    width: 0,
    height: 0,
    profiling: false,
    rows: []
};

export type FaultHook = (title: string, message: string) => void;

/**
 * Мост к рисующему потоку.
 *
 * В главном потоке остаётся двойник сцены: он принимает ввод, ведёт звук и
 * транспорт и держит настройки — с ним же работает панель. Всё, что он делает,
 * мост пересказывает рисующему: ноты, время, размер окна, изменённые
 * настройки. Обратно приходит только сводка о кадрах и весть о сбойном слое.
 */
export class RendererHost {
    private readonly worker: Worker;
    private readonly detach: Array<() => void> = [];
    private latest: RenderStats = NO_STATS;
    private profiling = false;
    private faultHook: FaultHook | null = null;
    private readonly onResize = coalesce(() => this.sendSize());

    /** Умеет ли браузер отдать холст другому потоку. */
    static get supported(): boolean {
        return (
            typeof Worker === "function" &&
            typeof HTMLCanvasElement !== "undefined" &&
            typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function"
        );
    }

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly twin: Visualizer,
        private readonly store: SettingsStore
    ) {
        this.worker = new Worker(new URL("./renderer.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent<FromRenderer>) => this.receive(event.data);
    }

    /** Отдать холст и рассказать всё, что уже известно. */
    start(): void {
        const offscreen = this.canvas.transferControlToOffscreen();
        const settings: Record<string, ParamValue> = {};
        for (const entry of this.store.entries()) {
            const value = this.store.get(entry.id);
            if (value !== undefined) settings[entry.id] = value;
        }

        this.post({ type: "start", canvas: offscreen, size: windowSize(), settings }, [offscreen]);
        // Разбор кадра могли попросить ещё до того, как рисующий поднялся:
        // флаги из адреса читают раньше всего.
        if (this.profiling) this.post({ type: "profile", on: true });
        this.stretch();
        window.addEventListener("resize", this.onResize);
        this.listen();
    }

    /** Последняя сводка от рисующего: он присылает её несколько раз в секунду. */
    stats(): RenderStats {
        return this.latest;
    }

    setProfiling(on: boolean): void {
        this.profiling = on;
        this.post({ type: "profile", on });
        // Пока сводка не пришла, счётчик должен знать правду о себе сам:
        // иначе галочка в настройках отскочит обратно.
        this.latest = { ...this.latest, profiling: on };
    }

    /** Сбойный слой: он уже выключен там, у себя. */
    onFault(hook: FaultHook): void {
        this.faultHook = hook;
    }

    dispose(): void {
        window.removeEventListener("resize", this.onResize);
        for (const off of this.detach) off();
        this.detach.length = 0;
        this.worker.terminate();
    }

    // --- пересказ ------------------------------------------------------------

    private listen(): void {
        const { scene } = this.twin;
        const { playback } = scene;

        this.detach.push(
            scene.events.on("noteon", ({ midi, velocity }) => this.post({ type: "noteOn", midi, velocity })),
            scene.events.on("noteoff", ({ midi }) => this.post({ type: "noteOff", midi })),
            // Значение уже применено к двойнику: рисующему остаётся повторить.
            this.store.events.on("change", ({ id, value }) => this.post({ type: "setting", id, value })),
            playback.events.on("score", ({ score }) => {
                this.post({ type: "score", score });
                this.sendParts();
            }),
            playback.events.on("parts", () => this.sendParts()),
            // Время файла идёт из главного потока: там звук, и картинка должна
            // совпадать с ним, а не с собственными часами рисующего.
            this.twin.onFrame(() => {
                if (playback.loaded) this.post({ type: "time", time: playback.time });
            })
        );
    }

    private sendParts(): void {
        const { playback } = this.twin.scene;
        const score = playback.score;
        if (!score) return;
        const muted: number[] = [];
        for (let part = 0; part < score.parts.length; part++) {
            if (!playback.partEnabled(part)) muted.push(part);
        }
        this.post({ type: "parts", muted });
    }

    private sendSize(): void {
        this.stretch();
        this.post({ type: "size", size: windowSize() });
    }

    /**
     * Холст занимает окно. Растянуть его — дело того, кто владеет разметкой:
     * у рисующего потока стиля нет.
     */
    private stretch(): void {
        this.canvas.style.width = `${window.innerWidth}px`;
        this.canvas.style.height = `${window.innerHeight}px`;
    }

    private receive(message: FromRenderer): void {
        if (message.type === "stats") this.latest = message.stats;
        else if (message.type === "viewport") this.twin.scene.resize(message.viewport);
        else this.faultHook?.(message.title, message.message);
    }

    private post(message: ToRenderer, transfer: Transferable[] = []): void {
        this.worker.postMessage(message, transfer);
    }
}

function windowSize(): WindowSize {
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
    };
}
