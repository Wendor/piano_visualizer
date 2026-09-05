import { describe, expect, it } from "vitest";
import { FrameClock } from "./FrameClock";

/** Метки времени ровной развёртки с дрожанием, как их отдаёт браузер. */
function stamps(count: number, period: number, jitter: number): number[] {
    const list: number[] = [];
    // Псевдослучайность своя: ряд должен повторяться от запуска к запуску.
    let seed = 12345;
    for (let i = 0; i < count; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        list.push(i * period + (seed / 2147483648 - 0.5) * 2 * jitter);
    }
    return list;
}

/** Шаги, которые часы выдали на этом ряду меток. */
function steps(clock: FrameClock, list: readonly number[]): number[] {
    return list.map((now) => clock.step(now) * 1000);
}

describe("FrameClock", () => {
    it("первый кадр не двигает сцену: двигаться ещё не от чего", () => {
        expect(new FrameClock().step(1000)).toBe(0);
    });

    it("на ровной развёртке с дрожащей меткой шаг ровный", () => {
        const clock = new FrameClock();
        const list = steps(clock, stamps(200, 1000 / 120, 0.8)).slice(20);
        const spread = Math.max(...list) - Math.min(...list);
        // Метка гуляла на ±0.8 мс — полтора миллиметра хода ноты на 480 px/с.
        // От шага должно остаться меньше десятой доли этого.
        expect(spread).toBeLessThan(0.15);
        expect(list[0]).toBeCloseTo(1000 / 120, 1);
    });

    it("не отстаёт от времени, как бы ни дрожала метка", () => {
        const period = 1000 / 120;
        const clock = new FrameClock();
        const made = steps(clock, stamps(400, period, 0.8));
        // Сравнивать надо с сеткой, а не с крайними метками: те сами дрожат.
        // Пока сетка ставится, часы имеют право на разовую поправку, а вот
        // уезжать от времени не имеют: за две сотни кадров — меньше десятой
        // доли процента.
        const half = made.length >> 1;
        const moved = made.slice(half).reduce((a, b) => a + b, 0);
        expect(Math.abs(moved - half * period) / (half * period)).toBeLessThan(0.001);
    });

    it("пропущенный кадр — это два шага, а не рывок", () => {
        const clock = new FrameClock();
        const period = 1000 / 120;
        const list = stamps(40, period, 0);
        // Один кадр не случился: метка приходит через два периода.
        const skipped = [...list.slice(0, 30), ...list.slice(31)];
        const made = steps(clock, skipped);
        // Первый шаг — нулевой, поэтому пропуск виден на следующем за меткой.
        expect(made[30]).toBeCloseTo(period * 2, 1);
        expect(made[31]).toBeCloseTo(period, 1);
    });

    it("перестраивается, когда экран сменил частоту", () => {
        const clock = new FrameClock();
        steps(clock, stamps(60, 1000 / 120, 0.5));
        const slow = stamps(60, 1000 / 60, 0.5).map((t) => t + 60 * (1000 / 120));
        const made = steps(clock, slow).slice(30);
        for (const step of made) expect(step).toBeCloseTo(1000 / 60, 0);
    });

    it("возвращение из фона не уносит сцену в будущее по частям", () => {
        const clock = new FrameClock();
        const period = 1000 / 120;
        steps(clock, stamps(60, period, 0.5));
        const away = 60 * period + 5000;
        // Один шаг на всю паузу — с точностью до кадра; сцена сама решит, что
        // делать с таким скачком.
        expect(Math.abs(clock.step(away) * 1000 - 5000)).toBeLessThan(1000 / 60);
        expect(clock.step(away + period) * 1000).toBeCloseTo(period, 1);
    });

    it("после сброса первый кадр снова не двигает сцену", () => {
        const clock = new FrameClock();
        steps(clock, stamps(30, 1000 / 120, 0.5));
        clock.reset();
        expect(clock.step(9000)).toBe(0);
    });

    it("знает период развёртки и встаёт на сетку", () => {
        const clock = new FrameClock();
        steps(clock, stamps(60, 1000 / 120, 0.8));
        expect(clock.period).toBeCloseTo(1000 / 120, 0);
        expect(clock.locked).toBe(true);
    });
});
