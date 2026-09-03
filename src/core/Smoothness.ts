/** Промежутки длиннее этого — не рывок, а возвращение вкладки из фона. */
const AWAY_MS = 200;
/** Во сколько раз кадр должен превысить обычный, чтобы его стало видно. */
const STALL_RATIO = 1.5;
/** Ниже этого рывок глазу не заметен, каким бы ни был обычный кадр. */
const STALL_FLOOR_MS = 20;

/**
 * Плавность хода: то, что видно глазом, но не видно в среднем.
 *
 * Кадров в секунду мало для суждения. Телефон при касании поднимает экран до
 * 120 Гц, и `requestAnimationFrame` честно зовут сто раз в секунду — среднее
 * выходит прекрасным, а картинка дёргается, потому что промежутки рваные.
 * Поэтому считаем не только частоту, но и то, как часто ход сбивается.
 */
export class Smoothness {
    private readonly frames: number[] = [];
    private next = 0;

    constructor(private readonly window = 120) {}

    sample(frameMs: number): void {
        // Вкладка была скрыта: этот промежуток ничего не говорит об отрисовке.
        if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs >= AWAY_MS) return;
        if (this.frames.length < this.window) this.frames.push(frameMs);
        else {
            this.frames[this.next] = frameMs;
            this.next = (this.next + 1) % this.window;
        }
    }

    reset(): void {
        this.frames.length = 0;
        this.next = 0;
    }

    /** Обычный кадр — медиана: одиночные выбросы её не сдвигают. */
    get typical(): number {
        if (this.frames.length === 0) return 0;
        const sorted = [...this.frames].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)]!;
    }

    get worst(): number {
        return this.frames.length === 0 ? 0 : Math.max(...this.frames);
    }

    /** Сколько кадров в окне сбились с хода. */
    get stalls(): number {
        const limit = this.limit;
        if (limit === 0) return 0;
        let count = 0;
        for (const frame of this.frames) if (frame > limit) count++;
        return count;
    }

    /** Доля сбившихся кадров, 0…1. */
    get jitter(): number {
        return this.frames.length === 0 ? 0 : this.stalls / this.frames.length;
    }

    get fps(): number {
        if (this.frames.length === 0) return 0;
        const total = this.frames.reduce((sum, frame) => sum + frame, 0);
        return total > 0 ? (this.frames.length * 1000) / total : 0;
    }

    private get limit(): number {
        const typical = this.typical;
        return typical === 0 ? 0 : Math.max(typical * STALL_RATIO, STALL_FLOOR_MS);
    }
}
