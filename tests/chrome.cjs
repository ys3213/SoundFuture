"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");

const root = path.resolve(__dirname, "..");
const docs = path.join(root, "docs");
const output = path.join(root, "output/playwright");
const screenshot = path.join(output, "讓聲_共奏樂譜.png");

async function createServer() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = http.createServer(async (request, response) => {
    const name = request.url === "/" ? "index.html" : request.url.slice(1);
    const mime = types[path.extname(name)];
    if (path.basename(name) !== name || !mime) {
      response.writeHead(404).end();
      return;
    }
    try {
      const data = await fs.readFile(path.join(docs, name));
      response.writeHead(200, { "Content-Type": mime + "; charset=utf-8" }).end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function observeLiveMix(context) {
  await context.addInitScript(() => {
    // Capture the actual signal entering the page's output bus.
    const original = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, ...ports) {
      const result = original.call(this, target, ...ports);
      if (target === this.context.destination && this.context instanceof AudioContext) {
        const meter = this.context.createAnalyser();
        meter.fftSize = 1024;
        original.call(this, meter);
        window.readTestPeak = () => {
          const samples = new Float32Array(meter.fftSize);
          meter.getFloatTimeDomainData(samples);
          return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
        };
      }
      return result;
    };
  });
}

function label(page, text) {
  return page.waitForFunction((value) => document.querySelector("#relation").textContent === value, text);
}

function livePeak(page, audible) {
  return page.waitForFunction((shouldSound) => {
    const peak = window.readTestPeak?.();
    return shouldSound ? peak > 0.01 : peak < 0.0001;
  }, audible);
}


async function activate(page) {
  await page.locator("#enable").click();
  await label(page, "可以試音或開始合奏");
}

function cell(page, beat, row) {
  return page.locator(`.cell[data-beat="${beat}"][data-row="${row}"]`);
}

async function waitForText(page, selector, value) {
  await page.waitForFunction(
    ([id, text]) => document.querySelector(id).textContent === text, [selector, value],
  );
}

async function installTestMedia(context) {
  await context.addInitScript(() => {
    let signal;
    let oscillator;
    let videoCanvas;
    const streams = [];

    async function getUserMedia(constraints) {
      let stream;
      if (constraints.audio) {
        signal = new AudioContext();
        oscillator = signal.createOscillator();
        const level = signal.createGain();
        const sink = signal.createMediaStreamDestination();
        oscillator.frequency.value = 293.66;
        level.gain.value = 0.12;
        oscillator.connect(level).connect(sink);
        oscillator.start();
        await signal.resume();
        stream = sink.stream;
      } else {
        videoCanvas = document.createElement("canvas");
        videoCanvas.width = 400;
        videoCanvas.height = 250;
        const draw = videoCanvas.getContext("2d");
        window.testHand = (center) => {
          draw.fillStyle = "#bcb8b2";
          draw.fillRect(0, 0, 400, 250);
          if (center !== null) {
            draw.fillStyle = "#403838";
            draw.fillRect(center - 33, 85, 66, 90);
          }
        };
        window.testHand(null);
        stream = videoCanvas.captureStream(30);
      }
      streams.push(stream);
      return stream;
    }

    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: getUserMedia });
    window.testHum = (hz) => { oscillator.frequency.value = hz; };
    window.testTrackStates = () => streams.flatMap((stream) => stream.getTracks().map((track) => track.readyState));
  });
}

async function verifyAudioGraph(page) {
  const result = await page.evaluate(async () => {
    const rate = 48000;
    const ctx = new OfflineAudioContext(1, rate * 3, rate);
    const synth = createInstrument(ctx);
    synth.volume(100, 0);
    synth.playNotes("A", [62, 65, 69], 650, 0.2);
    synth.playNotes("B", [50, 57], 530, 0.4);
    synth.playNotes("C", [84], 410, 0.4);
    synth.stop(0.82);
    synth.playNotes("A", [60, 64, 67], 400, 1.25);
    synth.volume(25, 2);
    synth.playNotes("A", [60, 64, 67], 400, 2.25);
    const audio = (await ctx.startRendering()).getChannelData(0);

    function slice(from, to) {
      return audio.subarray(Math.round(from * rate), Math.round(to * rate));
    }

    function peak(values) {
      return values.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    }

    function power(note, from, to) {
      const samples = slice(from, to);
      const omega = 2 * Math.PI * midiToHz(note) / rate;
      let cosine = 0, sine = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (samples.length - 1));
        cosine += samples[i] * hann * Math.cos(omega * i);
        sine += samples[i] * hann * Math.sin(omega * i);
      }
      return Math.hypot(cosine, sine) / samples.length;
    }

    return {
      blend: [50, 57, 62, 65, 69, 84].map((pitch) => [noteName(pitch), power(pitch, 0.47, 0.79)]),
      newChord: [60, 64, 67].map((pitch) => [noteName(pitch), power(pitch, 1.35, 1.58)]),
      quietBeforeStart: peak(slice(0, 0.19)),
      quietAfterStop: peak(slice(0.86, 1.24)),
      maximum: peak(audio),
      quarterVolume: power(60, 2.35, 2.58) / power(60, 1.35, 1.58),
    };
  });
  assert.ok(result.blend.every(([, value]) => value > 0.002));
  assert.ok(result.newChord.every(([, value]) => value > 0.003));
  assert.equal(result.quietBeforeStart, 0);
  assert.equal(result.quietAfterStop, 0);
  assert.ok(result.maximum < 0.5);
  assert.ok(Math.abs(result.quarterVolume - 0.25) < 0.02);
  return result;
}

async function run() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const server = await createServer();
  const results = { browser: await browser.version(), checks: [] };
  const url = `http://127.0.0.1:${server.address().port}/`;

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 750 }, deviceScaleFactor: 2 });
    await observeLiveMix(context);
    const page = await context.newPage();
    const issues = [];
    page.on("pageerror", (error) => issues.push(String(error)));
    page.on("console", (event) => { if (event.type() === "error") issues.push(event.text()); });
    await page.goto(url);
    await label(page, "請啟用音訊");
    await activate(page);
    await livePeak(page, false);
    assert.equal(await page.locator("#volume-value").textContent(), "40%");
    await page.locator("#reset").click();
    await cell(page, 0, 0).click();
    await livePeak(page, true);
    await cell(page, 0, 1).click();
    await cell(page, 0, 3).click();
    await cell(page, 0, 4).click();
    assert.equal(await page.locator('.has-a[data-beat="0"]').count(), 3);
    await cell(page, 0, 0).click();
    await cell(page, 0, 4).click();
    assert.equal(await cell(page, 0, 4).getAttribute("aria-pressed"), "true");
    results.checks.push("首次啟用、畫入可選三音、擦除換音與立即合成試音");

    const start = await cell(page, 1, 2).boundingBox();
    const finish = await cell(page, 3, 2).boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(finish.x + finish.width / 2, finish.y + finish.height / 2, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.locator('.has-a[data-row="2"]').count(), 3);

    const track = await page.locator("#split-track").boundingBox();
    await page.mouse.move(track.x + track.width * 5 / 8, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 2 / 8, track.y + track.height / 2, { steps: 8 });
    await page.mouse.up();
    await waitForText(page, "#lead-count", "主句 2 拍");
    await waitForText(page, "#answer-count", "回應 6 拍");
    assert.equal(await page.locator(".ghost-a").count(), 2);
    await page.locator("#play").click();
    await label(page, "第 3 拍 · 系統接聲");
    await livePeak(page, true);
    results.checks.push("實際拖曳畫旋律、拖交接線、保留原音符並擴大系統接話");

    await page.locator("#group").click();
    await livePeak(page, false);
    await page.locator("#edit-b").click();
    await cell(page, 1, 0).click();
    await waitForText(page, "#audio-message", "把交接線往左拖，先讓出這一拍。");
    await cell(page, 2, 2).click();
    await cell(page, 2, 4).click();
    assert.equal(await page.locator('.has-b[data-beat="2"]').count(), 2);
    await page.locator("#palette").selectOption("major");
    assert.equal(await cell(page, 2, 2).getAttribute("aria-label"), "第 3 拍 E3");
    await page.locator("#play").click();
    await label(page, "第 3 拍 · 共奏回應");
    await livePeak(page, true);
    results.checks.push("共奏關閉自動回應、開放拍可畫雙音、換音階改變實際音名");

    await page.locator("#volume").focus();
    await page.keyboard.press("Home");
    await waitForText(page, "#volume-value", "0%");
    await livePeak(page, false);
    await page.keyboard.press("End");
    await waitForText(page, "#volume-value", "100%");
    await livePeak(page, true);
    await page.keyboard.press("Escape");
    await label(page, "請啟用音訊");
    await livePeak(page, false);
    await activate(page);
    await page.locator("#play").click();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await label(page, "請啟用音訊");
    await livePeak(page, false);
    await page.reload();
    assert.equal(await page.locator("#solo").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#volume-value").textContent(), "40%");
    results.checks.push("音量歸零與恢復、Esc、模擬失焦及重載回到初始設定");

    results.signal = await verifyAudioGraph(page);
    results.checks.push("48 kHz 離線量測三個音域、六音同時發聲、換和弦、音量和停止後靜音");
    assert.deepEqual(issues, []);

    await activate(page);
    await page.locator("#group").click();
    await page.locator("#edit-b").click();
    await cell(page, 5, 2).click();
    await cell(page, 5, 4).click();
    await cell(page, 7, 3).click();
    await page.locator("#play").click();
    await label(page, "第 6 拍 · 共奏回應");
    await page.screenshot({ path: screenshot, fullPage: true });

    const media = await browser.newContext({ viewport: { width: 1280, height: 750 } });
    await installTestMedia(media);
    await observeLiveMix(media);
    const live = await media.newPage();
    const mediaIssues = [];
    live.on("pageerror", (error) => mediaIssues.push(String(error)));
    await live.goto(url);
    await live.locator("#mic").click();
    await waitForText(live, "#mic-reading", "D3");
    await live.evaluate(() => window.testHum(440));
    await waitForText(live, "#mic-reading", "A3");
    await live.locator("#cam").click();
    await waitForText(live, "#cam-hint", "請先清空畫面，再校準");
    await live.locator("#calibrate").click();
    await waitForText(live, "#cam-hint", "手移進畫面，左右選音");
    await live.evaluate(() => window.testHand(75));
    await waitForText(live, "#cam-reading", "C6");
    await live.evaluate(() => window.testHand(325));
    await waitForText(live, "#cam-reading", "D5");
    await live.locator("#play").click();
    await label(live, "第 6 拍 · 共奏回應");
    await live.waitForFunction(() => document.querySelector(".has-live-c") && document.querySelector('.has-live-b[data-row="3"]'));
    await livePeak(live, true);
    await live.evaluate(() => window.testHand(null));
    await waitForText(live, "#cam-reading", "—");
    await live.locator("#stop").click();
    await livePeak(live, false);
    await waitForText(live, "#mic-reading", "—");
    assert.deepEqual(await live.evaluate(() => window.testTrackStates()), ["ended", "ended"]);
    assert.deepEqual(mediaIssues, []);
    results.checks.push("合成麥克風、鏡頭測試畫面同時改變拍內合奏，離開手勢留白，停止關閉兩個媒體軌");

    const denied = await browser.newContext();
    await denied.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: () => Promise.reject(new DOMException("test", "NotAllowedError")),
      });
    });
    const backup = await denied.newPage();
    await backup.goto(url);
    await backup.locator("#mic").click();
    await waitForText(backup, "#hum-hint", "權限未開啟，可繼續用畫譜");
    await backup.locator("#solo").click();
    await backup.locator("#play").click();
    await label(backup, "第 1 拍 · 主句");
    results.checks.push("模擬拒絕收音權限，仍可切回單人演奏");

    const offline = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
    await observeLiveMix(offline);
    const local = await offline.newPage();
    const webRequests = [];
    local.on("request", (request) => {
      if (/^https?:/.test(request.url())) webRequests.push(request.url());
    });
    await local.goto(pathToFileURL(path.join(docs, "index.html")).href);
    await activate(local);
    await local.locator("#play").click();
    await livePeak(local, true);
    await label(local, "第 6 拍 · 系統接聲");
    await livePeak(local, true);
    assert.deepEqual(webRequests, []);
    assert.ok(await local.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    results.checks.push("離線 file:// 冷啟動、單人合奏無 HTTP 請求，窄畫面可捲譜面");

    await local.evaluate(() => {
      window.completedBeats = 0;
      new MutationObserver(() => { window.completedBeats += 1; })
        .observe(document.querySelector("#relation"), { childList: true });
    });
    await local.waitForFunction(() => window.completedBeats >= 47, { }, { timeout: 34000 });
    await local.locator("#stop").click();
    await livePeak(local, false);
    results.checks.push("離線循環連續超過 30 秒，停止後回到靜音");

    results.notes = "實體教室鏡頭、現場麥克風與主觀聽感待試奏。";
    await fs.writeFile(path.join(output, "驗證結果.json"), JSON.stringify(results, null, 2) + "\n");
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
