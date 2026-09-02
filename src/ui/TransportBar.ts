import type { Scene } from "../core/Scene";
import type { Playback } from "../score/Playback";
import { notesWord } from "./text";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Время в виде «1:12». */
function clock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total - minutes * 60).padStart(2, "0")}`;
}

/**
 * Полоса управления файлом над клавиатурой. Появляется вместе с партитурой
 * и прячется, когда мышь замирает: в кадре для записи она не нужна.
 */
export class TransportBar {
    readonly root: HTMLElement;

    private readonly playButton: HTMLButtonElement;
    private readonly loopButton: HTMLButtonElement;
    private readonly speedSelect: HTMLSelectElement;
    private readonly nameLabel: HTMLElement;
    private readonly timeLabel: HTMLElement;
    private readonly track: HTMLElement;
    private readonly fill: HTMLElement;
    private readonly tracks: HTMLElement;
    private readonly trackButtons: HTMLButtonElement[] = [];

    private hideTimer = 0;
    private frame = 0;
    private scrubbing = false;

    constructor(
        private readonly playback: Playback,
        private readonly scene: Scene,
        private readonly idleSeconds = 3
    ) {
        this.root = document.createElement("div");
        this.root.className = "transport transport--off";
        this.root.innerHTML = `
            <button class="transport__play" type="button" aria-label="Воспроизведение">▶</button>
            <div class="transport__body">
                <div class="transport__head">
                    <span class="transport__name"></span>
                    <span class="transport__tracks"></span>
                    <span class="transport__time">0:00 / 0:00</span>
                </div>
                <div class="transport__track"><div class="transport__fill"></div></div>
            </div>
            <select class="transport__speed" aria-label="Скорость">
                ${SPEEDS.map((value) => `<option value="${value}">×${value}</option>`).join("")}
            </select>
            <button class="transport__loop" type="button" aria-label="Повтор">⟳</button>
        `;
        document.body.appendChild(this.root);

        this.playButton = this.root.querySelector<HTMLButtonElement>(".transport__play")!;
        this.loopButton = this.root.querySelector<HTMLButtonElement>(".transport__loop")!;
        this.speedSelect = this.root.querySelector<HTMLSelectElement>(".transport__speed")!;
        this.nameLabel = this.root.querySelector<HTMLElement>(".transport__name")!;
        this.timeLabel = this.root.querySelector<HTMLElement>(".transport__time")!;
        this.track = this.root.querySelector<HTMLElement>(".transport__track")!;
        this.fill = this.root.querySelector<HTMLElement>(".transport__fill")!;
        this.tracks = this.root.querySelector<HTMLElement>(".transport__tracks")!;

        this.playButton.addEventListener("click", () => this.playback.transport.toggle());
        this.loopButton.addEventListener("click", () => {
            this.playback.transport.loop = !this.playback.transport.loop;
            this.refresh();
        });
        this.speedSelect.addEventListener("change", () => {
            this.playback.transport.setSpeed(Number(this.speedSelect.value));
            this.wake();
        });
        this.track.addEventListener("pointerdown", this.onScrubStart);
        window.addEventListener("pointermove", this.onPointerMove);
        window.addEventListener("pointerup", this.onScrubEnd);

        this.playback.events.on("score", ({ score }) => {
            this.nameLabel.textContent = score?.name ?? "";
            this.root.classList.toggle("transport--off", score === null);
            this.buildTracks();
            if (score) this.wake();
            this.refresh();
        });
        this.scene.events.on("layout", () => this.place());

        this.place();
        this.refresh();
        this.frame = requestAnimationFrame(this.tick);
    }

    dispose(): void {
        cancelAnimationFrame(this.frame);
        window.removeEventListener("pointermove", this.onPointerMove);
        window.removeEventListener("pointerup", this.onScrubEnd);
        this.root.remove();
    }

    /** Показать полосу и снова завести таймер укрытия. */
    wake(): void {
        if (!this.playback.loaded) return;
        this.root.classList.remove("transport--hidden");
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(
            () => this.root.classList.add("transport--hidden"),
            this.idleSeconds * 1000
        );
    }

    /** Кнопки дорожек: только те, в которых есть ноты. */
    private buildTracks(): void {
        this.tracks.innerHTML = "";
        this.trackButtons.length = 0;
        const score = this.playback.score;
        if (!score) return;

        const used = score.trackNotes
            .map((count, index) => ({ count, index }))
            .filter((item) => item.count > 0);
        if (used.length < 2) return; // выбирать не из чего

        for (const { count, index } of used) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "transport__chip";
            button.textContent = String(index + 1);
            button.title = `Дорожка ${index + 1} · ${count} ${notesWord(count)}`;
            button.addEventListener("click", () => {
                this.playback.setTrackEnabled(index, !this.playback.trackEnabled(index), this.scene);
                this.refreshTracks();
                this.wake();
            });
            this.tracks.appendChild(button);
            this.trackButtons.push(button);
        }
        this.refreshTracks();
    }

    private refreshTracks(): void {
        const score = this.playback.score;
        if (!score) return;
        const used = score.trackNotes
            .map((count, index) => ({ count, index }))
            .filter((item) => item.count > 0);
        this.trackButtons.forEach((button, i) => {
            const index = used[i]?.index ?? i;
            button.classList.toggle("transport__chip--off", !this.playback.trackEnabled(index));
        });
    }

    private place(): void {
        const { layout, viewport } = this.scene;
        this.root.style.bottom = `${Math.max(12, viewport.height - layout.top + 16)}px`;
    }

    private readonly onScrubStart = (event: PointerEvent): void => {
        this.scrubbing = true;
        this.track.setPointerCapture(event.pointerId);
        this.seekTo(event);
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        this.wake();
        if (this.scrubbing) this.seekTo(event);
    };

    private readonly onScrubEnd = (): void => {
        this.scrubbing = false;
    };

    private seekTo(event: PointerEvent): void {
        const duration = this.playback.transport.duration;
        if (duration <= 0) return;
        const box = this.track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        this.playback.seek(ratio * duration, this.scene);
        this.refresh();
    }

    private readonly tick = (): void => {
        this.frame = requestAnimationFrame(this.tick);
        if (this.playback.loaded) this.refresh();
    };

    private refresh(): void {
        const { transport } = this.playback;
        const ratio = transport.duration > 0 ? transport.time / transport.duration : 0;
        this.fill.style.width = `${(ratio * 100).toFixed(2)}%`;
        this.timeLabel.textContent = `${clock(transport.time)} / ${clock(transport.duration)}`;
        this.playButton.textContent = transport.playing ? "❚❚" : "▶";
        this.loopButton.classList.toggle("transport__loop--on", transport.loop);
        const speed = String(transport.speed);
        if (this.speedSelect.value !== speed) this.speedSelect.value = speed;
    }
}
