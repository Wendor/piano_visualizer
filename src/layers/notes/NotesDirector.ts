import type { Visualizer } from "../../core/Visualizer";
import type { Playback } from "../../score/Playback";
import type { ParamSpec } from "../../settings/types";

export type NotesDirection = "auto" | "up" | "down";

/**
 * Решает, какой из двух слоёв нот показывать. В режиме «авто» файл показывает
 * будущее (ноты падают), а живая игра — прошлое (ноты растут).
 */
export class NotesDirector {
    private mode: NotesDirection = "auto";

    constructor(
        private readonly visualizer: Visualizer,
        private readonly playback: Playback
    ) {
        this.playback.events.on("score", () => this.apply());
        this.apply();
    }

    params(): ParamSpec[] {
        return [
            {
                type: "enum",
                key: "direction",
                label: "Направление нот",
                group: "notes",
                variants: [
                    { value: "auto", title: "авто" },
                    { value: "up", title: "вверх" },
                    { value: "down", title: "вниз" }
                ],
                get: () => this.mode,
                set: (value) => {
                    this.mode = value as NotesDirection;
                    this.apply();
                }
            }
        ];
    }

    private apply(): void {
        const falling = this.mode === "down" || (this.mode === "auto" && this.playback.loaded);
        this.visualizer.toggleLayer("notes.falling", falling);
        this.visualizer.toggleLayer("notes.rising", !falling);
    }
}
