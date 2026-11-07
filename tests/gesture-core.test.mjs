import test from "node:test";
import assert from "node:assert/strict";
import { AXES, DEFAULT_SPANS, TRACKING_GRACE_MS, ENGAGE_MS, ClutchGate, GestureMapper, PointSmoother, StableGesture, observation, angleDelta, unmirror, poseIndex, fingerCurl, gripGesture, OPEN_RATIO, FIST_RATIO } from "../grippy_control/static/gesture-core.mjs";

const p = (x, y) => ({ x, y, visibility: 1, presence: 1 });
const hand = (x, y, categoryName = "Open_Palm") => ({
  landmarks: Array.from({ length: 21 }, (_, i) => p(x + (i ? .04 : 0), y - (i ? .03 : 0))),
  gesture: { categoryName, score: .99 },
});
function frame() {
  const pose = Array.from({ length: 33 }, () => p(.5, .5));
  pose[11] = p(.65, .3); pose[12] = p(.4, .3);
  pose[14] = p(.25, .45); pose[16] = p(.15, .3); pose[15] = p(.8, .5);
  return { width: 1280, height: 720, poses: [pose], hands: [hand(.8, .5), hand(.15, .3)] };
}
const joints = [...AXES, "S5"].map((id) => ({ id, min: 1400, max: 1600 }));
const origin = Object.fromEntries(joints.map((j) => [j.id, 1500]));
const settings = Object.fromEntries(AXES.map((id) => [id, { span: DEFAULT_SPANS[id], dir: 1, gain: 1 }]));

test("a held fist alone starts control after ENGAGE_MS; no open-palm handshake", () => {
  const g = new ClutchGate();
  assert.equal(g.update("Closed_Fist", 0), false);
  assert.equal(g.arming, true);
  assert.equal(g.update("Closed_Fist", ENGAGE_MS - 1), false);
  assert.equal(g.update("Closed_Fist", ENGAGE_MS), true);
  assert.equal(g.active, true);
});

test("an open palm pauses immediately and a new fist restarts after the delay", () => {
  const g = new ClutchGate();
  g.update("Closed_Fist", 0); assert.equal(g.update("Closed_Fist", ENGAGE_MS), true);
  assert.equal(g.update("Open_Palm", 400), false);
  assert.equal(g.active, false); assert.equal(g.holding, false);
  assert.equal(g.update("Closed_Fist", 410), false);
  assert.equal(g.update("Closed_Fist", 410 + ENGAGE_MS), true);
});

test("brief recognition gaps freeze permission and recover on a fresh fist", () => {
  const g = new ClutchGate();
  g.update("Closed_Fist", 0); assert.equal(g.update("Closed_Fist", ENGAGE_MS), true);
  assert.equal(g.update(null, 600), false); // No frame may command movement here.
  assert.equal(g.holding, true); assert.equal(g.active, true);
  assert.equal(g.suspend(1900), true);
  assert.equal(g.update("Closed_Fist", 2000), true);
  assert.equal(g.holding, false);
  // The next gap has its own fixed deadline, never extended by missing frames.
  g.suspend(2100); assert.equal(g.suspend(3599), true);
  assert.equal(g.suspend(3600), false);
  assert.equal(g.active, false);
});

test("after a long tracking loss a held fist restarts after the delay, not at once", () => {
  const g = new ClutchGate();
  g.update("Closed_Fist", 0); g.update("Closed_Fist", ENGAGE_MS);
  g.update(null, 400);
  assert.equal(g.update("Closed_Fist", 400 + TRACKING_GRACE_MS), false);
  assert.equal(g.update("Closed_Fist", 400 + TRACKING_GRACE_MS + ENGAGE_MS), true);
});

test("an unclassified moment while closing does not lose the pending fist", () => {
  const g = new ClutchGate();
  g.update("Closed_Fist", 0);
  assert.equal(g.update(null, 100), false);
  assert.equal(g.holding, true);
  assert.equal(g.update("Closed_Fist", ENGAGE_MS + 10), true);
  // Permission persists while the fist is held.
  assert.equal(g.update("Closed_Fist", 2500), true);
  assert.equal(g.update(null, 2510), false);
  assert.equal(g.update("Closed_Fist", 2520), true);
});

test("after a refused start the clutch must open once before trying again", () => {
  const g = new ClutchGate();
  g.update("Closed_Fist", 0); g.update("Closed_Fist", ENGAGE_MS);
  g.latch();
  assert.equal(g.update("Closed_Fist", 400), false);
  assert.equal(g.update("Closed_Fist", 2000), false);
  assert.equal(g.arming, false);
  g.update("Open_Palm", 2100);
  g.update("Closed_Fist", 2200); assert.equal(g.update("Closed_Fist", 2200 + ENGAGE_MS), true);
  g.reset(); // Explicit pause still cancels permission immediately.
  assert.equal(g.active, false);
});

test("hand assignment is spatial, independent of model result ordering", () => {
  const data = frame(), a = observation(data);
  assert.equal(a.valid, true);
  assert.equal(a.main.landmarks[0].x, .15);
  data.hands.reverse();
  const b = observation(data);
  assert.deepEqual(a.values, b.values);
  assert.equal(b.main.landmarks[0].x, .15);
});

test("missing joints, crossed hands, multiple people and uncertain fists are rejected", () => {
  const hidden = frame(); hidden.poses[0][14].visibility = .2;
  assert.equal(observation(hidden).valid, false);
  const crossed = frame(); crossed.poses[0][15] = p(.16, .3);
  assert.equal(observation(crossed).valid, false);
  const two = frame(); two.poses.push(structuredClone(two.poses[0]));
  assert.equal(observation(two).valid, false);
  const uncertain = frame(); uncertain.hands[0].gesture.score = .4;
  assert.equal(observation(uncertain).clutchGesture, null);
});

test("visible hands supply wrists even when the body model has low wrist confidence", () => {
  const data = frame(), expected = observation(data);
  data.poses[0][15].visibility = .1;
  data.poses[0][16].visibility = .1;
  const result = observation(data);
  assert.equal(result.valid, true);
  assert.deepEqual(result.values, expected.values);
  // Coarse body-to-hand agreement is still mandatory.
  data.poses[0][16] = p(.9, .1);
  assert.equal(observation(data).valid, false);
});

test("tracking errors name the missing body anchor and do not require the other elbow", () => {
  const data = frame();
  data.poses[0][14].visibility = .2;
  assert.match(observation(data).reason, /prawy łokieć/);
  data.poses[0][14].visibility = 1;
  data.poses[0][13].visibility = .1;
  assert.equal(observation(data).valid, true);
  data.poses[0][11].visibility = .1;
  assert.match(observation(data).reason, /lewy bark/);
});

test("arm geometry uses the matched hand wrist and remains independent of hand order", () => {
  const data = frame();
  // The pose wrist is an association hint; the hand model gives the precise wrist.
  data.poses[0][16] = p(.19, .32);
  const result = observation(data);
  assert.equal(result.valid, true);
  assert.deepEqual(result.values, observation(frame()).values);
  data.hands.reverse();
  assert.deepEqual(observation(data).values, result.values);
});

test("angles are calculated using actual camera aspect ratio", () => {
  const data = frame(), a = observation(data);
  data.width *= 2;
  for (const p of data.poses[0]) p.x /= 2;
  for (const h of data.hands) for (const p of h.landmarks) p.x /= 2;
  const b = observation(data);
  for (const id of AXES) assert.ok(Math.abs(a.values[id] - b.values[id]) < 1e-10);
});

test("minor fingertip overshoot is tolerated but missing palms and hands remain invalid", () => {
  const data = frame();
  data.hands[0].landmarks[8].x = 1.01;
  assert.equal(observation(data).valid, true);
  data.hands[0].landmarks[0].x = 1.01;
  assert.equal(observation(data).valid, false);
  data.hands.pop();
  assert.match(observation(data).reason, /1 z 2/);
});

test("visual filtering reduces jitter, does not mutate points and resets after long gaps", () => {
  const a = new PointSmoother(), b = new PointSmoother();
  const zero = [p(0, 0)], target = [p(1, 1)], before = structuredClone(target);
  a.filter(zero, 0); b.filter(zero, 0);
  const first = a.filter(target, 50)[0].x;
  assert.ok(first > 0 && first < .5);
  a.filter(target, 100);
  assert.ok(Math.abs(a.points[0].x - b.filter(target, 100)[0].x) < 1e-10);
  assert.deepEqual(target, before);
  assert.deepEqual(a.filter(zero, 1000), zero);
});

test("reengagement anchors every axis at its current commanded position", () => {
  const m = new GestureMapper();
  m.filter({ S1: 1, S2: .4, S3: 1.2, S4: -.2 }, 0);
  m.start(origin, "Open_Palm");
  assert.deepEqual(m.map(joints, settings, "Open_Palm", 0), origin);
  m.filter({ S1: 2, S2: .8, S3: 1.3, S4: .2 }, 1000);
  const moved = m.map(joints, settings, "Open_Palm", 1000);
  assert.ok(moved.S1 > 1500);
  m.start(moved, "Open_Palm");
  assert.deepEqual(m.map(joints, settings, "Open_Palm", 1100), moved);
});

test("dead zone suppresses jitter, directions invert, and calibrated bounds clamp", () => {
  const m = new GestureMapper();
  m.filter(Object.fromEntries(AXES.map((id) => [id, 0])), 0); m.start(origin, "Open_Palm");
  m.filter(Object.fromEntries(AXES.map((id) => [id, .01])), 1000);
  assert.deepEqual(m.map(joints, settings, "Open_Palm", 1000), origin);
  m.filter({ S1: 100, S2: 1, S3: 100, S4: 1 }, 2000);
  const v = m.map(joints, { ...settings, S1: { ...settings.S1, dir: -1 } }, "Open_Palm", 2000);
  assert.equal(v.S1, 1400); assert.equal(v.S3, 1600);
  assert.ok(Object.values(v).every((n) => n >= 1400 && n <= 1600));
});

test("gripper follows the control hand directly after a stable 200 ms gesture", () => {
  const m = new GestureMapper();
  m.filter(Object.fromEntries(AXES.map((id) => [id, 0])), 0);
  m.start({ ...origin, S5: 1600 });
  // An open hand opens a closed gripper; no prior change is needed.
  m.map(joints, settings, "Open_Palm", 0);
  assert.equal(m.map(joints, settings, "Open_Palm", 150).S5, 1600, "Not before 200 ms");
  assert.equal(m.map(joints, settings, "Open_Palm", 201).S5, 1400);
  m.map(joints, settings, "Closed_Fist", 300);
  assert.equal(m.map(joints, settings, "Closed_Fist", 501).S5, 1600);
  assert.equal(m.map(joints, { ...settings, S5: { dir: -1 } }, "Closed_Fist", 600).S5, 1400, "Direction setting flips closed/open");
  assert.equal(m.map(joints, settings, null, 700).S5, 1400, "Unsure frames keep the last grip");
});

test("a side-on hand without a confident gesture still opens and closes the gripper", () => {
  const h = (tips) => ({ gesture: { categoryName: "None", score: .9 }, landmarks: Array.from({ length: 21 }, (_, i) => {
    const finger = Math.floor((i - 1) / 4), joint = (i - 1) % 4;
    if (i === 0) return p(.5, .8);
    if (finger === 0) return p(.45, .75 - joint * .02);
    const x = .46 + (finger - 1) * .03;
    return joint === 0 ? p(x, .7) : p(x, .7 - (tips === "open" ? joint * .05 : 0) + (tips === "open" ? 0 : joint * .015));
  }) });
  assert.ok(fingerCurl(h("open")) > OPEN_RATIO);
  assert.equal(gripGesture(h("open")), "Open_Palm");
  assert.ok(fingerCurl(h("fist")) < FIST_RATIO);
  assert.equal(gripGesture(h("fist")), "Closed_Fist");
  const confident = h("fist"); confident.gesture = { categoryName: "Open_Palm", score: .9 };
  assert.equal(gripGesture(confident), "Open_Palm", "A confident model result wins");
});

test("wrist angle is held while the palm points toward the camera", () => {
  const data = frame(), ok = observation(data);
  assert.equal(ok.reliable.S4, true);
  // Same 2D picture, but knuckles far closer to the camera than the wrist.
  for (const i of [5, 9, 13, 17]) data.hands[1].landmarks[i] = { ...data.hands[1].landmarks[i], z: -.2 };
  assert.equal(observation(data).reliable.S4, false);
  const m = new GestureMapper();
  m.filter({ S1: 0, S2: 0, S3: 0, S4: 0 }, 0);
  m.filter({ S1: 0, S2: 0, S3: 0, S4: 1.4 }, 33, { S4: false });
  assert.equal(m.filtered.S4, 0);
});

test("still-hand jitter is filtered and small target noise does not reach the servo", () => {
  const m = new GestureMapper();
  m.filter({ S1: 0, S2: 0, S3: 0, S4: 0 }, 0); m.start(origin);
  const sent = new Set();
  for (let t = 33, i = 0; i < 90; i++, t += 33) {
    const n = (i % 2 ? 1 : -1) * .06; // ±3.4° camera noise around a pose just past the dead zone
    m.filter({ S1: 0, S2: 0, S3: 0, S4: .3 + n }, t);
    if (i > 45) sent.add(m.map(joints, settings, null, t).S4);
  }
  assert.ok(sent.size <= 2, `S4 settled instead of hunting: ${[...sent]}`);
  // A real, fast motion still gets through quickly.
  let t = 3000; for (let i = 0; i < 8; i++, t += 33) m.filter({ S1: 0, S2: 0, S3: 0, S4: .9 }, t);
  assert.ok(m.filtered.S4 > .75, `fast motion tracked: ${m.filtered.S4}`);
});

test("angular wrapping takes the short path and unknown gestures do not linger", () => {
  assert.ok(Math.abs(angleDelta(-Math.PI + .1, Math.PI - .1) - .2) < 1e-10);
  const s = new StableGesture(); s.update("Closed_Fist", 0);
  assert.equal(s.update("Closed_Fist", 201), "Closed_Fist");
  assert.equal(s.update(null, 202), null);
});

test("a camera that mirrors its own frames can be undone without swapping roles", () => {
  const normal = frame(), expected = observation(normal);
  // What the models report for the same person when the camera mirrors the frame.
  const mirrored = unmirror(normal);
  unmirror(mirrored).poses[0].forEach((q, i) => assert.ok(Math.abs(q.x - normal.poses[0][i].x) < 1e-12 && q.y === normal.poses[0][i].y));
  const wrong = observation(mirrored);
  assert.equal(wrong.valid, true);
  assert.equal(wrong.main, mirrored.hands[0], "Without the option the user's left hand becomes the control hand");
  const fixed = observation(mirrored, "right", true);
  assert.equal(fixed.valid, true);
  assert.equal(fixed.main, mirrored.hands[1], "Roles return to the user's real hands");
  assert.equal(fixed.clutch, mirrored.hands[0]);
  for (const id of AXES) assert.ok(Math.abs(fixed.values[id] - expected.values[id]) < 1e-10, id);
  assert.equal(poseIndex("wrist", "right"), 16);
  assert.equal(poseIndex("wrist", "right", true), 15);
  assert.equal(poseIndex("shoulder", "left", true), 12);
});
