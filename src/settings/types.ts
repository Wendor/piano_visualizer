/**
 * Описание настраиваемого параметра. Владелец (слой, тема, система) объявляет
 * их сам, поэтому панель и сохранение состояния не знают о нём ничего.
 */

/** Группа `input` объявлена заранее и наполняется на этапе B. */
export type ParamGroup = "view" | "notes" | "effects" | "sound" | "input" | "system";

export const GROUP_ORDER: readonly ParamGroup[] = ["view", "notes", "effects", "sound", "input", "system"];

export const GROUP_TITLES: Readonly<Record<ParamGroup, string>> = {
    view: "Вид",
    notes: "Ноты",
    effects: "Эффекты",
    sound: "Звук",
    input: "Ввод",
    system: "Система"
};

/** Версия схемы сохранения: несовместимое изменение параметров увеличивает её. */
export const SCHEMA_VERSION = 1;

interface ParamBase {
    /** Уникален внутри владельца; полный идентификатор — `владелец/ключ`. */
    readonly key: string;
    readonly label: string;
    readonly group: ParamGroup;
}

export interface NumberParam extends ParamBase {
    readonly type: "number";
    readonly min: number;
    readonly max: number;
    readonly step: number;
    /** Как показать значение: 240 → «240 px/с». По умолчанию — округление. */
    readonly format?: (value: number) => string;
    get(): number;
    set(value: number): void;
}

export interface EnumParam<T extends string = string> extends ParamBase {
    readonly type: "enum";
    readonly variants: ReadonlyArray<{ readonly value: T; readonly title: string }>;
    get(): T;
    set(value: T): void;
}

export interface BooleanParam extends ParamBase {
    readonly type: "boolean";
    /** Подписи для true и false вместо «вкл»/«выкл». */
    readonly labels?: readonly [string, string];
    get(): boolean;
    set(value: boolean): void;
}

export interface ActionParam extends ParamBase {
    readonly type: "action";
    /** Что показать в колонке значения, напр. «↵». */
    readonly hint: string;
    run(): void;
}

export type ParamSpec = NumberParam | EnumParam | BooleanParam | ActionParam;
export type ParamValue = number | string | boolean;

export interface Snapshot {
    version: number;
    values: Record<string, ParamValue>;
}

/** Текущее значение параметра в человекочитаемом виде. */
export function describe(spec: ParamSpec): string {
    switch (spec.type) {
        case "number": {
            const value = spec.get();
            return spec.format ? spec.format(value) : String(Math.round(value));
        }
        case "enum": {
            const current = spec.get();
            return spec.variants.find((item) => item.value === current)?.title ?? current;
        }
        case "boolean": {
            const [yes, no] = spec.labels ?? ["вкл", "выкл"];
            return spec.get() ? yes : no;
        }
        case "action":
            return spec.hint;
    }
}

/** Процент для долей: 0.62 → «62%». */
export function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
}
