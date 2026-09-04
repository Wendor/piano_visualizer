import { BaseLayer, Stage } from "../../core/types";
import { snap } from "../../core/math";
import type { Scene } from "../../core/Scene";
import { firstLineAtOrAfter } from "../../score/grid";
import type { ParamSpec } from "../../settings/types";
import { percent } from "../../settings/types";
import { NoteStyle, noteStyle } from "./style";
import type { Painter } from "../../paint/Painter";
import type { Tint } from "../../paint/Tint";

export interface BarGridOptions {
    /** Яркость линий такта, 0 — не рисовать. */
    bars: number;
    /** Яркость линий доли, 0 — не рисовать. */
    beats: number;
}

/**
 * Сетка тактов и долей под падающими нотами. Линии едут с той же скоростью,
 * что и ноты, — координата считается тем же выражением и из того же
 * `NoteStyle`, поэтому разъехаться они не могут.
 *
 * Рисуется только в основной холст: сетка — разметка, а не свет, в буфере
 * свечения она размазалась бы в туман.
 */
export class BarGridLayer extends BaseLayer {
    readonly id = "notes.grid";
    readonly stage = Stage.NotesBack;
    readonly title = "Сетка тактов";
    /** Включением ведает NotesDirector: при живой игре темпа взять неоткуда. */
    readonly toggleable = false;
    readonly options: BarGridOptions;

    constructor(
        private readonly style: NoteStyle = noteStyle,
        options: Partial<BarGridOptions> = {}
    ) {
        super();
        this.options = { bars: 0.22, beats: 0.08, ...options };
    }

    override params(): ParamSpec[] {
        const o = this.options;
        return [
            {
                type: "number",
                key: "bars",
                label: "Линии тактов",
                group: "notes",
                min: 0,
                max: 1,
                step: 0.02,
                format: percent,
                get: () => o.bars,
                set: (value) => {
                    o.bars = value;
                }
            },
            {
                type: "number",
                key: "beats",
                label: "Линии долей",
                group: "notes",
                min: 0,
                max: 1,
                step: 0.02,
                format: percent,
                get: () => o.beats,
                set: (value) => {
                    o.beats = value;
                }
            }
        ];
    }

    override draw(p: Painter, scene: Scene): void {
        const score = scene.playback.score;
        if (!score || this.style.options.speed <= 0) return;

        const hue = scene.theme.midHue;
        // Доли ложатся первыми: линия такта, совпав с ними, должна быть сверху.
        if (this.options.beats > 0) {
            this.paint(p, scene, score.grid.beats, scene.theme.tint(hue, 72, this.options.beats));
        }
        if (this.options.bars > 0) {
            this.paint(p, scene, score.grid.bars, scene.theme.tint(hue, 84, this.options.bars));
        }
    }

    private paint(p: Painter, scene: Scene, times: readonly number[], tint: Tint): void {
        const { layout, viewport, playback } = scene;
        const speed = this.style.options.speed;
        const now = playback.time;
        const thickness = 1 / viewport.dpr;

        for (let i = firstLineAtOrAfter(times, now); i < times.length; i++) {
            const y = layout.top - (times[i]! - now) * speed;
            if (y < 0) break;
            p.fill(0, snap(y, viewport.dpr), viewport.width, thickness, tint);
        }
    }
}
