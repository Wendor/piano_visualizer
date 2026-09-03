import { describe, expect, it } from "vitest";
import { isSettingsToggle } from "./Controls";

/** Событие клавиатуры в объёме, который нужен предикату. */
function press(code: string, key: string): Pick<KeyboardEvent, "code" | "key"> {
    return { code, key };
}

describe("isSettingsToggle", () => {
    it("ловит клавишу слева от «1» на ANSI-клавиатуре", () => {
        expect(isSettingsToggle(press("Backquote", "`"))).toBe(true);
    });

    it("ловит клавишу «`» рядом с левым Shift: на ISO она IntlBackslash", () => {
        expect(isSettingsToggle(press("IntlBackslash", "`"))).toBe(true);
    });

    it("ловит «ё» и «§»: раскладка меняет символ, но не назначение клавиши", () => {
        expect(isSettingsToggle(press("Backquote", "ё"))).toBe(true);
        expect(isSettingsToggle(press("Backquote", "§"))).toBe(true);
    });

    it("узнаёт клавишу по символу, когда код неизвестен", () => {
        expect(isSettingsToggle(press("", "~"))).toBe(true);
    });

    it("не путает переключатель с нотами и служебными клавишами", () => {
        expect(isSettingsToggle(press("KeyZ", "z"))).toBe(false);
        expect(isSettingsToggle(press("KeyQ", "q"))).toBe(false);
        expect(isSettingsToggle(press("Space", " "))).toBe(false);
        expect(isSettingsToggle(press("Escape", "Escape"))).toBe(false);
    });
});
