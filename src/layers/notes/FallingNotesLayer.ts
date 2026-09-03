import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import { isAccidental } from "../../core/layout";
import { firstNoteAtOrAfter } from "../../score/types";
import { NoteStyle, noteStyle } from "./style";
import type { NoteBar } from "./style";

/**
 * Воспроизведение файла: нота падает сверху и в свой момент входит в клавишу.
 * В кадре разбирается только видимое окно партитуры — двоичный поиск по началу
 * ноты, поэтому файл на тысячи нот стоит столько же, сколько короткий.
 */
export class FallingNotesLayer extends BaseLayer {
    readonly id = "notes.falling";
    readonly stage = Stage.Notes;
    readonly title = "Падающие ноты";
    readonly toggleable = false;

    private bars: NoteBar[] = [];

    constructor(private readonly style: NoteStyle = noteStyle) {
        super();
    }

    override update(scene: Scene, _dt: number): void {
        const { layout, theme, playback } = scene;
        const score = playback.score;
        this.bars = [];
        if (!score) return;

        const { speed, gap, hollowNaturals } = this.style.options;
        const now = playback.time;
        // Сколько секунд партитуры помещается над клавиатурой.
        const lookahead = (layout.top + 60) / speed;
        const last = firstNoteAtOrAfter(score.notes, now + lookahead);
        const earliest = now - score.maxDuration;

        for (let i = last - 1; i >= 0; i--) {
            const note = score.notes[i]!;
            if (note.start < earliest) break;
            if (note.end <= now || !playback.partEnabled(note.part)) continue;

            const key = layout.get(note.midi) ?? layout.get(layout.fold(note.midi));
            if (!key) continue;

            const top = layout.top - (note.end - now) * speed;
            const rawBottom = layout.top - (note.start - now) * speed;
            const bottom = Math.min(rawBottom, layout.top);
            const height = bottom - top;
            if (height <= 0.5) continue;

            const inset = Math.max(1, key.width * gap);
            this.bars.push({
                x: key.x + inset,
                width: Math.max(2, key.width - inset * 2),
                top,
                height,
                hue: theme.hueFor(key.midi, layout),
                velocity: Math.min(1, note.velocity / 110),
                hollow: hollowNaturals && !isAccidental(key.midi),
                openBottom: rawBottom > layout.top
            });
        }
    }

    override drawGlow(g: CanvasRenderingContext2D, scene: Scene): void {
        for (const bar of this.bars) this.style.drawGlow(g, scene.theme, bar);
    }

    override draw(g: CanvasRenderingContext2D, scene: Scene): void {
        for (const bar of this.bars) this.style.draw(g, scene.theme, bar);
    }
}
