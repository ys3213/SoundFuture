"use strict";

const stepsPerRound = 8;
const beatMs = 650;
const palettes = {
  minor: { label: "D 小調五聲", notes: [62, 65, 67, 69, 72], anchors: [0, 1, 3] },
  major: { label: "C 大調五聲", notes: [60, 62, 64, 67, 69], anchors: [0, 2, 3] },
};
const registers = { A: 0, B: -12, C: 12 };

function noteName(note) {
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  return names[note % 12] + (Math.floor(note / 12) - 1);
}

function notesFor(rows, palette, part) {
  return rows.map((row) => palette.notes[row] + registers[part]);
}

function fitHum(hz, palette) {
  if (!hz) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  let best = 0;
  let bestDistance = Infinity;
  for (const [row, note] of palette.notes.entries()) {
    const steps = midi - note;
    const distance = Math.abs(steps - 12 * Math.round(steps / 12));
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}

function emptyPhrase() {
  return Array.from({ length: stepsPerRound }, () => []);
}

class Conversation {
  constructor() {
    this.mode = "solo";
    this.paletteName = "minor";
    this.reset();
    this.loadExample();
  }

  get palette() {
    return palettes[this.paletteName];
  }

  reset() {
    this.boundary = 5;
    this.A = emptyPhrase();
    this.B = emptyPhrase();
  }

  loadExample() {
    this.reset();
    this.A = [[0, 3], [1], [], [2, 4], [3], [2], [], [0]];
    this.B[6] = [0, 1];
  }

  isOpen(beat) {
    return beat >= this.boundary;
  }

  paint(part, beat, row, add) {
    if (part === "B" && !this.isOpen(beat)) return false;
    const active = this[part][beat];
    if (add) {
      if (active.includes(row) || active.length >= 3) return false;
      active.push(row);
      active.sort((a, b) => a - b);
    } else {
      const current = active.indexOf(row);
      if (current === -1) return false;
      active.splice(current, 1);
    }
    return true;
  }

  reply(beat) {
    const lead = this.A.slice(0, this.boundary);
    const played = lead.filter((chord) => chord.length);
    if (!played.length) return [];
    const position = beat - this.boundary;
    const mirrored = lead[lead.length - 1 - (position % lead.length)];
    if (position > 0 && !mirrored.length) return [];
    const source = played[played.length - 1 - (position % played.length)];
    const melody = source.at(-1);
    const { anchors, notes } = this.palette;
    const nearby = anchors.filter((row) => Math.abs(notes[row] - notes[melody]) >= 3);
    const bass = nearby.reduce((closest, row) =>
      Math.abs(notes[row] - notes[melody]) < Math.abs(notes[closest] - notes[melody]) ? row : closest,
    );
    return [...new Set([bass, melody])];
  }

  partsAt(beat, hum = null, gesture = null) {
    if (!this.isOpen(beat)) return { A: this.A[beat], B: [], C: [] };
    if (this.mode === "solo") return { A: [], B: this.reply(beat), C: [] };

    // Keep a place for the current hum even when the drawn answer is full.
    const B = hum === null ? this.B[beat] : [...new Set([hum, ...this.B[beat]])].slice(0, 3);
    return { A: [], B, C: gesture === null ? [] : [gesture] };
  }
}
