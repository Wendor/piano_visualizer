import { describe, expect, it } from "vitest";
import { Quality } from "./Quality";

/** Прогнать несколько секунд одинаковых кадров: работа и промежуток. */
function run(quality: Quality, workMs: number, frameMs: number, seconds: number): void {
    const dt = frameMs / 1000;
    for (let i = 0; i < Math.ceil(seconds / dt); i++) quality.sample(workMs, frameMs);
}

describe("Quality", () => {
    it("по умолчанию авто на высокой ступени", () => {
        const quality = new Quality();
        expect(quality.mode).toBe("auto");
        expect(quality.level).toBe("high");
        expect(quality.profile.renderScale).toBe(1);
    });

    it("опускает ступень, когда кадры стабильно долгие", () => {
        const quality = new Quality();
        const seen: string[] = [];
        quality.events.on("change", ({ level }) => seen.push(level));

        run(quality, 20, 40, 3);
        expect(quality.level).toBe("medium");
        // Сразу после смены — пауза: холст и кэши перестраиваются.
        expect(seen).toEqual(["medium"]);

        run(quality, 20, 40, 5);
        expect(quality.level).toBe("low");
        expect(quality.profile.renderScale).toBeLessThan(1);
    });

    it("на очень медленных кадрах решает за то же время, что и на быстрых", () => {
        const quality = new Quality();
        // Кадры по 180 мс: полторы секунды тяжёлой работы — это девять кадров,
        // а не девять секунд.
        for (let i = 0; i < 10; i++) quality.sample(30, 180);
        expect(quality.level).toBe("medium");
    });

    it("не опускает ниже низкой ступени", () => {
        const quality = new Quality();
        run(quality, 30, 60, 30);
        expect(quality.level).toBe("low");
    });

    it("возвращает ступень, когда появился запас", () => {
        const quality = new Quality();
        run(quality, 20, 40, 3);
        expect(quality.level).toBe("medium");

        run(quality, 3, 16.7, 12);
        expect(quality.level).toBe("high");
    });

    it("вертикальная синхронизация не мешает поднять ступень", () => {
        const quality = new Quality();
        run(quality, 20, 40, 3);
        expect(quality.level).toBe("medium");
        // Кадры идут ровно по 16.7 мс — по промежутку запаса не видно,
        // но работы в кадре мало, значит ступень можно вернуть.
        run(quality, 4, 16.7, 12);
        expect(quality.level).toBe("high");
    });

    it("длинный кадр из фоновой вкладки не считается тормозом", () => {
        const quality = new Quality();
        for (let i = 0; i < 60; i++) quality.sample(5, 4000);
        expect(quality.level).toBe("high");
    });

    it("ручной режим не двигает ступень сам", () => {
        const quality = new Quality();
        quality.setMode("medium");
        expect(quality.level).toBe("medium");
        run(quality, 30, 60, 20);
        expect(quality.level).toBe("medium");
        expect(quality.title).toBe("среднее");
    });
});

describe("Quality: потолок площади холста", () => {
    it("на высокой ступени пропускает ноутбук с Retina целиком", () => {
        const quality = new Quality();
        // 1512×982 при плотности 2 — рабочий стол MacBook Pro.
        expect(quality.profile.maxPixels).toBeGreaterThanOrEqual(1512 * 2 * 982 * 2);
    });

    it("на низкой ступени холст занимает не больше пятой части площади экрана", () => {
        const quality = new Quality();
        quality.setMode("low");
        // Машина без ускорения холста платит за каждый пиксель, а полноэкранных
        // проходов у сцены полдюжины: фон, дымка, свечение, затемнение, ноты.
        // Площадь растёт как квадрат масштаба — она и решает судьбу кадра.
        expect(quality.profile.renderScale ** 2).toBeLessThanOrEqual(0.2);
    });

    it("на низкой ступени просит меньше пикселей, чем на высокой", () => {
        const quality = new Quality();
        const high = quality.profile.maxPixels;
        quality.setMode("low");
        expect(quality.profile.maxPixels).toBeLessThan(high);
        // Телевизор на 4K должен уместиться заметно ниже своих 8.3 мегапикселя.
        expect(quality.profile.maxPixels).toBeLessThan(3840 * 2160 * 0.3);
    });
});

describe("Quality: рваный ход", () => {
    /** Экран на 120 Гц, который сцена не держит: два коротких кадра и рывок. */
    function jerky(quality: Quality, seconds: number): void {
        const pattern = [8.3, 8.3, 30];
        let elapsed = 0;
        let i = 0;
        while (elapsed < seconds * 1000) {
            const frameMs = pattern[i++ % pattern.length]!;
            // Холст рисует не сразу: работа JavaScript выглядит скромно даже
            // тогда, когда кадр на экране не успевает.
            quality.sample(4, frameMs);
            elapsed += frameMs;
        }
    }

    it("опускает ступень, когда ход рваный, хотя кадров много", () => {
        const quality = new Quality();
        jerky(quality, 6);
        expect(quality.fps).toBeGreaterThan(60);
        expect(quality.level).not.toBe("high");
    });

    it("не поднимает ступень обратно, пока ход рваный", () => {
        const quality = new Quality();
        quality.setMode("auto");
        jerky(quality, 20);
        expect(quality.level).toBe("low");
    });

    it("ровный быстрый ход ступень не роняет", () => {
        const quality = new Quality();
        for (let i = 0; i < 1000; i++) quality.sample(4, 8.3);
        expect(quality.level).toBe("high");
    });
});
