import test from "node:test";
import assert from "node:assert/strict";
import { drawHand, handVisual } from "../grippy_control/static/gesture-visuals.mjs";

const hand = (categoryName, score = .99) => ({
  gesture: { categoryName, score },
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x: 100 + i * 2, y: 140 - i })),
});

test("a recognized fist is distinct from an open hand without claiming control", () => {
  const open = handVisual(hand("Open_Palm"));
  const fist = handVisual(hand("Closed_Fist"));
  assert.notEqual(fist.color, open.color);
  assert.equal(fist.label, "PIĘŚĆ");
  assert.equal(fist.fist, true);
  assert.equal(open.fist, false);
});

test("only the engaged clutch gets the control halo; preview and gripper stay distinct", () => {
  const fist = hand("Closed_Fist");
  const active = handVisual(fist, { isClutch: true, active: true });
  const preview = handVisual(fist, { isClutch: true, preview: true });
  assert.equal(active.label, "STEROWANIE");
  assert.equal(preview.label, "PODGLĄD");
  assert.notEqual(active.color, preview.color);
  assert.equal(handVisual(fist, { active: true, isClutch: false }).label, "PIĘŚĆ");
  assert.equal(handVisual(fist, { isClutch: true }).state, "fist");
});

test("uncertain and released hands never retain a control indication", () => {
  for (const h of [hand("Closed_Fist", .5), hand("Open_Palm"), hand("None")]) {
    const style = handVisual(h, { isClutch: true, active: true });
    assert.equal(style.fist, false);
    assert.notEqual(style.state, "control");
  }
});

test("recovery has a separate frozen amber halo and never claims active control", () => {
  const style = handVisual(hand("None"), { isClutch: true, holding: true });
  assert.equal(style.state, "holding"); assert.equal(style.label, "TRZYMAM");
  assert.notEqual(style.color, handVisual(hand("Closed_Fist"), { isClutch: true, active: true }).color);
  assert.notEqual(handVisual(hand("None"), { isClutch: false, holding: true }).state, "holding");
});

test("the halo uses hand coordinates and drawing never changes landmarks", () => {
  const source = hand("Closed_Fist");
  const before = structuredClone(source);
  const circles = [], labels = [], gradients = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, setLineDash() {},
    arc(...args) { circles.push(args); },
    fillText(...args) { labels.push(args); },
    measureText(text) { return { width: text.length * 7 }; },
    createRadialGradient(...args) { gradients.push(args); return { addColorStop() {} }; },
  };
  drawHand(ctx, source, (p) => p, handVisual(source, { isClutch: true, active: true }), 1000, 640, 480);
  assert.deepEqual(source, before);
  assert.equal(labels[0][0], "STEROWANIE");
  assert.ok(gradients[0][0] >= 100 && gradients[0][0] <= 140);
  assert.ok(circles.some(([, , radius]) => radius > 30));
  assert.ok(labels[0][1] >= 0 && labels[0][2] < 480);
});
