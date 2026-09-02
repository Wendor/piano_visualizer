/**
 * Разбор Standard MIDI File. Тики переводятся в секунды прямо здесь, по карте
 * темпа, — дальше по проекту время везде в секундах.
 */

import { makeScore } from "./types";
import type { PedalEvent, Score, ScoreNote } from "./types";

interface RawEvent {
    readonly tick: number;
    readonly track: number;
    readonly kind: "on" | "off" | "pedal" | "tempo";
    readonly midi: number;
    readonly velocity: number;
    readonly channel: number;
    /** Для tempo — микросекунды на четверть; для pedal — значение контроллера. */
    readonly value: number;
}

class Reader {
    offset = 0;

    constructor(private readonly view: DataView) {}

    get done(): boolean {
        return this.offset >= this.view.byteLength;
    }

    u8(): number {
        this.require(1);
        return this.view.getUint8(this.offset++);
    }

    u16(): number {
        this.require(2);
        const value = this.view.getUint16(this.offset);
        this.offset += 2;
        return value;
    }

    u32(): number {
        this.require(4);
        const value = this.view.getUint32(this.offset);
        this.offset += 4;
        return value;
    }

    /** Число переменной длины: семь бит на байт, старший бит — признак продолжения. */
    varInt(): number {
        let value = 0;
        for (let i = 0; i < 4; i++) {
            const byte = this.u8();
            value = (value << 7) | (byte & 0x7f);
            if ((byte & 0x80) === 0) return value;
        }
        throw new Error("Повреждённый файл: слишком длинное число");
    }

    text(length: number): string {
        this.require(length);
        let result = "";
        for (let i = 0; i < length; i++) result += String.fromCharCode(this.view.getUint8(this.offset + i));
        this.offset += length;
        return result;
    }

    skip(length: number): void {
        this.require(length);
        this.offset += length;
    }

    private require(length: number): void {
        if (this.offset + length > this.view.byteLength) {
            throw new Error("Повреждённый файл: данные обрываются");
        }
    }
}

export function parseMidiFile(data: ArrayBuffer, name: string): Score {
    const reader = new Reader(new DataView(data));

    if (reader.text(4) !== "MThd") throw new Error("Это не MIDI-файл");
    const headerLength = reader.u32();
    const format = reader.u16();
    const trackCount = reader.u16();
    const division = reader.u16();
    if (headerLength > 6) reader.skip(headerLength - 6);

    if (format > 2) throw new Error(`Неизвестный формат MIDI: ${format}`);
    if ((division & 0x8000) !== 0) throw new Error("Файлы с делением SMPTE пока не поддерживаются");
    if (division === 0) throw new Error("Повреждённый файл: нулевое деление");

    const events: RawEvent[] = [];
    for (let track = 0; track < trackCount && !reader.done; track++) {
        const label = reader.text(4);
        const length = reader.u32();
        if (label !== "MTrk") {
            reader.skip(length);
            continue;
        }
        readTrack(reader, reader.offset + length, track, events);
    }

    events.sort((a, b) => a.tick - b.tick);
    return build(events, division, name, trackCount);
}

function readTrack(reader: Reader, end: number, track: number, out: RawEvent[]): void {
    let tick = 0;
    let status = 0;

    while (reader.offset < end) {
        tick += reader.varInt();
        let byte = reader.u8();

        if (byte < 0x80) {
            // Running status: статус тот же, что у предыдущего события.
            if (status === 0) throw new Error("Повреждённый файл: событие без статуса");
            reader.offset--;
            byte = status;
        } else if (byte < 0xf0) {
            status = byte;
        }

        const type = byte & 0xf0;
        const channel = byte & 0x0f;

        if (byte === 0xff) {
            const meta = reader.u8();
            const length = reader.varInt();
            if (meta === 0x51 && length === 3) {
                const value = (reader.u8() << 16) | (reader.u8() << 8) | reader.u8();
                out.push({ tick, track, kind: "tempo", midi: 0, velocity: 0, channel, value });
            } else {
                reader.skip(length);
            }
            continue;
        }

        if (byte === 0xf0 || byte === 0xf7) {
            reader.skip(reader.varInt());
            continue;
        }

        switch (type) {
            case 0x90: {
                const midi = reader.u8();
                const velocity = reader.u8();
                out.push({
                    tick,
                    track,
                    kind: velocity > 0 ? "on" : "off",
                    midi,
                    velocity,
                    channel,
                    value: 0
                });
                break;
            }
            case 0x80: {
                const midi = reader.u8();
                const velocity = reader.u8();
                out.push({ tick, track, kind: "off", midi, velocity, channel, value: 0 });
                break;
            }
            case 0xb0: {
                const controller = reader.u8();
                const value = reader.u8();
                if (controller === 64) {
                    out.push({ tick, track, kind: "pedal", midi: 0, velocity: 0, channel, value });
                }
                break;
            }
            case 0xa0:
            case 0xe0:
                reader.skip(2);
                break;
            case 0xc0:
            case 0xd0:
                reader.skip(1);
                break;
            default:
                throw new Error(`Неизвестное событие MIDI: 0x${byte.toString(16)}`);
        }
    }

    reader.offset = end;
}

/** Карта темпа: точки смены с накопленным временем в секундах. */
function build(events: readonly RawEvent[], division: number, name: string, tracks: number): Score {
    const notes: ScoreNote[] = [];
    const pedal: PedalEvent[] = [];
    const pending = new Map<number, { midi: number; start: number; velocity: number; track: number }[]>();

    let tempo = 500000; // 120 ударов в минуту, пока файл не сказал иное
    let lastTick = 0;
    let lastSeconds = 0;
    const seconds = (tick: number): number => lastSeconds + ((tick - lastTick) * tempo) / (division * 1e6);

    let pedalDown = false;

    for (const event of events) {
        const time = seconds(event.tick);

        if (event.kind === "tempo") {
            lastSeconds = time;
            lastTick = event.tick;
            tempo = event.value;
            continue;
        }

        if (event.kind === "pedal") {
            const on = event.value >= 64;
            if (on !== pedalDown) {
                pedalDown = on;
                pedal.push({ time, on });
            }
            continue;
        }

        const key = event.channel * 128 + event.midi;
        if (event.kind === "on") {
            const stack = pending.get(key) ?? [];
            stack.push({ midi: event.midi, start: time, velocity: event.velocity, track: event.track });
            pending.set(key, stack);
            continue;
        }

        const stack = pending.get(key);
        const started = stack?.shift();
        if (!started) continue;
        notes.push({
            midi: event.midi,
            velocity: started.velocity,
            start: started.start,
            end: Math.max(time, started.start + 0.02),
            track: started.track
        });
    }

    // Ноты без пары «выключить» — обрываем на конце файла.
    const tail = events.length > 0 ? seconds(events[events.length - 1]!.tick) : 0;
    for (const stack of pending.values()) {
        for (const started of stack) {
            notes.push({
                midi: started.midi,
                velocity: started.velocity,
                start: started.start,
                end: Math.max(tail, started.start + 0.02),
                track: started.track
            });
        }
    }

    if (notes.length === 0) throw new Error("В файле нет нот");
    return makeScore(name, notes, pedal, tracks);
}
