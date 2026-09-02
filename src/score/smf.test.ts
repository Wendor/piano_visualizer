import { describe as suite, expect, it } from "vitest";
import { parseMidiFile } from "./smf";

function varint(value: number): number[] {
    const bytes = [value & 0x7f];
    let rest = value >> 7;
    while (rest > 0) {
        bytes.unshift((rest & 0x7f) | 0x80);
        rest >>= 7;
    }
    return bytes;
}

function chunk(label: string, body: number[]): number[] {
    const length = body.length;
    return [
        ...[...label].map((c) => c.charCodeAt(0)),
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
        ...body
    ];
}

/** Трек из пар «дельта — событие», с обязательным End of Track. */
function track(events: Array<[number, number[]]>): number[] {
    const body: number[] = [];
    for (const [delta, bytes] of events) body.push(...varint(delta), ...bytes);
    body.push(...varint(0), 0xff, 0x2f, 0x00);
    return chunk("MTrk", body);
}

function file(format: number, division: number, tracks: number[][]): ArrayBuffer {
    const header = chunk("MThd", [
        0,
        format,
        (tracks.length >> 8) & 0xff,
        tracks.length & 0xff,
        (division >> 8) & 0xff,
        division & 0xff
    ]);
    return new Uint8Array([...header, ...tracks.flat()]).buffer;
}

const DIVISION = 480; // тиков на четверть

suite("parseMidiFile", () => {
    it("читает ноту и переводит тики в секунды при темпе по умолчанию", () => {
        const score = parseMidiFile(
            file(0, DIVISION, [
                track([
                    [0, [0x90, 60, 100]],
                    [DIVISION, [0x80, 60, 0]]
                ])
            ]),
            "one.mid"
        );

        expect(score.name).toBe("one.mid");
        expect(score.notes).toHaveLength(1);
        // 120 ударов в минуту: четверть = 0.5 с.
        expect(score.notes[0]).toMatchObject({ midi: 60, velocity: 100, start: 0, track: 0 });
        expect(score.notes[0]!.end).toBeCloseTo(0.5, 6);
        expect(score.duration).toBeCloseTo(0.5, 6);
    });

    it("понимает running status и note on с нулевой громкостью", () => {
        const score = parseMidiFile(
            file(0, DIVISION, [
                track([
                    [0, [0x90, 60, 80]],
                    [0, [64, 80]], // тот же статус
                    [DIVISION, [60, 0]], // выключение через velocity 0
                    [0, [64, 0]]
                ])
            ]),
            "running.mid"
        );

        expect(score.notes.map((note) => note.midi)).toEqual([60, 64]);
        expect(score.notes.every((note) => Math.abs(note.end - 0.5) < 1e-6)).toBe(true);
    });

    it("учитывает смену темпа", () => {
        const slow = [0xff, 0x51, 0x03, 0x0f, 0x42, 0x40]; // 1 000 000 мкс = 60 bpm
        const score = parseMidiFile(
            file(0, DIVISION, [
                track([
                    [0, [0x90, 60, 90]],
                    [DIVISION, [0x80, 60, 0]],
                    [0, slow],
                    [0, [0x90, 62, 90]],
                    [DIVISION, [0x80, 62, 0]]
                ])
            ]),
            "tempo.mid"
        );

        expect(score.notes[0]!.end).toBeCloseTo(0.5, 6);
        // После смены темпа четверть длится секунду.
        expect(score.notes[1]!.start).toBeCloseTo(0.5, 6);
        expect(score.notes[1]!.end).toBeCloseTo(1.5, 6);
    });

    it("собирает педаль и не дублирует одинаковые состояния", () => {
        const score = parseMidiFile(
            file(0, DIVISION, [
                track([
                    [0, [0xb0, 64, 127]],
                    [0, [0xb0, 64, 100]], // всё ещё нажата — второе событие лишнее
                    [0, [0x90, 60, 90]],
                    [DIVISION, [0x80, 60, 0]],
                    [0, [0xb0, 64, 0]]
                ])
            ]),
            "pedal.mid"
        );

        expect(score.pedal).toHaveLength(2);
        expect(score.pedal[0]).toMatchObject({ on: true, time: 0 });
        expect(score.pedal[1]!.on).toBe(false);
        expect(score.pedal[1]!.time).toBeCloseTo(0.5, 6);
    });

    it("сводит несколько треков в одну партитуру, помня номер трека", () => {
        const score = parseMidiFile(
            file(1, DIVISION, [
                track([
                    [0, [0x90, 60, 90]],
                    [DIVISION, [0x80, 60, 0]]
                ]),
                track([
                    [DIVISION, [0x90, 72, 90]],
                    [DIVISION, [0x80, 72, 0]]
                ])
            ]),
            "two.mid"
        );

        expect(score.tracks).toBe(2);
        expect(score.notes.map((note) => [note.midi, note.track])).toEqual([
            [60, 0],
            [72, 1]
        ]);
        expect(score.duration).toBeCloseTo(1, 6);
    });

    it("пропускает события, которые не рисует: pitch bend, program change, sysex", () => {
        const score = parseMidiFile(
            file(0, DIVISION, [
                track([
                    [0, [0xe0, 0x00, 0x40]],
                    [0, [0xc0, 0x05]],
                    [0, [0xf0, 0x02, 0x7e, 0xf7]],
                    [0, [0x90, 60, 90]],
                    [DIVISION, [0x80, 60, 0]]
                ])
            ]),
            "noise.mid"
        );

        expect(score.notes).toHaveLength(1);
    });

    it("обрывает ноту без выключения на конце файла", () => {
        const score = parseMidiFile(
            file(0, DIVISION, [
                track([
                    [0, [0x90, 60, 90]],
                    [DIVISION * 2, [0x90, 64, 90]],
                    [0, [0x80, 64, 0]]
                ])
            ]),
            "hanging.mid"
        );

        const held = score.notes.find((note) => note.midi === 60)!;
        expect(held.end).toBeCloseTo(1, 6);
    });

    it("внятно отказывается от SMPTE и от чужих файлов", () => {
        expect(() => parseMidiFile(file(0, 0xe728, [track([])]), "smpte.mid")).toThrow(/SMPTE/);
        expect(() => parseMidiFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, "x.bin")).toThrow(
            /не MIDI/i
        );
    });

    it("отказывается от файла без нот", () => {
        expect(() => parseMidiFile(file(0, DIVISION, [track([[0, [0xb0, 7, 90]]])]), "empty.mid")).toThrow(
            /нет нот/
        );
    });
});
