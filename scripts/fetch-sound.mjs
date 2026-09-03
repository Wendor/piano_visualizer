/**
 * Скачивает звуковые таблицы WebAudioFont в `public/sound/`, чтобы визуализатор
 * играл без интернета. Аргументы — номера инструментов General MIDI.
 *
 *   npm run sound:fetch            # рояль
 *   npm run sound:fetch -- 0 4 48  # рояль, электропиано, струнные
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://surikov.github.io/webaudiofontdata/sound/";
const BANK = "FluidR3_GM_sf2_file";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sound");

const programs = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (programs.length === 0) programs.push(0);

await mkdir(out, { recursive: true });
for (const program of programs) {
    const name = `${String(program * 10).padStart(4, "0")}_${BANK}`;
    const response = await fetch(`${BASE}${name}.js`);
    if (!response.ok) {
        console.error(`${name}: ${response.status}`);
        continue;
    }
    const text = await response.text();
    await writeFile(join(out, `${name}.js`), text);
    console.log(`${name}.js — ${(text.length / 1024).toFixed(0)} КБ`);
}
