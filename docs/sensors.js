"use strict";

// Downsample the microphone waveform and compare its repeating patterns.
function estimatePitch(wave, rate, floor = 0.014) {
  const stride = Math.max(1, Math.round(rate / 12000));
  const sampleRate = rate / stride;
  const samples = new Float32Array(Math.floor(wave.length / stride));
  let mean = 0;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = wave[i * stride];
    mean += samples[i];
  }
  mean /= samples.length;
  let power = 0;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] -= mean;
    power += samples[i] ** 2;
  }
  if (Math.sqrt(power / samples.length) < floor) return null;

  const shortest = Math.floor(sampleRate / 700);
  const longest = Math.ceil(sampleRate / 85);
  const correlations = new Float32Array(longest + 2);
  for (let lag = shortest - 1; lag <= longest + 1; lag += 1) {
    let cross = 0;
    let reference = 0;
    let shifted = 0;
    for (let i = 0; i < samples.length - longest - 1; i += 1) {
      cross += samples[i] * samples[i + lag];
      reference += samples[i] ** 2;
      shifted += samples[i + lag] ** 2;
    }
    correlations[lag] = cross / Math.sqrt(reference * shifted);
  }
  const threshold = Math.max(0.83, Math.max(...correlations) * 0.91);
  for (let lag = shortest; lag <= longest; lag += 1) {
    const peak = correlations[lag];
    if (peak < threshold || peak < correlations[lag - 1] || peak <= correlations[lag + 1]) continue;
    const slope = correlations[lag - 1] - correlations[lag + 1];
    const curvature = correlations[lag - 1] - 2 * peak + correlations[lag + 1];
    const adjustment = curvature ? 0.5 * slope / curvature : 0;
    return sampleRate / (lag + adjustment);
  }
  return null;
}

function grayFrame(rgba) {
  const pixels = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const offset = i * 4;
    pixels[i] = (rgba[offset] * 2 + rgba[offset + 1] * 5 + rgba[offset + 2]) >> 3;
  }
  return pixels;
}

// An empty view provides a reference. Broad changes such as a light switch are discarded.
function handPosition(reference, frame, width, height) {
  if (!reference) return null;
  const left = Math.floor(width * 0.08);
  const right = Math.ceil(width * 0.92);
  const top = Math.floor(height * 0.12);
  const bottom = Math.ceil(height * 0.88);

  let delta = 0;
  for (let i = 0; i < frame.length; i += 1) delta += frame[i] - reference[i];
  delta /= frame.length;

  let changed = 0;
  let weight = 0;
  let atX = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = y * width + x;
      const difference = Math.abs(frame[index] - reference[index] - delta);
      if (difference < 28) continue;
      changed += 1;
      weight += difference;
      atX += x * difference;
    }
  }
  const area = (bottom - top) * (right - left);
  if (changed < area * 0.018 || changed > area * 0.46) return null;
  return Math.max(0, Math.min(0.999, (atX / weight - left) / (right - left)));
}

function createInputs(context, video, onChange) {
  const microphone = { request: 0 };
  const camera = { request: 0 };
  const width = 64;
  const height = 40;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const frames = canvas.getContext("2d", { willReadFrequently: true });
  let hum = null;
  let gesture = null;

  function setReadings(nextHum, nextGesture) {
    hum = nextHum;
    gesture = nextGesture;
    onChange();
  }

  function end(kind, message = "關閉") {
    const device = kind === "mic" ? microphone : camera;
    device.request += 1;
    device.stream?.getTracks().forEach((track) => track.stop());
    clearInterval(device.timer);
    device.source?.disconnect();
    device.analyser?.disconnect();
    Object.assign(device, { stream: null, timer: null, source: null, analyser: null, pending: false, message });
    if (kind === "mic") {
      device.candidate = null;
      device.stable = 0;
      setReadings(null, gesture);
    } else {
      video.srcObject = null;
      device.reference = null;
      device.candidate = null;
      device.stable = 0;
      setReadings(hum, null);
    }
  }

  function snapshot() {
    if (video.readyState < 2) return null;
    // Mirror the image so moving right on the display selects a higher pitch.
    frames.setTransform(-1, 0, 0, 1, width, 0);
    frames.drawImage(video, 0, 0, width, height);
    return grayFrame(frames.getImageData(0, 0, width, height).data);
  }

  function calibrate() {
    const reference = snapshot();
    if (!reference) return false;
    camera.reference = reference;
    camera.candidate = null;
    camera.stable = 0;
    camera.message = "手移進畫面，左右選音";
    setReadings(hum, null);
    return true;
  }

  async function toggle(kind) {
    const isMic = kind === "mic";
    const device = isMic ? microphone : camera;
    if (device.stream || device.pending) {
      end(kind);
      return;
    }

    const request = ++device.request;
    device.pending = true;
    device.message = "等待授權";
    onChange();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("SECURE_CONTEXT");
      const stream = await navigator.mediaDevices.getUserMedia(isMic ? {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      } : { video: { width: { ideal: 400 }, height: { ideal: 250 } } });
      if (device.request !== request) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      device.stream = stream;
      device.pending = false;
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => {
        if (device.request === request) end(kind, "裝置中斷");
      }));

      if (isMic) {
        device.source = context.createMediaStreamSource(stream);
        device.analyser = context.createAnalyser();
        device.analyser.fftSize = 4096;
        device.source.connect(device.analyser);
        const wave = new Float32Array(device.analyser.fftSize);
        device.message = "持續哼一個音";
        device.timer = setInterval(() => {
          device.analyser.getFloatTimeDomainData(wave);
          const hz = estimatePitch(wave, context.sampleRate);
          if (hz && device.candidate && Math.abs(12 * Math.log2(hz / device.candidate)) < 0.75) {
            device.stable += 1;
          } else {
            device.stable = 0;
          }
          device.candidate = hz;
          setReadings(device.stable >= 1 ? hz : null, gesture);
        }, 70);
      } else {
        video.srcObject = stream;
        await video.play();
        if (device.request !== request) return;
        device.message = "請先清空畫面，再校準";
        device.timer = setInterval(() => {
          if (!device.reference) return;
          const frame = snapshot();
          if (!frame) return;
          const position = handPosition(device.reference, frame, width, height);
          const row = position === null ? null : Math.floor(position * 5);
          device.stable = row === device.candidate ? device.stable + 1 : 0;
          device.candidate = row;
          if (row === null || device.stable >= 1) setReadings(hum, row);
        }, 80);
      }
      onChange();
    } catch (error) {
      if (device.request !== request) return;
      const reason = error.message === "SECURE_CONTEXT" ? "請用 localhost 或 HTTPS 開啟" :
        error.name === "NotAllowedError" ? "權限未開啟，可繼續用畫譜" : "裝置無法啟用，可繼續用畫譜";
      end(kind, reason);
    }
  }

  return {
    toggle, calibrate,
    stop() { end("mic"); end("cam"); },
    read() { return { hum, gesture, microphone, camera }; },
  };
}
