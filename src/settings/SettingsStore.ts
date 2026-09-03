import { Emitter } from "../core/Emitter";
import { clamp } from "../core/math";
import type { Layer } from "../core/types";
import type { ParamGroup, ParamSpec, ParamValue, Snapshot } from "./types";
import { GROUP_ORDER, GROUP_TITLES, SCHEMA_VERSION } from "./types";

export interface ParamEntry {
    readonly id: string;
    readonly spec: ParamSpec;
}

export interface ParamGroupView {
    readonly group: ParamGroup;
    readonly title: string;
    readonly entries: readonly ParamEntry[];
}

export interface SettingsEvents extends Record<string, unknown> {
    change: { id: string; value: ParamValue };
    /** Состав параметров изменился — панели надо перестроиться. */
    structure: Record<string, never>;
}

interface OwnerRecord {
    readonly id: string;
    readonly specs: readonly ParamSpec[];
}

/**
 * Реестр параметров. Собирает описания от слоёв и глобальных владельцев,
 * отдаёт их панели и умеет снимать/восстанавливать состояние целиком.
 * Про DOM не знает ничего.
 */
export class SettingsStore {
    readonly events = new Emitter<SettingsEvents>();

    private readonly owners: OwnerRecord[] = [];
    private readonly specs = new Map<string, ParamSpec>();
    private readonly defaults = new Map<string, ParamValue>();

    addOwner(ownerId: string, provider: () => ParamSpec[]): void {
        if (this.owners.some((owner) => owner.id === ownerId)) {
            throw new Error(`Владелец настроек уже добавлен: ${ownerId}`);
        }
        const specs = provider();
        this.owners.push({ id: ownerId, specs });
        for (const spec of specs) {
            const id = `${ownerId}/${spec.key}`;
            this.specs.set(id, spec);
            const value = read(spec);
            if (value !== undefined) this.defaults.set(id, value);
        }
        this.events.emit("structure", {});
    }

    /** Слой плюс автоматический параметр «включён», если он выключаемый. */
    addLayer(layer: Layer, group: ParamGroup): void {
        this.addOwner(layer.id, () => {
            const specs: ParamSpec[] = [];
            if (layer.toggleable !== false) {
                specs.push({
                    type: "boolean",
                    key: "enabled",
                    label: layer.title ?? layer.id,
                    group,
                    get: () => layer.enabled,
                    set: (value) => {
                        layer.enabled = value;
                    }
                });
            }
            specs.push(...(layer.params?.() ?? []));
            return specs;
        });
    }

    removeOwner(ownerId: string): boolean {
        const index = this.owners.findIndex((owner) => owner.id === ownerId);
        if (index < 0) return false;
        for (const spec of this.owners[index]!.specs) {
            const id = `${ownerId}/${spec.key}`;
            this.specs.delete(id);
            this.defaults.delete(id);
        }
        this.owners.splice(index, 1);
        this.events.emit("structure", {});
        return true;
    }

    /** Все параметры в порядке групп, внутри группы — в порядке добавления. */
    entries(): ParamEntry[] {
        const result: ParamEntry[] = [];
        for (const group of GROUP_ORDER) {
            for (const owner of this.owners) {
                for (const spec of owner.specs) {
                    if (spec.group !== group) continue;
                    result.push({ id: `${owner.id}/${spec.key}`, spec });
                }
            }
        }
        return result;
    }

    groups(): ParamGroupView[] {
        const views: ParamGroupView[] = [];
        for (const group of GROUP_ORDER) {
            const entries = this.entries().filter((entry) => entry.spec.group === group);
            if (entries.length > 0) views.push({ group, title: GROUP_TITLES[group], entries });
        }
        return views;
    }

    spec(id: string): ParamSpec | undefined {
        return this.specs.get(id);
    }

    get(id: string): ParamValue | undefined {
        const spec = this.specs.get(id);
        return spec ? read(spec) : undefined;
    }

    /** Записать значение. Числа зажимаются в диапазон, чужие типы отвергаются. */
    set(id: string, value: ParamValue): boolean {
        const spec = this.specs.get(id);
        if (!spec) return false;

        switch (spec.type) {
            case "number": {
                if (typeof value !== "number" || !Number.isFinite(value)) return false;
                spec.set(tidy(clamp(value, spec.min, spec.max)));
                break;
            }
            case "enum": {
                if (typeof value !== "string") return false;
                if (!spec.variants.some((variant) => variant.value === value)) return false;
                spec.set(value);
                break;
            }
            case "boolean": {
                if (typeof value !== "boolean") return false;
                spec.set(value);
                break;
            }
            case "action":
                return false;
        }

        const current = read(spec);
        if (current !== undefined) this.events.emit("change", { id, value: current });
        return true;
    }

    /**
     * Шаг по стрелке: число — ±step с зажимом, enum — по кругу,
     * boolean — инверсия, action — вызов.
     */
    step(id: string, direction: 1 | -1): void {
        const spec = this.specs.get(id);
        if (!spec) return;

        switch (spec.type) {
            case "number":
                this.set(id, spec.get() + direction * spec.step);
                break;
            case "enum": {
                const list = spec.variants;
                if (list.length === 0) return;
                const index = list.findIndex((variant) => variant.value === spec.get());
                const next = list[(index + direction + list.length) % list.length]!;
                this.set(id, next.value);
                break;
            }
            case "boolean":
                this.set(id, !spec.get());
                break;
            case "action":
                spec.run();
                break;
        }
    }

    snapshot(): Snapshot {
        const values: Record<string, ParamValue> = {};
        for (const entry of this.entries()) {
            const value = read(entry.spec);
            if (value !== undefined) values[entry.id] = value;
        }
        return { version: SCHEMA_VERSION, values };
    }

    /** Применить сохранённое состояние. Всё непонятное молча пропускается. */
    restore(raw: unknown): boolean {
        if (typeof raw !== "object" || raw === null) return false;
        const snapshot = raw as Partial<Snapshot>;
        if (snapshot.version !== SCHEMA_VERSION) return false;
        if (typeof snapshot.values !== "object" || snapshot.values === null) return false;

        for (const [id, value] of Object.entries(snapshot.values)) {
            if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean")
                continue;
            this.set(id, value);
        }
        return true;
    }

    /** Вернуть значения, зафиксированные при добавлении владельцев. */
    reset(): void {
        for (const [id, value] of this.defaults) this.set(id, value);
    }
}

function read(spec: ParamSpec): ParamValue | undefined {
    return spec.type === "action" ? undefined : spec.get();
}

/** Убирает мусор двоичной арифметики: 0.30000000000000004 → 0.3. */
function tidy(value: number): number {
    return Math.round(value * 1e6) / 1e6;
}
