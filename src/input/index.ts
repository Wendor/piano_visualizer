import { inputRegistry } from "../core/registry";
import { ComputerKeyboardInput } from "./ComputerKeyboardInput";
import { DemoPlayer } from "./DemoPlayer";
import { MidiInput } from "./MidiInput";
import { PointerInput } from "./PointerInput";

export { ComputerKeyboardInput, DemoPlayer, MidiInput, PointerInput };
export type { InputSource } from "./types";
export type { MidiStatus } from "./MidiInput";

let registered = false;

export function registerBuiltinInputs(): void {
    if (registered) return;
    registered = true;

    inputRegistry
        .register("input.midi", () => new MidiInput())
        .register("input.computerKeyboard", (_c, o) => new ComputerKeyboardInput(o as never))
        .register("input.pointer", (c, o) => new PointerInput(c.canvas, (o?.["velocity"] as number) ?? 100))
        .register("input.demo", (_c, o) => new DemoPlayer(o as never));
}
