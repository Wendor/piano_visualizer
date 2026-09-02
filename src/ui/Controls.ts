import type { Visualizer } from "../core/Visualizer";
import type { Hud } from "./Hud";
import type { SettingsPanel } from "./SettingsPanel";

/**
 * Единственная горячая клавиша в игровом режиме — открыть настройки.
 * Пока панель открыта, события клавиатуры до источников нот не доходят,
 * поэтому настройки и ноты не пересекаются.
 */
export class Controls {
    /** Клавиша `~` / `ё`: не используется ни одной нотной раскладкой. */
    private readonly toggleCode = "Backquote";

    constructor(
        private readonly visualizer: Visualizer,
        private readonly hud: Hud,
        private readonly settings: SettingsPanel
    ) {
        window.addEventListener("keydown", this.onKeyDown, { capture: true });
        window.addEventListener("keyup", this.onKeyUp, { capture: true });
    }

    dispose(): void {
        window.removeEventListener("keydown", this.onKeyDown, { capture: true });
        window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    }

    private consume(event: KeyboardEvent): void {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;

        if (event.code === this.toggleCode) {
            this.consume(event);
            if (this.settings.toggle()) this.lock();
            else this.unlock();
            return;
        }

        if (!this.settings.open) return;
        this.consume(event);
        if (event.repeat && event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;

        switch (event.code) {
            case "ArrowUp":
                this.settings.move(-1);
                break;
            case "ArrowDown":
                this.settings.move(1);
                break;
            case "ArrowLeft":
                this.settings.change(-1);
                break;
            case "ArrowRight":
            case "Enter":
            case "Space":
                this.settings.change(1);
                break;
            case "Escape":
                this.settings.hide();
                this.unlock();
                break;
            default:
                break;
        }
    };

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        if (!this.settings.open) return;
        if (event.code === this.toggleCode) return;
        this.consume(event);
    };

    /** При открытии гасим всё, что успели зажать, — иначе нота повиснет. */
    private lock(): void {
        const { scene } = this.visualizer;
        scene.setSustain(false);
        scene.panic();
        scene.inputLocked = true;
        this.hud.flash("Настройки");
    }

    private unlock(): void {
        this.visualizer.scene.inputLocked = false;
        this.hud.flash("Настройки закрыты");
    }
}
