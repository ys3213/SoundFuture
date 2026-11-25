"use strict";

const voiceProfiles = {
  A: { waves: [["triangle", 1, 1]], cutoff: 1600, level: 0.17, attack: 35, decay: 170, sustain: 0.65, release: 180 },
  C: { waves: [["sine", 1, 1], ["triangle", 2, 0.08]], cutoff: 1950, level: 0.105, attack: 48, decay: 135, sustain: 0.46, release: 190 },
  B: { waves: [["sine", 1, 1], ["sine", 2, 0.18]], cutoff: 2200, level: 0.145, attack: 55, decay: 200, sustain: 0.55, release: 220 },
};

function midiToHz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function createRamp(param, initial) {
  param.value = initial;
  let points = [[0, initial]];

  return (time, ...steps) => {
    let [previousTime, value] = points[0];
    // Anchor each edit at its scheduled time, including a ramp after silence.
    for (const [end, target] of points.slice(1)) {
      if (time < end) {
        const progress = Math.max(0, (time - previousTime) / (end - previousTime));
        value += (target - value) * progress;
        break;
      }
      previousTime = end;
      value = target;
    }
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(time);
    else param.cancelScheduledValues(time);
    param.setValueAtTime(value, time);
    points = [[time, value]];
    for (const [offsetMs, target] of steps) {
      const end = time + offsetMs / 1000;
      if (offsetMs === 0) {
        param.setValueAtTime(target, end);
        points[0] = [end, target];
      } else {
        param.linearRampToValueAtTime(target, end);
        points.push([end, target]);
      }
    }
  };
}

function createInstrument(context) {
  const master = context.createGain();
  const changeVolume = createRamp(master.gain, 0);
  master.connect(context.destination);
  const soundingChords = new Set();

  function playNotes(id, notes, durationMs, time = context.currentTime) {
    const pitches = [...new Set(notes)].slice(0, 3);
    if (!pitches.length) return;

    const profile = voiceProfiles[id];
    const envelope = context.createGain();
    const changeLevel = createRamp(envelope.gain, 0);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = profile.cutoff;
    filter.Q.value = 0;
    filter.connect(envelope).connect(master);
    const partials = [];

    for (const note of pitches) {
      for (const [type, ratio, level] of profile.waves) {
        const oscillator = context.createOscillator();
        const mix = context.createGain();
        oscillator.type = type;
        oscillator.frequency.value = midiToHz(note) * ratio;
        mix.gain.value = level;
        oscillator.connect(mix).connect(filter);
        partials.push({ oscillator, mix });
      }
    }

    const gate = Math.max(90, durationMs);
    const decayAt = Math.min(gate, profile.attack + profile.decay);
    const level = profile.level * 0.82 / Math.sqrt(pitches.length);
    changeLevel(time, [profile.attack, level], [decayAt, level * profile.sustain],
      [gate, level * profile.sustain], [gate + profile.release, 0]);

    const endsAt = time + (gate + profile.release) / 1000;
    const chord = {
      stop(at) {
        if (at >= endsAt) return;
        changeLevel(at, [30, 0]);
        for (const { oscillator } of partials) oscillator.stop(Math.min(endsAt, at + 0.033));
      },
    };
    soundingChords.add(chord);
    partials[0].oscillator.onended = () => {
      soundingChords.delete(chord);
      for (const { oscillator, mix } of partials) {
        oscillator.disconnect();
        mix.disconnect();
      }
      filter.disconnect();
      envelope.disconnect();
    };
    for (const { oscillator } of partials) {
      oscillator.start(time);
      oscillator.stop(endsAt);
    }
  }

  function stop(time = context.currentTime) {
    for (const chord of soundingChords) chord.stop(time);
  }

  function volume(percent, time = context.currentTime) {
    changeVolume(time, [25, 0.75 * percent / 100]);
  }

  return { playNotes, stop, volume };
}
