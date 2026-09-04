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
    const options = {
        url: "http://localhost:5180",
        cpu: 6,
        seconds: 6,
        gpu: false,
        softCanvas: false,
        shot: "",
        browser: "chrome",
        prefs: [],
        cases: []
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--url") options.url = argv[++i];
        else if (arg === "--cpu") options.cpu = Number(argv[++i]);
        else if (arg === "--seconds") options.seconds = Number(argv[++i]);
        else if (arg === "--gpu") options.gpu = true;
        else if (arg === "--soft-canvas") options.softCanvas = true;
        else if (arg === "--shot") options.shot = argv[++i];
        else if (arg === "--firefox") options.browser = "firefox";
        else if (arg === "--pref") options.prefs.push(argv[++i]);
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

    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        this.socket.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    /**
     * Замедлить процессор страницы. Рабочий поток так не замедлить: протокол
     * отвечает «только для страниц», — поэтому сцену, которую рисует он,
     * меряют без замедления, а слабую машину изображают отключённым
     * ускорением холста.
     */
    async throttle(rate) {
        await this.send("Emulation.setCPUThrottlingRate", { rate });
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

    async navigate(url) {
        await this.send("Page.navigate", { url });
    }

    /**
     * Настоящий щелчок мышью. Без жеста браузер держит звук запертым, а
     * первое касание — как раз тот случай, ради которого всё и меряется:
     * тогда грузится и разбирается банк сэмплов.
     */
    async gesture() {
        for (const type of ["mousePressed", "mouseReleased"]) {
            await this.send("Input.dispatchMouseEvent", {
                type,
                x: 20,
                y: 20,
                button: "left",
                clickCount: 1
            });
        }
    }

    async screenshot() {
        const { data } = await this.send("Page.captureScreenshot", { format: "png" });
        return data;
    }

    close() {
        this.socket.close();
    }
}

const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";

/**
 * Firefox говорит на WebDriver BiDi, а не на протоколе Chrome. Команды те же
 * по смыслу: открыть страницу и выполнить на ней выражение, — поэтому наружу
 * оба драйвера отдают одинаковую пару методов.
 */
class BidiSession {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            const waiter = this.pending.get(message.id);
            if (!waiter) return;
            this.pending.delete(message.id);
            if (message.type === "error") waiter.reject(new Error(message.message));
            else waiter.resolve(message.result);
        });
    }

    static async open(port) {
        for (let i = 0; i < 100; i++) {
            try {
                const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
                await new Promise((resolve, reject) => {
                    socket.addEventListener("open", resolve, { once: true });
                    socket.addEventListener("error", reject, { once: true });
                });
                return new BidiSession(socket);
            } catch {
                await sleep(200);
            }
        }
        throw new Error("Firefox не открыл порт BiDi");
    }

    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        this.socket.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }

    async start() {
        await this.send("session.new", { capabilities: { alwaysMatch: {} } });
        const tree = await this.send("browsingContext.getTree", {});
        this.context = tree.contexts[0].context;
    }

    async navigate(url) {
        await this.send("browsingContext.navigate", { context: this.context, url, wait: "complete" });
    }

    async gesture() {
        // BiDi умеет ввод, но для этого замера хватает протокола Chrome.
    }

    async evaluate(expression) {
        const result = await this.send("script.evaluate", {
            expression,
            target: { context: this.context },
            awaitPromise: true
        });
        if (result.type === "exception")
            throw new Error(result.exceptionDetails?.text ?? "ошибка в странице");
        return result.result?.value;
    }

    async screenshot() {
        const { data } = await this.send("browsingContext.captureScreenshot", { context: this.context });
        return data;
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
  window.__frames = [];
  window.__last = 0;
  // Длинные задачи — это и есть блокировки главного потока: разбор банка
  // сэмплов, сборка мусора, всё, что рвёт ход кадров.
  window.__long = [];
  try {
    window.__obs?.disconnect();
    window.__obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration));
    });
    window.__obs.observe({ entryTypes: ["longtask"] });
  } catch {}
  const tick = (t) => {
    if (window.__last) window.__frames.push(t - window.__last);
    window.__last = t;
    window.__raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(window.__raf);
  window.__raf = requestAnimationFrame(tick);
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
JSON.stringify((() => {
  const v = window.visualizer;
  clearInterval(window.__benchTimer);
  cancelAnimationFrame(window.__raf);
  const f = (window.__frames || []).slice().sort((a, b) => a - b);
  const at = (q) => f.length ? +f[Math.min(f.length - 1, Math.floor(f.length * q))].toFixed(1) : 0;
  const sampler = window.sampler || {};
  // Сцену рисует рабочий поток: кадры считает он, а не наш requestAnimationFrame —
  // главный поток теперь свободен и отсчитывает ровные 60 независимо от картинки.
  const remote = window.renderer ? window.renderer.stats() : null;
  return {
    sound: {
      context: sampler.ctx ? sampler.ctx.state : "нет",
      banks: sampler.banks ? sampler.banks.size : -1
    },
    probe: window.__probe || null,
    long: (window.__long || []).slice().sort((a, b) => b - a).slice(0, 5),
    worst: remote ? +remote.worst.toFixed(1) : at(0.99),
    p95: remote ? 0 : at(0.95),
    stalls: remote ? remote.stalls : f.filter((ms) => ms > 32).length,
    fps: +(remote ? remote.fps : v.quality.fps).toFixed(1),
    work: +(remote ? remote.work : v.quality.work).toFixed(2),
    level: remote ? remote.title : v.quality.level,
    canvas: remote ? remote.width + "×" + remote.height : v.canvas.width + "×" + v.canvas.height,
    rows: remote
      ? remote.rows.map(([label, ms]) => [label, +ms.toFixed(2)])
      : v.profiler.rows().map(r => [r.label, +r.ms.toFixed(2)])
  };
})())`;

/** Снимок сцены: глазами проверить, во что обошлась экономия. */
async function shoot(session, path) {
    const data = await session.screenshot();
    await writeFile(path, Buffer.from(data, "base64"));
    console.log(`   снимок: ${path}`);
}

async function runCase(session, url, spec, seconds, cpu = 1) {
    // «запрос | код» — код выполняется на готовой сцене. Так можно отключить
    // отдельную фазу слоя, не заводя ради опыта настройку в самом приложении.
    // Делим по первому разделителю: сам код почти наверняка содержит «|».
    const cut = spec.indexOf("|");
    const query = (cut < 0 ? spec : spec.slice(0, cut)).trim();
    const patch = cut < 0 ? "" : spec.slice(cut + 1).trim();
    const full = `${url}/?profile=1&${query}`;
    await session.navigate(full);
    await sleep(2500);
    if (cpu > 1) await session.throttle(cpu);
    // Патч раньше жеста: иначе звук успеет проснуться до того, как опыт
    // что-либо изменит, и мерить будет нечего.
    if (patch) await session.evaluate(`(() => { const v = window.visualizer; ${patch}; return "ok"; })()`);
    await session.gesture();
    await session.evaluate(PLAY);
    // Где рисуется сцена, видно только со страницы — и это меняет смысл цифр:
    // замедление процессора рабочего потока не касается.
    const inWorker = Boolean(await session.evaluate("Boolean(window.renderer)"));
    await sleep(seconds * 1000);
    return { ...JSON.parse(await session.evaluate(COLLECT)), inWorker };
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
    if (options.softCanvas) {
        // Середина между двумя крайностями, и она же — обычный телевизор: холст
        // растеризует процессор, а складывает слои на экране всё-таки видеочип.
        // Разница видна там, где работу можно отдать композитору.
        flags.unshift("--disable-accelerated-2d-canvas");
    } else if (!options.gpu) {
        // Тот самый режим, в котором живёт слабый телевизор: холст растеризует
        // процессор, композиция тоже на нём.
        flags.unshift("--disable-gpu", "--disable-gpu-compositing", "--disable-accelerated-2d-canvas");
    }

    const firefox = options.browser === "firefox";
    if (firefox && options.prefs.length > 0) {
        // Настройки движка кладём в свежий профиль: так видно, дело в самой
        // сцене или в том, чем браузер её рисует.
        const lines = options.prefs.map((pref) => {
            const [name, value] = pref.split("=");
            return `user_pref("${name}", ${value});`;
        });
        await writeFile(join(profileDir, "user.js"), lines.join("\n") + "\n");
    }
    const firefoxFlags = [
        "--remote-debugging-port",
        String(PORT),
        "--profile",
        profileDir,
        "--no-remote",
        "--width=1280",
        "--height=720",
        "about:blank"
    ];
    const browser = spawn(firefox ? FIREFOX : CHROME, firefox ? firefoxFlags : flags, { stdio: "ignore" });

    let session;
    try {
        if (firefox) {
            session = await BidiSession.open(PORT);
            await session.start();
        } else {
            await waitForDevTools();
            const page = await pageTarget();
            session = await Session.open(page.webSocketDebuggerUrl);
            await session.send("Page.enable");
            await session.send("Runtime.enable");
            // Без этого первый сценарий грузит звук по сети, а следующие берут
            // его из кэша — и разница между опытами оказывается разницей между
            // холодным и тёплым запуском, а не тем, что мы меряем.
            await session.send("Network.enable");
            await session.send("Network.setCacheDisabled", { cacheDisabled: true });
        }

        // Замедлять процессор умеет только протокол Chrome; в Firefox сравниваем
        // как есть — там вопрос к самому движку, а не к слабой машине.
        const slowdown = firefox ? "" : `, процессор замедлен в ${options.cpu}×`;
        const accel =
            options.gpu || firefox
                ? "аппаратное"
                : options.softCanvas
                  ? "только композиция, холст на процессоре"
                  : "выключено";
        console.log(`${firefox ? "Firefox" : "Chrome"}: ускорение ${accel}${slowdown}`);
        const results = [];
        for (const spec of options.cases) {
            const result = await runCase(
                session,
                options.url,
                spec,
                options.seconds,
                firefox ? 1 : options.cpu
            );
            const query = spec;
            results.push({ query, result, label: label(query) });
            console.log(`\n── ${label(query)}`);
            console.log(
                `   ${result.fps} к/с · ${result.work} мс · ${result.level} · холст ${result.canvas}`
            );
            if (result.inWorker) {
                // Замедлять рабочий поток протокол не умеет: «только для
                // страниц». Молчать об этом нельзя — иначе цифры примут за
                // слабую машину, а это полная скорость.
                const slow = !firefox && options.cpu > 1 ? " · замедление его не касается" : "";
                console.log(`   сцену рисует рабочий поток${slow}`);
            }
            console.log(
                `   худший кадр ${result.worst} мс · 95% ниже ${result.p95} мс · рывков ${result.stalls}`
            );
            console.log(
                `   звук: ${result.sound.context}, банков ${result.sound.banks} · долгие задачи ${result.long.join(", ") || "нет"}`
            );
            if (result.probe) console.log(`   замер: ${JSON.stringify(result.probe)}`);
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
        browser.kill();
        // Chrome дописывает профиль ещё пару мгновений после сигнала.
        await sleep(700);
        await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
