import { BaseLayer, Stage } from "../../core/types";
import type { Scene } from "../../core/Scene";
import { isAccidental } from "../../core/layout";
import { firstNoteAtOrAfter } from "../../score/types";
import { NoteBars, NoteStyle, noteStyle, seedOf } from "./style";
import type { Painter } from "../../paint/Painter";

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

    private readonly bars = new NoteBars();

    constructor(private readonly style: NoteStyle = noteStyle) {
        super();
    }

    override update(scene: Scene, _dt: number): void {
        const { layout, theme, playback } = scene;
        const score = playback.score;
        this.bars.clear();
        if (!score) return;

        const { speed, gap, hollowNaturals } = this.style.options;
        const now = playback.time;
        this.style.time = scene.time;
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
            const bar = this.bars.take();
            bar.x = key.x + inset;
            bar.width = Math.max(2, key.width - inset * 2);
            bar.top = top;
            bar.height = height;
            bar.hue = theme.hueFor(key.midi, layout);
            bar.velocity = Math.min(1, note.velocity / 110);
            bar.hollow = hollowNaturals && !isAccidental(key.midi);
            bar.openBottom = rawBottom > layout.top;
            bar.rising = false;
            // Номер ноты в партитуре постоянен: зерно переживает и кадр,
            // и перемотку, и выключение партии.
            bar.seed = seedOf(i);
        }
    }

    override drawGlow(p: Painter, scene: Scene): void {
        for (let i = 0; i < this.bars.length; i++) this.style.drawGlow(p, scene.theme, this.bars.at(i));
    }

    override draw(p: Painter, scene: Scene): void {
        for (let i = 0; i < this.bars.length; i++) this.style.draw(p, scene.theme, this.bars.at(i));
    }
}
