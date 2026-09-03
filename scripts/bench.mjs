/**
 * Стенд воспроизведения: Chrome без аппаратного ускорения и с замедлением
 * процессора. Телевизор рисует холст программно и считает медленно — здесь
 * то же самое, только цикл обратной связи не через комнату, а секунды.
 *
 * Пример:
 *   node scripts/bench.mjs --url http://localhost:5180 --cpu 6 \
 *     "quality=low" "quality=low&off=notes.rising"
 */
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;

function parseArgs(argv) {
    const options = { url: "http://localhost:5180", cpu: 6, seconds: 6, gpu: false, shot: "", cases: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--url") options.url = argv[++i];
        else if (arg === "--cpu") options.cpu = Number(argv[++i]);
        else if (arg === "--seconds") options.seconds = Number(argv[++i]);
        else if (arg === "--gpu") options.gpu = true;
        else if (arg === "--shot") options.shot = argv[++i];
        else options.cases.push(arg);
    }
    if (options.cases.length === 0) options.cases.push("quality=low");
    return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Короткое имя опыта: код патча в таблице нечитаем. */
function label(spec) {
    const cut = spec.indexOf("|");
    if (cut < 0) return spec.trim();
    return `${spec.slice(0, cut).trim()} + патч`;
}

/** Минимальный клиент протокола отладки: отправить команду, дождаться ответа. */
class Session {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            const waiter = this.pending.get(message.id);
            if (!waiter) return;
            this.pending.delete(message.id);
            if (message.error) waiter.reject(new Error(message.error.message));
            else waiter.resolve(message.result);
        });
    }

    static async open(wsUrl) {
        const socket = new WebSocket(wsUrl);
        await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, { once: true });
            socket.addEventListener("error", () => reject(new Error("Не удалось подключиться к Chrome")), {
                once: true
            });
        });
        return new Session(socket);
    }

    send(method, params = {}) {
        const id = this.nextId++;
        this.socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    async evaluate(expression) {
        const result = await this.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (result.exceptionDetails) {
            const details = result.exceptionDetails;
            const reason = details.exception?.description ?? details.exception?.value ?? details.text;
            throw new Error(String(reason));
        }
        return result.result.value;
    }

    close() {
        this.socket.close();
    }
}

async function waitForDevTools() {
    for (let i = 0; i < 100; i++) {
        try {
            const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            if (response.ok) return await response.json();
        } catch {
            // Chrome ещё поднимается.
        }
        await sleep(200);
    }
    throw new Error("Chrome не открыл порт отладки");
}

async function pageTarget() {
    for (let i = 0; i < 50; i++) {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (page) return page;
        await sleep(200);
    }
    throw new Error("Не нашлась вкладка");
}

/** Плотная игра: сцену надо чем-то нагрузить, иначе мерить нечего. */
const PLAY = `
(() => {
  const s = window.visualizer.scene;
  window.visualizer.removeInput("input.demo");
  s.panic();
  let i = 0;
  clearInterval(window.__benchTimer);
  window.__benchTimer = setInterval(() => {
    const midi = 36 + (i * 7) % 52;
    s.noteOn(midi, 100);
    if (i % 2 === 0) setTimeout(() => s.noteOff(midi), 800);
    i++;
  }, 45);
  return "ok";
})()`;

const COLLECT = `
(() => {
  const v = window.visualizer;
  clearInterval(window.__benchTimer);
  return {
    fps: +v.quality.fps.toFixed(1),
    work: +v.quality.work.toFixed(2),
    level: v.quality.level,
    canvas: v.canvas.width + "×" + v.canvas.height,
    rows: v.profiler.rows().map(r => [r.label, +r.ms.toFixed(2)])
  };
})()`;

/** Снимок сцены: глазами проверить, во что обошлась экономия. */
async function shoot(session, path) {
    const { data } = await session.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(data, "base64"));
    console.log(`   снимок: ${path}`);
}

async function runCase(session, url, spec, seconds) {
    // «запрос | код» — код выполняется на готовой сцене. Так можно отключить
    // отдельную фазу слоя, не заводя ради опыта настройку в самом приложении.
    // Делим по первому разделителю: сам код почти наверняка содержит «|».
    const cut = spec.indexOf("|");
    const query = (cut < 0 ? spec : spec.slice(0, cut)).trim();
    const patch = cut < 0 ? "" : spec.slice(cut + 1).trim();
    const full = `${url}/?profile=1&${query}`;
    await session.send("Page.navigate", { url: full });
    await sleep(2500);
    if (patch) await session.evaluate(`(() => { const v = window.visualizer; ${patch}; return "ok"; })()`);
    await session.evaluate(PLAY);
    await sleep(seconds * 1000);
    return await session.evaluate(COLLECT);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const profileDir = await mkdtemp(join(tmpdir(), "piano-bench-"));

    const flags = [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,720",
        "about:blank"
    ];
    if (!options.gpu) {
        // Тот самый режим, в котором живёт слабый телевизор: холст растеризует
        // процессор, композиция тоже на нём.
        flags.unshift("--disable-gpu", "--disable-gpu-compositing", "--disable-accelerated-2d-canvas");
    }

    const chrome = spawn(CHROME, flags, { stdio: "ignore" });
    let session;
    try {
        await waitForDevTools();
        const page = await pageTarget();
        session = await Session.open(page.webSocketDebuggerUrl);
        await session.send("Page.enable");
        await session.send("Runtime.enable");
        if (options.cpu > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: options.cpu });

        console.log(
            `Ускорение: ${options.gpu ? "аппаратное" : "выключено"}, процессор замедлен в ${options.cpu}×`
        );
        const results = [];
        for (const spec of options.cases) {
            const result = await runCase(session, options.url, spec, options.seconds);
            const query = spec;
            results.push({ query, result, label: label(query) });
            console.log(`\n── ${label(query)}`);
            console.log(
                `   ${result.fps} к/с · ${result.work} мс · ${result.level} · холст ${result.canvas}`
            );
            for (const [label, ms] of result.rows.slice(0, 6)) console.log(`   ${label.padEnd(20)} ${ms} мс`);
            if (options.shot) await shoot(session, options.shot.replace("%", String(results.length)));
        }

        if (results.length > 1) {
            console.log("\n── сравнение по кадрам в секунду");
            const base = results[0];
            for (const item of results) {
                const delta =
                    item === base
                        ? ""
                        : ` (${item.result.fps - base.result.fps > 0 ? "+" : ""}${(item.result.fps - base.result.fps).toFixed(1)})`;
                console.log(`   ${String(item.result.fps).padStart(6)}${delta.padEnd(10)}  ${item.label}`);
            }
        }
    } finally {
        session?.close();
        chrome.kill();
        // Chrome дописывает профиль ещё пару мгновений после сигнала.
        await sleep(700);
        await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
