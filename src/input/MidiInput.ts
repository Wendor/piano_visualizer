import type { Scene } from "../core/Scene";
import type { InputSource } from "./types";

/**
 * Локальные типы Web MIDI: не пересекаются с lib.dom, поэтому проект
 * собирается одинаково на любой версии TypeScript.
 */
interface MidiMessage {
    data: Uint8Array;
}
interface MidiPort {
    name: string | null;
    state: string;
    onmidimessage: ((event: MidiMessage) => void) | null;
}
interface MidiAccess {
    inputs: { forEach(callback: (port: MidiPort) => void): void };
    onstatechange: ((event: unknown) => void) | null;
}
type NavigatorWithMidi = Navigator & {
    requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
};

export interface MidiStatus {
    connected: boolean;
    text: string;
}

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const CC_SUSTAIN = 64;
const CC_ALL_SOUND_OFF = 120;
const CC_ALL_NOTES_OFF = 123;

/** Живой ввод с MIDI-клавиатуры: velocity, педаль, горячее подключение. */
export class MidiInput implements InputSource {
    readonly id = "input.midi";

    private scene: Scene | null = null;
    private access: MidiAccess | null = null;
    private ports: MidiPort[] = [];
    private statusListener: ((status: MidiStatus) => void) | null = null;
    private status: MidiStatus = { connected: false, text: "Поиск MIDI-устройства…" };

    onStatus(listener: (status: MidiStatus) => void): void {
        this.statusListener = listener;
        listener(this.status);
    }

    attach(scene: Scene): void {
        this.scene = scene;
        const navigatorWithMidi = navigator as NavigatorWithMidi;

        if (!navigatorWithMidi.requestMIDIAccess) {
            this.setStatus({ connected: false, text: "Web MIDI не поддерживается" });
            return;
        }

        navigatorWithMidi
            .requestMIDIAccess()
            .then((raw) => {
                const access = raw as MidiAccess;
                this.access = access;
                access.onstatechange = () => this.bind();
                this.bind();
            })
            .catch(() => this.setStatus({ connected: false, text: "Нет доступа к MIDI" }));
    }

    detach(): void {
        for (const port of this.ports) port.onmidimessage = null;
        this.ports = [];
        if (this.access) this.access.onstatechange = null;
        this.access = null;
        this.scene = null;
    }

    private bind(): void {
        if (!this.access) return;
        const names: string[] = [];
        const ports: MidiPort[] = [];

        this.access.inputs.forEach((port) => {
            port.onmidimessage = (event) => this.handle(event);
            ports.push(port);
            names.push(port.name ?? "MIDI");
        });

        this.ports = ports;
        this.setStatus(
            names.length
                ? { connected: true, text: names.join(" · ") }
                : { connected: false, text: "Подключите MIDI-клавиатуру" }
        );
    }

    private setStatus(status: MidiStatus): void {
        this.status = status;
        this.statusListener?.(status);
    }

    private handle(event: MidiMessage): void {
        const scene = this.scene;
        if (!scene) return;

        const status = event.data[0] ?? 0;
        const data1 = event.data[1] ?? 0;
        const data2 = event.data[2] ?? 0;
        const command = status & 0xf0;

        if (command === NOTE_ON && data2 > 0) {
            scene.noteOn(data1, data2, { performance: true });
        } else if (command === NOTE_OFF || (command === NOTE_ON && data2 === 0)) {
            scene.noteOff(data1);
        } else if (command === CONTROL_CHANGE) {
            if (data1 === CC_SUSTAIN) scene.setSustain(data2 >= 64);
            else if (data1 === CC_ALL_SOUND_OFF || data1 === CC_ALL_NOTES_OFF) scene.panic();
        }
    }
}
