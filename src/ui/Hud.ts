import type { MidiStatus } from "../input/MidiInput";

const key = (label: string): string => `<span class="hud__key">${label}</span>`;

const HINTS = [
    `${key("Z")}${key("X")}${key("C")}${key("V")} и ${key("Q")}${key("W")}${key("E")}${key("R")} — играть с клавиатуры ПК`,
    `${key("␣")} — педаль &nbsp;·&nbsp; ${key("`")} — настройки`
];

/** Подсказка и статус MIDI. Прячется сама, возвращается по движению мыши. */
export class Hud {
    private readonly status: HTMLElement;
    private readonly hints: HTMLElement;
    private hideTimer = 0;
    private restoreTimer = 0;
    private pinned = false;
    private statusText = "";

    constructor(
        private readonly root: HTMLElement,
        private readonly idleSeconds = 6
    ) {
        this.status = root.querySelector<HTMLElement>('[data-role="status"]')!;
        this.hints = root.querySelector<HTMLElement>('[data-role="hints"]')!;
        this.hints.innerHTML = HINTS.map((line) => `<div>${line}</div>`).join("");
        window.addEventListener("pointermove", () => this.wake());
        this.wake();
    }

    setMidiStatus(status: MidiStatus): void {
        this.statusText = status.text;
        this.status.textContent = status.text;
        this.status.classList.toggle("hud__status--on", status.connected);
        this.wake();
    }

    /** Короткое сообщение поверх статуса. */
    flash(message: string, seconds = 1.4): void {
        this.status.textContent = message;
        window.clearTimeout(this.restoreTimer);
        this.restoreTimer = window.setTimeout(() => {
            this.status.textContent = this.statusText;
        }, seconds * 1000);
        this.wake();
    }

    toggle(): boolean {
        this.pinned = !this.pinned;
        this.root.classList.toggle("hud--hidden", this.pinned);
        if (!this.pinned) this.wake();
        return !this.pinned;
    }

    private wake(): void {
        if (this.pinned) return;
        this.root.classList.remove("hud--hidden");
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(
            () => this.root.classList.add("hud--hidden"),
            this.idleSeconds * 1000
        );
    }
}
