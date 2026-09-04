import { Emitter } from "./Emitter";
import { Smoothness } from "./Smoothness";
import type { ParamSpec } from "../settings/types";

export type QualityLevel = "high" | "medium" | "low";
export type QualityMode = QualityLevel | "auto";

/**
 * Во что уровень качества обходится слоям. Все множители — доли: слой
 * умножает на них свою полную цену и не знает, кто и почему их опустил.
 */
export interface QualityProfile {
    /** Множитель к разрешению холста: 0.7 — рисуем в 0.7 экрана и растягиваем. */
    readonly renderScale: number;
    /** Размер буфера свечения в долях экрана. */
    readonly glowScale: number;
    /** Сколько ступеней пирамиды размытия строит блум. */
    readonly bloomPasses: number;
    /** Множитель числа частиц: искр, пыли, облаков дымки. */
    readonly particles: number;
    /** Украшения, которые видно только вблизи: блики, живая заливка, шлейфы. */
    readonly detail: number;
    /**
     * Потолок площади холста в пикселях. Плотность экрана о нагрузке говорит
     * мало: телевизор на 4K просит 8.3 мегапикселя при `devicePixelRatio`
     * равном единице, и слабый ускоритель на этом встаёт.
     */
    readonly maxPixels: number;
}

const PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
    // Потолок высокой ступени выбран так, чтобы ноутбук с Retina проходил
    // целиком (1512×982 при плотности 2 — это 5.9 мегапикселя). Низкая
    // ступень рассчитана на машину без ускорения холста: там платят за
    // каждый пиксель, а полноэкранных проходов у сцены полдюжины.
    high: { renderScale: 1, glowScale: 0.25, bloomPasses: 4, particles: 1, detail: 1, maxPixels: 6_200_000 },
    medium: {
        renderScale: 0.8,
        glowScale: 0.2,
        bloomPasses: 3,
        particles: 0.6,
        detail: 0.5,
        maxPixels: 3_000_000
    },
    low: {
        renderScale: 0.4,
        glowScale: 0.16,
        bloomPasses: 2,
        particles: 0.25,
        detail: 0,
        maxPixels: 900_000
    }
};

const LADDER: readonly QualityLevel[] = ["low", "medium", "high"];

const TITLES: Readonly<Record<QualityLevel, string>> = {
    high: "высокое",
    medium: "среднее",
    low: "низкое"
};

export interface QualityEvents extends Record<string, unknown> {
    /** Профиль сменился: холсту пора перестроиться. */
    change: { level: QualityLevel; profile: QualityProfile };
}

/**
 * Судим по времени работы кадра, а не по промежутку между кадрами: при
 * вертикальной синхронизации промежуток всегда равен периоду экрана и о
 * запасе ничего не говорит. Промежуток нужен лишь как второй признак —
 * если кадры откровенно пропускаются, дело плохо независимо от замеров.
 */
const SLOW_WORK_MS = 11;
const FAST_WORK_MS = 5;
const SLOW_FRAME_MS = 26;
const FAST_FRAME_MS = 20;
/**
 * Доля сбившихся кадров, за которой ход считается рваным. Средний промежуток
 * о плавности молчит: телефон при касании поднимает экран до 120 Гц, кадров
 * становится больше, а идут они рвано — и картинка дёргается при формально
 * прекрасном счёте.
 */
const SLOW_JITTER = 0.12;
const FAST_JITTER = 0.04;
/** Сколько секунд подряд держится оценка, прежде чем ступень сдвинется. */
const DROP_AFTER = 1.5;
const RAISE_AFTER = 6;
/** После смены ступени судить рано: холст и кэши перестраиваются. */
const COOLDOWN = 2;

/**
 * Уровень качества сцены. В режиме «авто» сам опускает ступень, если машина
 * не держит кадр, и поднимает обратно, когда появляется запас, — так один
 * и тот же код идёт и на ноутбуке, и на слабом телевизоре.
 */
export class Quality {
    readonly events = new Emitter<QualityEvents>();

    private modeValue: QualityMode = "auto";
    private levelValue: QualityLevel = "high";
    /** Экспоненциальное среднее работы кадра, мс. */
    private workMs = 6;
    /** Экспоненциальное среднее промежутка между кадрами, мс. */
    private frameMs = 16.7;
    /** Плавность хода: её же показывает счётчик. */
    readonly smoothness = new Smoothness();
    private slowFor = 0;
    private fastFor = 0;
    private cooldown = 0;

    get mode(): QualityMode {
        return this.modeValue;
    }

    get level(): QualityLevel {
        return this.levelValue;
    }

    get profile(): QualityProfile {
        return PROFILES[this.levelValue]!;
    }

    /** Среднее число кадров в секунду по последним кадрам. */
    get fps(): number {
        return this.frameMs > 0 ? 1000 / this.frameMs : 0;
    }

    /** Сколько миллисекунд уходит на сам кадр — без ожидания развёртки. */
    get work(): number {
        return this.workMs;
    }

    get title(): string {
        const level = TITLES[this.levelValue];
        return this.modeValue === "auto" ? `авто · ${level}` : level;
    }

    setMode(mode: QualityMode): void {
        if (this.modeValue === mode) return;
        this.modeValue = mode;
        this.slowFor = 0;
        this.fastFor = 0;
        this.cooldown = COOLDOWN;
        if (mode !== "auto") this.apply(mode);
        else this.apply("high");
    }

    /**
     * Кадр отработан: `workMs` — время сцены и отрисовки, `frameMs` —
     * промежуток от прошлого кадра. Решение принимается не по одному кадру,
     * а по устойчивой картине: случайная задержка от сборки мусора не должна
     * ронять качество.
     */
    sample(workMs: number, frameMs: number): void {
        this.smoothness.sample(frameMs);
        // Часы здесь свои: время меряется длиной кадра, а не шагом сцены. Шаг
        // ограничен сверху, чтобы прыжок времени не рвал физику, — и на слабой
        // машине, где кадр идёт впятеро дольше потолка, счёт «полторы секунды
        // подряд тяжело» растянулся бы на восемь реальных секунд. Ступень
        // опускалась бы медленнее всего там, где она нужнее всего.
        const seconds = Math.min(0.25, frameMs / 1000);
        // Промежутки длиннее 200 мс — это не «медленно», это вкладка была в фоне.
        if (frameMs < 200) this.frameMs += (frameMs - this.frameMs) * 0.08;
        if (workMs < 200) this.workMs += (workMs - this.workMs) * 0.08;
        if (this.modeValue !== "auto") return;

        if (this.cooldown > 0) {
            this.cooldown -= seconds;
            return;
        }

        const jitter = this.smoothness.jitter;
        const slow = this.workMs > SLOW_WORK_MS || this.frameMs > SLOW_FRAME_MS || jitter > SLOW_JITTER;
        const fast = this.workMs < FAST_WORK_MS && this.frameMs < FAST_FRAME_MS && jitter < FAST_JITTER;
        this.slowFor = slow ? this.slowFor + seconds : 0;
        this.fastFor = fast ? this.fastFor + seconds : 0;

        const index = LADDER.indexOf(this.levelValue);
        if (this.slowFor >= DROP_AFTER && index > 0) this.shift(index - 1);
        else if (this.fastFor >= RAISE_AFTER && index < LADDER.length - 1) this.shift(index + 1);
    }

    params(): ParamSpec[] {
        return [
            {
                type: "enum",
                key: "level",
                label: "Качество",
                group: "system",
                variants: [
                    { value: "auto", title: "авто" },
                    { value: "high", title: "высокое" },
                    { value: "medium", title: "среднее" },
                    { value: "low", title: "низкое" }
                ],
                get: () => this.modeValue,
                set: (value) => this.setMode(value as QualityMode)
            }
        ];
    }

    private shift(index: number): void {
        const next = LADDER[index];
        if (next) this.apply(next);
    }

    private apply(level: QualityLevel): void {
        this.slowFor = 0;
        this.fastFor = 0;
        this.cooldown = COOLDOWN;
        if (this.levelValue === level) return;
        this.levelValue = level;
        // Оценку сбрасываем: старое среднее относится к другой картинке.
        this.workMs = 6;
        this.frameMs = 16.7;
        this.smoothness.reset();
        this.events.emit("change", { level, profile: this.profile });
    }
}
