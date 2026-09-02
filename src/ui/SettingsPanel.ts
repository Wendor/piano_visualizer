import type { Visualizer } from "../core/Visualizer";
import type { BloomLayer } from "../layers/effects/BloomLayer";
import type { RisingNotesLayer } from "../layers/notes/RisingNotesLayer";
import { PALETTES } from "../theme/palettes";
import { clamp } from "../core/math";

/** Пункт меню: показывает значение и умеет его менять шагом влево-вправо. */
export interface SettingItem {
    readonly id: string;
    readonly label: string;
    value(): string;
    change(direction: 1 | -1): void;
}

/**
 * Панель настроек. Пока она открыта, клавиатура управляет только ей —
 * поэтому настройки не пересекаются с нотами.
 */
export class SettingsPanel {
    readonly root: HTMLElement;
    private readonly list: HTMLElement;
    private readonly items: SettingItem[] = [];
    private readonly rows: HTMLElement[] = [];
    private cursor = 0;
    private visible = false;

    constructor(private readonly visualizer: Visualizer) {
        this.root = document.createElement("div");
        this.root.className = "settings settings--hidden";
        this.root.innerHTML = `
            <div class="settings__title">Настройки</div>
            <div class="settings__list"></div>
            <div class="settings__footer">↑↓ — пункт &nbsp;·&nbsp; ←→ — значение &nbsp;·&nbsp; \` или Esc — закрыть</div>
        `;
        this.list = this.root.querySelector<HTMLElement>(".settings__list")!;
        document.body.appendChild(this.root);

        this.addDefaultItems();
        this.build();
    }

    get open(): boolean {
        return this.visible;
    }

    add(item: SettingItem): void {
        this.items.push(item);
        this.build();
    }

    show(): void {
        this.visible = true;
        this.root.classList.remove("settings--hidden");
        this.refresh();
    }

    hide(): void {
        this.visible = false;
        this.root.classList.add("settings--hidden");
    }

    toggle(): boolean {
        if (this.visible) this.hide();
        else this.show();
        return this.visible;
    }

    move(direction: 1 | -1): void {
        this.cursor = (this.cursor + direction + this.items.length) % this.items.length;
        this.refresh();
    }

    change(direction: 1 | -1): void {
        this.items[this.cursor]?.change(direction);
        this.refresh();
    }

    private build(): void {
        this.list.innerHTML = "";
        this.rows.length = 0;
        for (const item of this.items) {
            const row = document.createElement("div");
            row.className = "settings__row";
            row.innerHTML = `<span class="settings__label">${item.label}</span><span class="settings__value"></span>`;
            this.list.appendChild(row);
            this.rows.push(row);
        }
        this.refresh();
    }

    private refresh(): void {
        this.items.forEach((item, index) => {
            const row = this.rows[index];
            if (!row) return;
            row.classList.toggle("settings__row--active", index === this.cursor);
            const value = row.querySelector<HTMLElement>(".settings__value");
            if (value) value.textContent = item.value();
        });
    }

    private layerToggle(id: string, label: string): SettingItem {
        return {
            id,
            label,
            value: () => (this.visualizer.layer(id)?.enabled ? "вкл" : "выкл"),
            change: () => {
                this.visualizer.toggleLayer(id);
            }
        };
    }

    private addDefaultItems(): void {
        const scene = this.visualizer.scene;

        this.items.push({
            id: "palette",
            label: "Палитра",
            value: () => scene.theme.palette.title,
            change: (direction) => {
                const current = PALETTES.findIndex((item) => item.id === scene.theme.palette.id);
                const next = PALETTES[(current + direction + PALETTES.length) % PALETTES.length]!;
                scene.setPalette(next);
            }
        });

        this.items.push({
            id: "bloom",
            label: "Свечение",
            value: () => `${Math.round((this.bloom?.options.strength ?? 0) * 100)}%`,
            change: (direction) => {
                const bloom = this.bloom;
                if (bloom) bloom.setStrength(bloom.options.strength + direction * 0.1);
            }
        });

        this.items.push({
            id: "hollow",
            label: "Натуральные ноты",
            value: () => (this.notes?.options.hollowNaturals ? "контур" : "заливка"),
            change: () => {
                const notes = this.notes;
                if (notes) notes.options.hollowNaturals = !notes.options.hollowNaturals;
            }
        });

        this.items.push({
            id: "speed",
            label: "Скорость нот",
            value: () => `${Math.round(this.notes?.options.speed ?? 0)} px/с`,
            change: (direction) => {
                const notes = this.notes;
                if (notes) notes.options.speed = clamp(notes.options.speed + direction * 20, 80, 600);
            }
        });

        this.items.push(this.layerToggle("effects.sparks", "Искры"));
        this.items.push(this.layerToggle("effects.keyLight", "Свет клавиш"));
        this.items.push(this.layerToggle("effects.strikeLine", "Линия удара"));
    }

    private get bloom(): BloomLayer | undefined {
        return this.visualizer.layer<BloomLayer>("effects.bloom");
    }

    private get notes(): RisingNotesLayer | undefined {
        return this.visualizer.layer<RisingNotesLayer>("notes.rising");
    }
}
