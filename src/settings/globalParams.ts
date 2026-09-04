import { RANGE_STEPS } from "../core/layout";
import type { Visualizer } from "../core/Visualizer";
import { PALETTES } from "../theme/palettes";
import type { SettingsStore } from "./SettingsStore";
import type { SettingsPersistence } from "./persistence";
import type { ParamSpec } from "./types";

/** Настройки, не принадлежащие ни одному слою: тема, геометрия, система. */
export function registerGlobalParams(
    store: SettingsStore,
    visualizer: Visualizer,
    persistence: SettingsPersistence
): void {
    const scene = visualizer.scene;

    store.addOwner("theme", () => [
        {
            type: "enum",
            key: "palette",
            label: "Палитра",
            group: "view",
            variants: PALETTES.map((palette) => ({ value: palette.id, title: palette.title })),
            get: () => scene.theme.palette.id,
            set: (value) => {
                const palette = PALETTES.find((item) => item.id === value);
                if (palette) scene.setPalette(palette);
            }
        }
    ]);

    store.addOwner("keyboard.range", () => {
        const ranges = RANGE_STEPS.map(([first, last]) => ({
            value: String(last - first + 1),
            title: `${last - first + 1} клавиш`,
            first,
            last
        }));

        const apply = (): void => {
            visualizer.resize();
        };

        const specs: ParamSpec[] = [
            {
                type: "enum",
                key: "range",
                label: "Диапазон",
                group: "view",
                variants: [
                    { value: "auto", title: "авто" },
                    ...ranges.map(({ value, title }) => ({ value, title }))
                ],
                get: () => {
                    const settings = scene.layout.settings;
                    if (settings.autoRange) return "auto";
                    return String(settings.lastMidi - settings.firstMidi + 1);
                },
                set: (value) => {
                    if (value === "auto") {
                        scene.configureLayout({ autoRange: true, firstMidi: 21, lastMidi: 108 });
                    } else {
                        const range = ranges.find((item) => item.value === value);
                        if (!range) return;
                        scene.configureLayout({
                            autoRange: false,
                            firstMidi: range.first,
                            lastMidi: range.last
                        });
                    }
                    apply();
                }
            },
            {
                type: "number",
                key: "height",
                label: "Высота клавиатуры",
                group: "view",
                min: 3.5,
                max: 6.5,
                step: 0.25,
                format: { prefix: "×", digits: 2 },
                get: () => scene.layout.settings.heightRatio,
                set: (value) => {
                    scene.configureLayout({ heightRatio: value });
                    apply();
                }
            }
        ];
        return specs;
    });

    store.addOwner("system", () => [
        {
            type: "boolean",
            key: "persist",
            label: "Сохранять настройки",
            group: "system",
            get: () => persistence.enabled,
            set: (value) => persistence.setEnabled(value)
        },
        {
            type: "action",
            key: "reset",
            label: "Сбросить всё",
            group: "system",
            hint: "↵",
            run: () => store.reset()
        }
    ]);
}
