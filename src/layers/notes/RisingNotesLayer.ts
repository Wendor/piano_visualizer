import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import { NoteBars, NoteStyle, noteStyle, seedOf } from "./style";

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

    private readonly bars = new NoteBars();

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
        this.bars.clear();

        for (const note of scene.notes) {
            const key = layout.get(note.midi);
            if (!key) continue;

            const inset = Math.max(1, key.width * gap);
            const bottom = note.end === null ? layout.top : layout.top - (time - note.end) * speed;
            if (bottom < -40) continue;

            const top = layout.top - (time - note.start) * speed;
            const height = bottom - top;
            if (height <= 0.5) continue;

            const bar = this.bars.take();
            bar.x = key.x + inset;
            bar.width = Math.max(2, key.width - inset * 2);
            bar.top = top;
            bar.height = height;
            bar.hue = theme.hueFor(note.midi, layout);
            bar.velocity = Math.min(1, note.velocity / 110);
            bar.hollow = hollowNaturals && !note.accidental;
            bar.openBottom = note.end === null;
            bar.rising = true;
            bar.seed = seedOf(note.id);
        }
    }

    override drawGlow(g: CanvasRenderingContext2D, scene: Scene): void {
        for (let i = 0; i < this.bars.length; i++) this.style.drawGlow(g, scene.theme, this.bars.at(i));
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        for (let i = 0; i < this.bars.length; i++) this.style.draw(g, scene.theme, this.bars.at(i));
    }
}
