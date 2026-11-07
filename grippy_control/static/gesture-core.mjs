// Pure geometry and gesture state: no camera, network, or servo side effects.
export const AXES = ["S1", "S2", "S3", "S4"];
export const TRACKING_GRACE_MS = 1500;
export const DEFAULT_SPANS = { S1: 1.5, S2: Math.PI / 2, S3: Math.PI / 2, S4: Math.PI / 3 };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const vector = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const length = (a) => Math.hypot(a.x, a.y);
const signedAngle = (a, b) => Math.atan2(a.x * b.y - a.y * b.x, dot(a, b));
const pointOK = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const visible = (p) => pointOK(p) && (p.visibility ?? 0) >= 0.65 && (p.presence ?? 1) >= 0.65;

// Gripper state of the control hand. The gesture model is unsure about hands
// held side-on, so fall back to finger curl measured in 3D (MediaPipe z uses
// the x scale): fingertip-to-wrist vs knuckle-to-wrist distance. Hysteresis
// band between OPEN_RATIO and FIST_RATIO returns null (keep current grip).
export const OPEN_RATIO = 1.55, FIST_RATIO = 1.3;
export function fingerCurl(hand, width = 1, height = 1) {
  const l = hand?.landmarks;
  if (!l || l.length !== 21) return null;
  const d = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height, ((a.z ?? 0) - (b.z ?? 0)) * width);
  const ratios = [[5, 8], [9, 12], [13, 16], [17, 20]].map(([m, t]) => d(l[0], l[t]) / Math.max(1e-6, d(l[0], l[m]))).sort((a, b) => a - b);
  return (ratios[1] + ratios[2]) / 2; // median of four fingers
}
export function gripGesture(hand, width = 1, height = 1) {
  const c = category(hand);
  if (c) return c;
  const r = fingerCurl(hand, width, height);
  if (r === null || !Number.isFinite(r)) return null;
  return r >= OPEN_RATIO ? "Open_Palm" : r <= FIST_RATIO ? "Closed_Fist" : null;
}

// 2D wrist angle is only meaningful while the palm lies roughly in the image
// plane. Pointing the hand toward/away from the camera shortens its projection
// and the angle swings wildly, so S4 is held instead.
export const PALM_MIN_PROJECTION = 0.55;
export function palmProjection(hand, width, height) {
  const l = hand.landmarks, w = l[0];
  const m = [5, 9, 17].map((i) => l[i]), avg = (k) => m.reduce((n, p) => n + (p[k] ?? 0), 0) / 3;
  const dx = (avg("x") - w.x) * width, dy = (avg("y") - w.y) * height, dz = (avg("z") - (w.z ?? 0)) * width;
  const full = Math.hypot(dx, dy, dz);
  return full > 0 ? Math.hypot(dx, dy) / full : 1;
}

export function category(hand) {
  const c = hand?.gesture;
  return c && c.score >= 0.75 && ["Closed_Fist", "Open_Palm"].includes(c.categoryName) ? c.categoryName : null;
}

// Left/right pose landmark pairs (MediaPipe Pose, 33 points).
const POSE_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

// Some webcams (e.g. a mirror option in the camera's own app) deliver an
// already mirrored frame. Both models then label the user's left side as
// right. Undo it in model coordinates: flip x and swap pose left/right labels.
export function unmirror(result) {
  const flip = (p) => p && { ...p, x: 1 - p.x };
  const poses = (result.poses || []).map((pose) => {
    const out = pose.map(flip);
    for (const [a, b] of POSE_PAIRS) if (a < out.length && b < out.length) [out[a], out[b]] = [out[b], out[a]];
    return out;
  });
  const hands = (result.hands || []).map((h) => ({ ...h, landmarks: h.landmarks?.map(flip) }));
  return { ...result, poses, hands };
}

// The pose landmark index of the user's shoulder/elbow/wrist in the raw frame.
export function poseIndex(joint, userSide, sourceMirrored = false) {
  const left = { shoulder: 11, elbow: 13, wrist: 15 }[joint];
  return (userSide === "right") !== sourceMirrored ? left + 1 : left;
}

export function observation(raw, side = "right", sourceMirrored = false) {
  const result = sourceMirrored ? unmirror(raw) : raw;
  const original = raw.hands || [];
  const poses = result.poses || [], hands = result.hands || [];
  const fail = (reason) => ({ valid: false, reason });
  if (poses.length !== 1) return fail(poses.length > 1 ? "W kadrze powinna być jedna osoba" : "Pokaż barki i całe ramię");
  const pose = poses[0], right = side === "right";
  const si = right ? 12 : 11, ei = right ? 14 : 13, wi = right ? 16 : 15, oi = right ? 15 : 16;
  const anchors = [[11, "lewy bark"], [12, "prawy bark"], [ei, right ? "prawy łokieć" : "lewy łokieć"]];
  const missing = anchors.filter(([i]) => !visible(pose[i])).map(([, name]) => name);
  if (missing.length) return fail(`Pokaż wyraźnie: ${missing.join(", ")}`);
  if (![wi, oi].every((i) => pointOK(pose[i]))) return fail("Pokaż oba nadgarstki w kadrze");
  if (hands.length !== 2) return fail(`Pokaż obie dłonie — wykryto ${hands.length} z 2`);
  // Small fingertip overshoot at the image border is normal model noise.
  // The entire palm and wrist must still be inside the frame.
  const handOK = (h) => h.landmarks?.length === 21
    && h.landmarks.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -.03 && p.x <= 1.03 && p.y >= -.03 && p.y <= 1.03)
    && [0, 5, 9, 13, 17].every((i) => pointOK(h.landmarks[i]));
  if (hands.some((h) => !handOK(h))) return fail("Przesuń dłonie od krawędzi obrazu");
  // Work in pixels so angles do not depend on camera aspect ratio. Models see
  // the original frame; only presentation is mirrored. Never trust array order.
  const scale = (p) => ({ x: p.x * result.width, y: p.y * result.height });
  const shoulders = [scale(pose[11]), scale(pose[12])], width = distance(...shoulders);
  if (!Number.isFinite(width) || width < result.width * 0.08) return fail("Podejdź bliżej kamery");
  // Pose wrists provide coarse left/right association. The hand model already
  // tracks each wrist precisely; low pose-wrist visibility must not veto it.
  const poseWrist = scale(pose[wi]), other = scale(pose[oi]);
  const hw = hands.map((h) => scale(h.landmarks[0]));
  const costs = [distance(hw[0], poseWrist) + distance(hw[1], other), distance(hw[1], poseWrist) + distance(hw[0], other)];
  if (Math.abs(costs[0] - costs[1]) < width * 0.15 || distance(poseWrist, other) < width * 0.25 || distance(...hw) < width * 0.25) return fail("Rozsuń dłonie — nie krzyżuj rąk");
  const index = costs[0] < costs[1] ? 0 : 1, main = hands[index], clutch = hands[1 - index];
  if (distance(hw[index], poseWrist) > width * 0.45 || distance(hw[1 - index], other) > width * 0.45) return fail("Niepewne przypisanie dłoni");
  const wrist = hw[index];
  const shoulder = scale(pose[si]), elbow = scale(pose[ei]);
  const upper = vector(shoulder, elbow), forearm = vector(elbow, wrist);
  const palmPoints = [5, 9, 17].map((i) => scale(main.landmarks[i]));
  const palm = vector(hw[index], { x: palmPoints.reduce((n, p) => n + p.x, 0) / 3, y: palmPoints.reduce((n, p) => n + p.y, 0) / 3 });
  if (length(upper) < width * 0.2 || length(forearm) < width * 0.2 || length(palm) < width * 0.06) return fail("Ustaw ramię bardziej bokiem do kamery");
  const outward = Math.sign(shoulder.x - scale(pose[right ? 11 : 12]).x);
  // Return the model's own hand objects (raw frame coordinates) for drawing.
  return {
    valid: true, main: original[index], clutch: original[1 - index], mainGesture: category(main), clutchGesture: category(clutch),
    mainGrip: gripGesture(main, result.width, result.height),
    reliable: { S4: palmProjection(main, result.width, result.height) >= PALM_MIN_PROJECTION },
    values: {
      S1: -(wrist.x - (shoulders[0].x + shoulders[1].x) / 2) / width,
      S2: Math.atan2(-upper.y, outward * upper.x),
      S3: Math.acos(clamp(dot(upper, forearm) / (length(upper) * length(forearm)), -1, 1)),
      S4: signedAngle(forearm, palm),
    },
    points: { shoulder, elbow, wrist },
  };
}

export class StableGesture {
  constructor(ms = 200) { this.ms = ms; this.reset(); }
  reset() { this.candidate = null; this.since = 0; this.value = null; }
  update(value, now) {
    if (value !== this.candidate) { this.candidate = value; this.since = now; this.value = null; }
    if (value && now - this.since >= this.ms) this.value = value;
    return this.value;
  }
}

// How long the clutch fist must be held before control starts.
export const ENGAGE_MS = 300;

// Clutch: a held fist (ENGAGE_MS) enables movement, an open palm pauses at once.
// No open-palm handshake is needed to start. After a refused start (latch) the
// clutch must be opened once, so a persistent error cannot loop requests.
export class ClutchGate {
  constructor(ms = ENGAGE_MS) { this.stable = new StableGesture(ms); this.reset(); }
  reset() { this.active = false; this.holding = false; this.latched = false; this.gapSince = null; this.stable.reset(); }
  latch() { this.reset(); this.latched = true; }
  // A fist is recognized and will enable control once held long enough.
  get arming() { return !this.active && !this.latched && this.stable.candidate === "Closed_Fist"; }
  suspend(now) {
    if (this.gapSince === null) this.gapSince = now;
    if (now - this.gapSince >= TRACKING_GRACE_MS) { this.reset(); return false; }
    this.holding = this.active || this.arming;
    // Keep gesture history through the gap. A new target still requires a fresh,
    // complete frame with a confidently recognized fist; opening cancels at once.
    return this.holding;
  }
  update(gesture, now) {
    if (this.gapSince !== null && now - this.gapSince >= TRACKING_GRACE_MS) this.reset();
    if (!gesture) { this.suspend(now); return false; }
    const stable = this.stable.update(gesture, now);
    // An observed open palm releases immediately; only uncertainty gets a grace
    // period. A held permission never authorizes targets from a missing frame.
    if (gesture === "Open_Palm") {
      this.active = false; this.holding = false; this.latched = false; this.gapSince = null;
      return false;
    }
    if (stable === "Closed_Fist" && !this.latched) {
      this.active = true; this.holding = false; this.gapSince = null;
    }
    return this.active && !this.holding;
  }
}

export class PointSmoother {
  constructor(ms = 110) { this.ms = ms; this.reset(); }
  reset() { this.points = null; this.time = null; }
  filter(points, now) {
    const alpha = this.time === null || now - this.time > 250 ? 1 : 1 - Math.exp(-Math.max(0, now - this.time) / this.ms);
    if (!this.points || this.points.length !== points.length) this.points = points.map((p) => ({ ...p }));
    else this.points = points.map((p, i) => ({ ...p, x: this.points[i].x + alpha * (p.x - this.points[i].x), y: this.points[i].y + alpha * (p.y - this.points[i].y) }));
    this.time = now;
    return this.points;
  }
}

// One Euro filter (Casiez et al. 2012): heavy smoothing while still, little
// lag during fast motion. Per-axis minimum cutoff in Hz; angles in radians.
export const FILTER = {
  S1: { min: 0.9, beta: 0.8 },
  S2: { min: 0.9, beta: 0.6 },
  S3: { min: 0.9, beta: 0.6 },
  S4: { min: 0.5, beta: 0.4 },
};
const smoothing = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
// Ignore target changes smaller than this (µs), so noise cannot make the
// servo hunt back and forth around one position.
export const TARGET_DEADBAND_US = 6;

export class GestureMapper {
  constructor() { this.reset(); }
  reset() { this.filtered = null; this.speed = null; this.time = null; this.anchor = null; this.grip = new StableGesture(); }
  filter(values, now, reliable = {}) {
    if (!this.filtered) {
      this.filtered = { ...values }; this.speed = Object.fromEntries(AXES.map((id) => [id, 0])); this.time = now;
      return this.filtered;
    }
    const dt = Math.max(1e-3, (now - this.time) / 1000);
    for (const id of AXES) {
      if (reliable[id] === false) { this.speed[id] = 0; continue; } // hold
      const d = id === "S1" || id === "S3" ? values[id] - this.filtered[id] : angleDelta(values[id], this.filtered[id]);
      this.speed[id] += smoothing(1, dt) * (d / dt - this.speed[id]);
      const cutoff = FILTER[id].min + FILTER[id].beta * Math.abs(this.speed[id]);
      this.filtered[id] += smoothing(cutoff, dt) * d;
    }
    this.time = now;
    return this.filtered;
  }
  start(targets) {
    this.anchor = { ...this.filtered };
    this.origin = { ...targets };
    this.targets = { ...targets };
    this.grip.reset();
  }
  map(joints, settings, gesture, now) {
    if (!this.anchor) return null;
    for (const j of joints) {
      if (!AXES.includes(j.id)) continue;
      const setting = settings[j.id] || {};
      const delta = j.id === "S1" || j.id === "S3" ? this.filtered[j.id] - this.anchor[j.id] : angleDelta(this.filtered[j.id], this.anchor[j.id]);
      const span = setting.span ?? DEFAULT_SPANS[j.id];
      const dead = 0.035;
      const effective = Math.abs(delta) < dead ? 0 : delta - Math.sign(delta) * dead;
      const v = Math.round(clamp(this.origin[j.id] + effective / span * (j.max - j.min) * (setting.gain ?? 1) * (setting.dir ?? 1), j.min, j.max));
      const edge = v === j.min || v === j.max;
      if (edge || Math.abs(v - this.targets[j.id]) >= TARGET_DEADBAND_US) this.targets[j.id] = v;
    }
    // Gripper follows the control hand directly: open palm opens, fist closes,
    // after the gesture has been stable for 200 ms. Unsure frames keep the grip.
    const grip = this.grip.update(gesture, now);
    const j = joints.find((j) => j.id === "S5");
    if (grip && j) {
      const closedIsMax = (settings.S5?.dir ?? 1) === 1;
      this.targets.S5 = (grip === "Closed_Fist") === closedIsMax ? j.max : j.min;
    }
    return { ...this.targets };
  }
}
