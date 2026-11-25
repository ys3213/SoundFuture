"use strict";

function createScore(element, header, onPaint, shouldAdd) {
  const cells = [];
  const names = [];
  const beatLabels = [];
  let stroke = null;

  const pitchLabel = document.createElement("span");
  pitchLabel.textContent = "音高";
  header.append(pitchLabel);
  for (let beat = 0; beat < stepsPerRound; beat += 1) {
    const label = document.createElement("span");
    label.textContent = beat + 1;
    header.append(label);
    beatLabels.push(label);
  }

  for (let row = 4; row >= 0; row -= 1) {
    const note = document.createElement("span");
    note.className = "grid-note";
    const leadNote = document.createElement("span");
    leadNote.className = "lead-note";
    const answerNote = document.createElement("span");
    answerNote.className = "answer-note";
    note.append(leadNote, answerNote);
    element.append(note);
    names[row] = { leadNote, answerNote };
    for (let beat = 0; beat < stepsPerRound; beat += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.beat = beat;
      cell.dataset.row = row;
      element.append(cell);
      cells.push(cell);
    }
  }

  function paint(cell, add) {
    onPaint(Number(cell.dataset.beat), Number(cell.dataset.row), add);
  }

  element.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || event.button !== 0 || stroke) return;
    event.preventDefault();
    stroke = { id: event.pointerId, add: shouldAdd(cell.dataset.beat, cell.dataset.row), visited: new Set() };
    element.setPointerCapture(event.pointerId);
    stroke.visited.add(cell);
    paint(cell, stroke.add);
  });
  element.addEventListener("pointermove", (event) => {
    if (stroke?.id !== event.pointerId) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest(".cell");
    if (!cell || !element.contains(cell) || stroke.visited.has(cell)) return;
    stroke.visited.add(cell);
    paint(cell, stroke.add);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    element.addEventListener(name, (event) => {
      if (stroke?.id === event.pointerId) stroke = null;
    });
  }
  element.addEventListener("click", (event) => {
    const cell = event.target.closest(".cell");
    if (event.detail === 0 && cell) paint(cell, shouldAdd(cell.dataset.beat, cell.dataset.row));
  });

  function render(score, selected, frame, parts) {
    for (const [row, { leadNote, answerNote }] of names.entries()) {
      leadNote.textContent = noteName(notesFor([row], score.palette, "A")[0]);
      answerNote.textContent = noteName(notesFor([row], score.palette, "B")[0]);
    }
    beatLabels.forEach((label, beat) => {
      label.classList.toggle("is-open", score.isOpen(beat));
      label.classList.toggle("is-playing", beat === frame);
    });
    for (const cell of cells) {
      const beat = Number(cell.dataset.beat);
      const row = Number(cell.dataset.row);
      const open = score.isOpen(beat);
      const writtenA = score.A[beat].includes(row);
      const writtenB = score.mode === "group" && score.B[beat].includes(row);
      const active = beat === frame;
      cell.classList.toggle("is-open", open);
      cell.classList.toggle("is-playing", active);
      cell.classList.toggle("has-a", writtenA && !open);
      cell.classList.toggle("ghost-a", writtenA && open);
      cell.classList.toggle("has-b", writtenB && open);
      cell.classList.toggle("ghost-b", writtenB && !open);
      cell.classList.toggle("has-live-b", active && parts.B.includes(row));
      cell.classList.toggle("has-live-c", active && parts.C.includes(row));
      cell.setAttribute("aria-pressed", String(score[selected][beat].includes(row)));
      const pitch = selected === "A" ? names[row].leadNote.textContent : names[row].answerNote.textContent;
      cell.setAttribute("aria-label", `第 ${beat + 1} 拍 ${pitch}`);
      cell.title = open ? `回應 ${names[row].answerNote.textContent}` : `主句 ${names[row].leadNote.textContent}`;
    }
  }

  return { render };
}
