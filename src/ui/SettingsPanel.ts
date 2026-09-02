import type { ParamEntry, SettingsStore } from "../settings/SettingsStore";
import { describe } from "../settings/types";

/**
 * Панель настроек. Строится целиком из реестра параметров, поэтому не знает
 * ни одного слоя по имени. Пока панель открыта, клавиатура управляет только ей.
 */
export class SettingsPanel {
    readonly root: HTMLElement;
    private readonly list: HTMLElement;
    private readonly rows = new Map<string, HTMLElement>();
    private entries: ParamEntry[] = [];
    private cursor = 0;
    private visible = false;

    constructor(private readonly store: SettingsStore) {
        this.root = document.createElement("div");
        this.root.className = "settings settings--hidden";
        this.root.innerHTML = `
            <div class="settings__title">Настройки</div>
            <div class="settings__list"></div>
            <div class="settings__footer">↑↓ — пункт &nbsp;·&nbsp; ←→ — значение &nbsp;·&nbsp; \` или Esc — закрыть</div>
        `;
        this.list = this.root.querySelector<HTMLElement>(".settings__list")!;
        document.body.appendChild(this.root);

        this.store.events.on("structure", () => this.build());
        this.store.events.on("change", ({ id }) => this.refreshRow(id));
        this.build();
    }

    get open(): boolean {
        return this.visible;
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
        if (this.entries.length === 0) return;
        this.cursor = (this.cursor + direction + this.entries.length) % this.entries.length;
        this.refresh();
        this.scrollToCursor();
    }

    /** Шаг значения текущего пункта; для действий — вызов. */
    change(direction: 1 | -1): void {
        const entry = this.entries[this.cursor];
        if (entry) this.store.step(entry.id, direction);
        this.refresh();
    }

    private build(): void {
        this.list.innerHTML = "";
        this.rows.clear();
        this.entries = [];

        for (const group of this.store.groups()) {
            const header = document.createElement("div");
            header.className = "settings__group";
            header.textContent = group.title;
            this.list.appendChild(header);

            for (const entry of group.entries) {
                const row = document.createElement("div");
                row.className = "settings__row";
                row.innerHTML = `<span class="settings__label"></span><span class="settings__value"></span>`;
                row.querySelector<HTMLElement>(".settings__label")!.textContent = entry.spec.label;
                this.list.appendChild(row);
                this.rows.set(entry.id, row);
                this.entries.push(entry);
            }
        }

        if (this.cursor >= this.entries.length) this.cursor = 0;
        this.refresh();
    }

    private refresh(): void {
        this.entries.forEach((entry, index) => {
            const row = this.rows.get(entry.id);
            if (!row) return;
            row.classList.toggle("settings__row--active", index === this.cursor);
            const value = row.querySelector<HTMLElement>(".settings__value");
            if (value) value.textContent = describe(entry.spec);
        });
    }

    private refreshRow(id: string): void {
        const entry = this.entries.find((item) => item.id === id);
        const row = this.rows.get(id);
        if (!entry || !row) return;
        const value = row.querySelector<HTMLElement>(".settings__value");
        if (value) value.textContent = describe(entry.spec);
    }

    /** У первого пункта группы в кадр тянем её заголовок, а не саму строку. */
    private scrollToCursor(): void {
        const entry = this.entries[this.cursor];
        if (!entry) return;
        const row = this.rows.get(entry.id);
        if (!row) return;
        const previous = row.previousElementSibling;
        const target = previous?.classList.contains("settings__group") ? previous : row;
        target.scrollIntoView({ block: "nearest" });
    }
}
