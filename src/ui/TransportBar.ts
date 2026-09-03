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

interface RowSpec {
    readonly label: string;
    readonly hint?: string;
    readonly title?: string;
    /** Галочка слева; у пунктов-действий её нет. */
    readonly checked?: boolean;
    readonly action?: boolean;
    pick(event: MouseEvent): void;
}

function optionRow(spec: RowSpec): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = spec.action ? "transport__option transport__option--action" : "transport__option";
    if (spec.checked === false) row.classList.add("transport__option--off");
    if (spec.title) row.title = spec.title;

    if (!spec.action) row.appendChild(Object.assign(document.createElement("span"), { className: "transport__mark" }));
    const name = document.createElement("span");
    name.className = "transport__option-name";
    name.textContent = spec.label;
    row.appendChild(name);
    if (spec.hint !== undefined) {
        const hint = document.createElement("span");
        hint.className = "transport__option-hint";
        hint.textContent = spec.hint;
        row.appendChild(hint);
    }

    row.addEventListener("click", (event) => spec.pick(event));
    return row;
}

/** Выпадающий список у кнопки: один вид и у дорожек, и у скорости. */
class Dropdown {
    readonly menu = document.createElement("div");
    private visible = false;

    constructor(
        private readonly host: HTMLElement,
        private readonly button: HTMLButtonElement
    ) {
        this.menu.className = "transport__menu";
        this.menu.hidden = true;
        host.appendChild(this.menu);
    }

    get open(): boolean {
        return this.visible;
    }

    fill(rows: readonly RowSpec[]): void {
        this.menu.innerHTML = "";
        for (const row of rows) this.menu.appendChild(optionRow(row));
    }

    show(): void {
        this.visible = true;
        this.menu.hidden = false;
        this.button.classList.add("transport__trigger--on");
        // Правый край списка совпадает с правым краем своей кнопки.
        const host = this.host.getBoundingClientRect();
        const button = this.button.getBoundingClientRect();
        this.menu.style.right = `${Math.max(8, host.right - button.right)}px`;
    }

    hide(): void {
        this.visible = false;
        this.menu.hidden = true;
        this.button.classList.remove("transport__trigger--on");
    }

    toggle(): void {
        if (this.visible) this.hide();
        else this.show();
    }

    owns(node: Node): boolean {
        return this.menu.contains(node) || this.button.contains(node);
    }
}

/**
 * Полоса управления файлом над клавиатурой. Появляется вместе с партитурой
 * и прячется, когда мышь замирает: в кадре для записи она не нужна.
 */
export class TransportBar {
    readonly root: HTMLElement;

    private readonly playButton: HTMLButtonElement;
    private readonly loopButton: HTMLButtonElement;
    private readonly speedButton: HTMLButtonElement;
    private readonly partsButton: HTMLButtonElement;
    private readonly nameLabel: HTMLElement;
    private readonly timeLabel: HTMLElement;
    private readonly track: HTMLElement;
    private readonly fill: HTMLElement;
    private readonly speedMenu: Dropdown;
    private readonly partsMenu: Dropdown;

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
                    <button class="transport__parts transport__trigger" type="button" hidden>Дорожки</button>
                    <span class="transport__time">0:00 / 0:00</span>
                </div>
                <div class="transport__track"><div class="transport__fill"></div></div>
            </div>
            <button class="transport__speed transport__trigger" type="button" aria-label="Скорость">×1</button>
            <button class="transport__loop" type="button" aria-label="Повтор">⟳</button>
        `;
        document.body.appendChild(this.root);

        this.playButton = this.root.querySelector<HTMLButtonElement>(".transport__play")!;
        this.loopButton = this.root.querySelector<HTMLButtonElement>(".transport__loop")!;
        this.speedButton = this.root.querySelector<HTMLButtonElement>(".transport__speed")!;
        this.partsButton = this.root.querySelector<HTMLButtonElement>(".transport__parts")!;
        this.nameLabel = this.root.querySelector<HTMLElement>(".transport__name")!;
        this.timeLabel = this.root.querySelector<HTMLElement>(".transport__time")!;
        this.track = this.root.querySelector<HTMLElement>(".transport__track")!;
        this.fill = this.root.querySelector<HTMLElement>(".transport__fill")!;

        this.speedMenu = new Dropdown(this.root, this.speedButton);
        this.partsMenu = new Dropdown(this.root, this.partsButton);

        this.playButton.addEventListener("click", () => this.playback.transport.toggle());
        this.loopButton.addEventListener("click", () => {
            this.playback.transport.loop = !this.playback.transport.loop;
            this.refresh();
        });
        this.speedButton.addEventListener("click", () => {
            this.partsMenu.hide();
            this.buildSpeeds();
            this.speedMenu.toggle();
            this.wake();
        });
        this.partsButton.addEventListener("click", () => {
            this.speedMenu.hide();
            this.partsMenu.toggle();
            this.wake();
        });
        document.addEventListener("pointerdown", this.onDocumentDown, true);
        this.track.addEventListener("pointerdown", this.onScrubStart);
        window.addEventListener("pointermove", this.onPointerMove);
        window.addEventListener("pointerup", this.onScrubEnd);

        this.playback.events.on("score", ({ score }) => {
            this.nameLabel.textContent = score?.name ?? "";
            this.root.classList.toggle("transport--off", score === null);
            this.buildParts();
            if (score) this.wake();
            this.refresh();
        });
        this.scene.events.on("layout", () => this.place());

        this.buildSpeeds();
        this.place();
        this.refresh();
        this.frame = requestAnimationFrame(this.tick);
    }

    dispose(): void {
        cancelAnimationFrame(this.frame);
        window.removeEventListener("pointermove", this.onPointerMove);
        window.removeEventListener("pointerup", this.onScrubEnd);
        document.removeEventListener("pointerdown", this.onDocumentDown, true);
        this.root.remove();
    }

    /** Показать полосу и снова завести таймер укрытия. */
    wake(): void {
        if (!this.playback.loaded) return;
        this.root.classList.remove("transport--hidden");
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => {
            if (this.speedMenu.open || this.partsMenu.open) return; // открытый список удерживает полосу
            this.root.classList.add("transport--hidden");
        }, this.idleSeconds * 1000);
    }

    private buildSpeeds(): void {
        const current = this.playback.transport.speed;
        this.speedMenu.fill(
            SPEEDS.map((value) => ({
                label: `×${value}`,
                checked: Math.abs(value - current) < 0.01,
                pick: () => {
                    this.playback.transport.setSpeed(value);
                    this.buildSpeeds();
                    this.speedMenu.hide();
                    this.refresh();
                    this.wake();
                }
            }))
        );
    }

    /** Список партий с именами; показывается, когда их больше одной. */
    private buildParts(): void {
        const parts = (this.playback.score?.parts ?? []).filter((part) => part.notes > 0);
        this.partsMenu.hide();
        this.partsButton.hidden = parts.length < 2;
        if (parts.length < 2) {
            this.partsMenu.fill([]);
            return;
        }

        this.partsMenu.fill([
            ...parts.map((part) => ({
                label: part.name,
                hint: String(part.notes),
                title: `Канал ${part.channel + 1} · ${part.notes} ${notesWord(part.notes)} · Alt — только эта`,
                checked: this.playback.partEnabled(part.index),
                pick: (event: MouseEvent) => {
                    if (event.altKey) this.solo(part.index);
                    else {
                        this.playback.setPartEnabled(
                            part.index,
                            !this.playback.partEnabled(part.index),
                            this.scene
                        );
                    }
                    this.buildPartRows();
                    this.wake();
                }
            })),
            {
                label: "Показать все",
                action: true,
                pick: () => {
                    for (const part of parts) this.playback.setPartEnabled(part.index, true, this.scene);
                    this.buildPartRows();
                    this.wake();
                }
            }
        ]);
        this.refreshPartsButton();
    }

    /** Перерисовать список, не закрывая его. */
    private buildPartRows(): void {
        const open = this.partsMenu.open;
        this.buildParts();
        if (open) this.partsMenu.show();
    }

    private solo(index: number): void {
        for (const part of this.playback.score?.parts ?? []) {
            this.playback.setPartEnabled(part.index, part.index === index, this.scene);
        }
    }

    private refreshPartsButton(): void {
        const parts = (this.playback.score?.parts ?? []).filter((part) => part.notes > 0);
        const on = parts.filter((part) => this.playback.partEnabled(part.index)).length;
        this.partsButton.textContent = `Дорожки ${on}/${parts.length}`;
    }

    private place(): void {
        const { layout, viewport } = this.scene;
        this.root.style.bottom = `${Math.max(12, viewport.height - layout.top + 16)}px`;
    }

    private readonly onDocumentDown = (event: PointerEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.speedMenu.open && !this.speedMenu.owns(target)) this.speedMenu.hide();
        if (this.partsMenu.open && !this.partsMenu.owns(target)) this.partsMenu.hide();
    };

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
        this.speedButton.textContent = `×${transport.speed}`;
        if (this.playback.loaded) this.refreshPartsButton();
    }
}
