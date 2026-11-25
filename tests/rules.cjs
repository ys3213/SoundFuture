"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = ["rules.js", "sensors.js"].map((name) => fs.readFileSync(path.join(__dirname, "../docs", name), "utf8")).join("\n");
const { Conversation, fitHum, notesFor, palettes, estimatePitch, handPosition } = vm.runInNewContext(
  source + "\n({ Conversation, fitHum, notesFor, palettes, estimatePitch, handPosition })",
);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("每拍可選三個明確音高，第四音拒絕，擦掉後可改音", () => {
  const score = new Conversation();
  score.reset();
  for (const id of [0, 1, 3]) assert.equal(score.paint("A", 0, id, true), true);
  assert.equal(score.paint("A", 0, 4, true), false);
  assert.deepEqual(plain(notesFor(score.A[0], score.palette, "A")), [62, 65, 69]);
  score.paint("A", 0, 0, false);
  score.paint("A", 0, 4, true);
  assert.deepEqual(plain(notesFor(score.A[0], score.palette, "A")), [65, 69, 72]);
});

test("交接線改變可播放分區，暫存主句音，允許完整留白", () => {
  const score = new Conversation();
  assert.deepEqual(plain(score.partsAt(4).A), [3]);
  score.boundary = 4;
  assert.deepEqual(plain(score.partsAt(4).A), []);
  assert.ok(score.partsAt(4).B.length > 0);
  assert.deepEqual(plain(score.A[4]), [3]);
  assert.equal(score.paint("B", 3, 4, true), false);
  assert.equal(score.paint("B", 4, 4, true), true);
  score.boundary = 0;
  assert.deepEqual(plain(score.partsAt(0)), { A: [], B: [], C: [] });
  score.boundary = 8;
  assert.deepEqual(plain(score.partsAt(7)), { A: [0], B: [], C: [] });
});

test("系統接聲依前句與空拍改變，配音避開同音域的二度", () => {
  const score = new Conversation();
  assert.deepEqual(plain(score.reply(7)), []);
  assert.deepEqual(plain(score.reply(5)), [1, 3]);
  score.paint("A", 4, 3, false);
  score.paint("A", 4, 0, true);
  const result = notesFor(score.reply(5), score.palette, "B");
  assert.ok(result.includes(50));
  assert.ok(Math.abs(result[0] - result[1]) >= 3);
});

test("共奏可同拍合成手勢與哼唱，系統接聲交給操作者", () => {
  const score = new Conversation();
  score.mode = "group";
  assert.deepEqual(plain(score.partsAt(2, 4, 1)), { A: [], B: [], C: [] });
  assert.deepEqual(plain(score.partsAt(5)), { A: [], B: [], C: [] });
  assert.deepEqual(plain(score.partsAt(6, 2, 4)), { A: [], B: [2, 0, 1], C: [4] });
  score.paletteName = "major";
  assert.equal(notesFor([2], score.palette, "B")[0], 52);
  assert.equal(notesFor([4], score.palette, "C")[0], 81);
});

test("哼唱估算可跟隨不同頻率和人聲泛音，低音量輸入靜音", () => {
  const rate = 48000;
  for (const frequency of [110, 146.83, 293.66, 440, 589]) {
    const phase = (i) => 2 * Math.PI * frequency * i / rate;
    const wave = Float32Array.from({ length: 4096 },
      (_, i) => 0.12 * Math.sin(phase(i)) + 0.048 * Math.sin(2 * phase(i)) + 0.018 * Math.sin(3 * phase(i)),
    );
    const measured = estimatePitch(wave, rate);
    assert.ok(Math.abs(measured - frequency) < 1.5, `${frequency}: ${measured}`);
  }
  assert.equal(estimatePitch(new Float32Array(4096), rate), null);
  assert.equal(fitHum(293.66, palettes.minor), 0);
  assert.equal(fitHum(440, palettes.minor), 3);
  assert.equal(fitHum(329.63, palettes.major), 2);
});

test("手勢背景差分可分辨左右、離開畫面與整體亮度改變", () => {
  const width = 64;
  const height = 40;
  const base = new Uint8Array(width * height).fill(160);
  function hand(center) {
    const pixels = base.slice();
    for (let y = 15; y < 27; y += 1) {
      for (let x = center - 4; x <= center + 4; x += 1) pixels[y * width + x] = 50;
    }
    return pixels;
  }
  assert.ok(handPosition(base, hand(13), width, height) < 0.2);
  assert.ok(handPosition(base, hand(48), width, height) > 0.75);
  assert.equal(handPosition(base, base, width, height), null);
  assert.equal(handPosition(base, new Uint8Array(width * height).fill(77), width, height), null);
});
