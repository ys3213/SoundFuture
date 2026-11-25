"use strict";

const byId = (id) => document.getElementById(id);
const conversation = new Conversation();
const controls = {
  solo: byId("solo"), group: byId("group"), palette: byId("palette"),
  editA: byId("edit-a"), editB: byId("edit-b"), boundary: byId("boundary"),
  enable: byId("enable"), play: byId("play"), stop: byId("stop"), volume: byId("volume"),
};
let context;
let instrument;
let inputs;
let armed = false;
let playing = false;
let activation = 0;
let timer;
let selected = "A";
let frame = -1;
let liveParts = { A: [], B: [], C: [] };
let lastPreview = -Infinity;
let previousInputState = "";

const score = createScore(byId("score"), byId("score-header"), paint, (beat, row) =>
  !conversation[selected][beat].includes(Number(row)),
);

function showMessage(message) {
  const label = byId("audio-message");
  label.textContent = message;
  label.hidden = !message;
}

function paint(beat, row, add) {
  if (selected === "B" && !conversation.isOpen(beat)) {
    showMessage("把交接線往左拖，先讓出這一拍。");
    return;
  }
  if (!conversation.paint(selected, beat, row, add)) return;
  showMessage("");
  if (armed && !playing && add && performance.now() - lastPreview >= 70) {
    instrument.stop();
    instrument.playNotes(selected, notesFor(conversation[selected][beat], conversation.palette, selected), 280);
    lastPreview = performance.now();
  }
  render();
}

async function enableAudio() {
  if (armed) return true;
  const attempt = ++activation;
  showMessage("");
  try {
    if (!context) {
      context = new AudioContext({ latencyHint: "interactive" });
      instrument = createInstrument(context);
      inputs = createInputs(context, byId("video"), renderInputs);
      context.addEventListener("statechange", () => {
        if (armed && context.state !== "running") stop();
      });
    }
    await context.resume();
    if (attempt !== activation || context.state !== "running") return false;
    instrument.volume(Number(controls.volume.value));
    armed = true;
    render();
    return true;
  } catch (error) {
    if (attempt === activation) showMessage("音訊啟用失敗。請用 Chrome 重新整理再試。");
    console.error(error);
    return false;
  }
}

function stopPlayback() {
  clearTimeout(timer);
  playing = false;
  frame = -1;
  liveParts = { A: [], B: [], C: [] };
  instrument?.stop();
}

function stop() {
  activation += 1;
  armed = false;
  stopPlayback();
  inputs?.stop();
  render();
}

function nextBeat() {
  if (!playing) return;
  frame = (frame + 1) % stepsPerRound;
  const { hum, gesture } = inputs.read();
  const palette = conversation.palette;
  liveParts = conversation.partsAt(frame, fitHum(hum, palette), gesture);
  const time = context.currentTime + 0.012;
  for (const [part, rows] of Object.entries(liveParts)) {
    const bridge = part === "A" && frame === conversation.boundary - 1 && conversation.boundary < stepsPerRound;
    const duration = bridge ? 740 : part === "C" ? 410 : 455;
    instrument.playNotes(part, notesFor(rows, palette, part), duration, time);
  }
  render();
  timer = setTimeout(nextBeat, beatMs);
}

function play() {
  if (!armed || playing) return;
  instrument.stop();
  showMessage("");
  playing = true;
  nextBeat();
}

function chooseMode(mode) {
  if (mode === conversation.mode) return;
  stopPlayback();
  conversation.mode = mode;
  if (mode === "solo") {
    selected = "A";
    inputs?.stop();
  }
  showMessage("");
  render();
}

function choosePart(part) {
  selected = part;
  showMessage("");
  render();
}

async function toggleInput(kind) {
  if (conversation.mode !== "group") chooseMode("group");
  if (await enableAudio()) await inputs.toggle(kind);
}

function renderInputs() {
  const reading = inputs?.read();
  const microphone = reading?.microphone;
  const camera = reading?.camera;
  const hum = fitHum(reading?.hum, conversation.palette);
  const hand = reading?.gesture ?? null;
  const values = [
    !!microphone?.stream, !!microphone?.pending, microphone?.message,
    !!camera?.stream, !!camera?.pending, camera?.message, hum, hand, conversation.paletteName,
  ];
  const updateKey = values.join("|");
  if (updateKey === previousInputState) return;
  previousInputState = updateKey;

  byId("mic").textContent = microphone?.stream || microphone?.pending ? "關閉麥克風" : "開啟麥克風";
  byId("cam").textContent = camera?.stream || camera?.pending ? "關閉鏡頭" : "開啟鏡頭";
  byId("hum-hint").textContent = microphone?.message && microphone.message !== "關閉" ?
    microphone.message : "在回應拍子哼住一個音，合成音跟隨音高。";
  byId("cam-hint").textContent = camera?.message && camera.message !== "關閉" ?
    camera.message : "用手進入畫面，往右選高音，移開就留白。";
  byId("mic-reading").textContent = hum === null ? "—" : noteName(notesFor([hum], conversation.palette, "B")[0]);
  byId("cam-reading").textContent = hand === null ? "—" : noteName(notesFor([hand], conversation.palette, "C")[0]);
  byId("camera-view").hidden = !camera?.stream;
  byId("calibrate").hidden = !camera?.stream;
  const zone = byId("camera-zone");
  zone.hidden = hand === null;
  if (hand !== null) zone.style.left = `${8 + hand * 16.8}%`;
}

function render() {
  const solo = conversation.mode === "solo";
  controls.solo.setAttribute("aria-pressed", String(solo));
  controls.group.setAttribute("aria-pressed", String(!solo));
  controls.editA.setAttribute("aria-pressed", String(selected === "A"));
  controls.editB.setAttribute("aria-pressed", String(selected === "B"));
  controls.editB.disabled = solo;
  controls.boundary.value = conversation.boundary;
  byId("split-track").style.setProperty("--split", conversation.boundary);
  byId("score").style.setProperty("--split", conversation.boundary);
  controls.boundary.setAttribute("aria-valuetext", `主句 ${conversation.boundary} 拍，回應 ${stepsPerRound - conversation.boundary} 拍`);
  byId("lead-count").textContent = `主句 ${conversation.boundary} 拍`;
  byId("answer-count").textContent = `回應 ${stepsPerRound - conversation.boundary} 拍`;
  byId("edit-hint").textContent = selected === "A" ?
    "拖過格子畫旋律，同一拍可疊三個音。" : "在交接線右邊畫下一句，同一拍可疊三個音。";
  const message = playing ?
    `第 ${frame + 1} 拍 · ${conversation.isOpen(frame) ? (solo ? "系統接聲" : "共奏回應") : "主句"}` :
    armed ? "可以試音或開始合奏" : "請啟用音訊";
  const relation = byId("relation");
  if (relation.textContent !== message) relation.textContent = message;
  controls.enable.disabled = armed;
  controls.enable.textContent = armed ? "音訊已啟用" : "啟用音訊";
  controls.play.disabled = !armed || playing;
  controls.stop.disabled = !armed;
  score.render(conversation, selected, frame, liveParts);
  renderInputs();
}

controls.solo.addEventListener("click", () => chooseMode("solo"));
controls.group.addEventListener("click", () => chooseMode("group"));
controls.palette.addEventListener("change", () => {
  instrument?.stop();
  conversation.paletteName = controls.palette.value;
  render();
});
controls.editA.addEventListener("click", () => choosePart("A"));
controls.editB.addEventListener("click", () => choosePart("B"));
controls.boundary.addEventListener("input", () => {
  conversation.boundary = Number(controls.boundary.value);
  showMessage("");
  render();
});
controls.enable.addEventListener("click", enableAudio);
controls.play.addEventListener("click", play);
controls.stop.addEventListener("click", stop);
controls.volume.addEventListener("input", () => {
  const value = Number(controls.volume.value);
  byId("volume-value").value = value + "%";
  instrument?.volume(value);
});
byId("example").addEventListener("click", () => {
  stopPlayback();
  conversation.loadExample();
  render();
});
byId("reset").addEventListener("click", () => {
  stopPlayback();
  conversation.reset();
  render();
});
byId("mic").addEventListener("click", () => toggleInput("mic"));
byId("cam").addEventListener("click", () => toggleInput("cam"));
byId("calibrate").addEventListener("click", () => {
  if (!inputs?.calibrate()) showMessage("等鏡頭有畫面，再重新校準。");
  else showMessage("");
});
window.addEventListener("blur", () => {
  const media = inputs?.read();
  if (media?.microphone.pending || media?.camera.pending) {
    // A browser permission prompt can briefly take focus away from the page.
    stopPlayback();
    render();
  } else {
    stop();
  }
});
window.addEventListener("pagehide", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
document.addEventListener("keydown", (event) => {
  if (event.code === "Escape") stop();
});

render();
