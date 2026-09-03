import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import { NoteStyle, noteStyle, seedOf } from "./style";
import type { NoteBar } from "./style";

/**
 * Живая игра: нота растёт вверх от клавиши, пока её держат, и после
 * отпускания уплывает целиком. Геометрия каждый кадр считается из времени
 * события, поэтому resize и смена диапазона ничего не ломают.
 */
export class RisingNotesLayer extends BaseLayer {
    readonly id = "notes.rising";
    readonly stage = Stage.Notes;
    readonly title = "Ноты";
    readonly toggleable = false;

    private bars: NoteBar[] = [];

    constructor(private readonly style: NoteStyle = noteStyle) {
        super();
    }

    override init(scene: Scene): void {
        this.requestRetention(scene);
    }

    override resize(scene: Scene): void {
        this.requestRetention(scene);
    }

    private requestRetention(scene: Scene): void {
        const flight = (scene.layout.top + 120) / this.style.options.speed;
        scene.requestRetention(this.id, flight + 1);
    }

    override update(scene: Scene, _dt: number): void {
        const { layout, theme, time } = scene;
        const { speed, gap, hollowNaturals } = this.style.options;
        this.style.time = time;
        const bars: NoteBar[] = [];

        for (const note of scene.notes) {
            const key = layout.get(note.midi);
            if (!key) continue;

            const inset = Math.max(1, key.width * gap);
            const bottom = note.end === null ? layout.top : layout.top - (time - note.end) * speed;
            if (bottom < -40) continue;

            const top = layout.top - (time - note.start) * speed;
            const height = bottom - top;
            if (height <= 0.5) continue;

            bars.push({
                x: key.x + inset,
                width: Math.max(2, key.width - inset * 2),
                top,
                height,
                hue: theme.hueFor(note.midi, layout),
                velocity: Math.min(1, note.velocity / 110),
                hollow: hollowNaturals && !note.accidental,
                openBottom: note.end === null,
                rising: true,
                seed: seedOf(note.id)
            });
        }

        this.bars = bars;
    }

    override drawGlow(g: CanvasRenderingContext2D, scene: Scene): void {
        for (const bar of this.bars) this.style.drawGlow(g, scene.theme, bar);
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        for (const bar of this.bars) this.style.draw(g, scene.theme, bar);
    }
}
