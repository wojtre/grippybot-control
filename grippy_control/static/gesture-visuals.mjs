import { category, clamp } from "./gesture-core.mjs";

const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

export function handVisual(hand, { isClutch = false, active = false, preview = false, holding = false } = {}) {
  const fist = category(hand) === "Closed_Fist";
  if (isClutch && holding) return { state: "holding", color: "#ffd37a", points: "#fff0cd", label: "TRZYMAM", fist: true };
  if (fist && isClutch && active) return { state: "control", color: "#c2ff64", points: "#edffbf", label: "STEROWANIE", fist: true };
  if (fist && isClutch && preview) return { state: "preview", color: "#bc8cff", points: "#eadbff", label: "PODGLĄD", fist: true };
  if (fist) return { state: "fist", color: "#bc8cff", points: "#eadbff", label: "PIĘŚĆ", fist: true };
  return { state: "open", color: "#65f5da", points: "#e1fff6", label: "", fist: false };
}

export function drawHand(ctx, hand, point, style, time, width, height) {
  const ps = hand.landmarks.map(point);
  ctx.save();
  ctx.shadowColor = style.color;
  ctx.shadowBlur = style.fist ? 15 : 8;
  if (style.fist) {
    const palm = [0, 5, 9, 13, 17].map((i) => ps[i]);
    const center = { x: palm.reduce((n, p) => n + p.x, 0) / 5, y: palm.reduce((n, p) => n + p.y, 0) / 5 };
    const radius = clamp(Math.max(...ps.map((p) => Math.hypot(p.x - center.x, p.y - center.y))) + 16, 32, 130);
    const glowRadius = radius * 1.45;
    const glow = ctx.createRadialGradient(center.x, center.y, radius * .2, center.x, center.y, glowRadius);
    glow.addColorStop(0, style.color + "30"); glow.addColorStop(1, style.color + "00");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(center.x, center.y, glowRadius, 0, Math.PI * 2); ctx.fill();
    const pulse = style.state === "control" ? 1 + .035 * Math.sin(time / 180) : 1;
    ctx.strokeStyle = style.color; ctx.lineWidth = style.state === "control" ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(center.x, center.y, radius * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([7, 6]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(center.x, center.y, radius + 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.shadowBlur = 0; ctx.font = "600 11px ui-monospace, monospace"; ctx.fillStyle = style.points;
    ctx.fillText(style.label, clamp(center.x - ctx.measureText(style.label).width / 2, 8, Math.max(8, width - 130)), clamp(center.y + radius + 27, 18, height - 12));
  }
  ctx.shadowBlur = style.fist ? 12 : 8;
  ctx.strokeStyle = style.color + "dd";
  ctx.lineWidth = style.fist ? 3 : 2;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath(); ctx.moveTo(ps[a].x, ps[a].y); ctx.lineTo(ps[b].x, ps[b].y); ctx.stroke();
  }
  ctx.fillStyle = style.points;
  for (const p of ps) { ctx.beginPath(); ctx.arc(p.x, p.y, style.fist ? 3.4 : 2.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = style.color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(ps[0].x, ps[0].y, 14, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

export function introHandSvg(role, mirrored = false, reducedMotion = false) {
  const clutch = role === "clutch";
  const fingers = [
    { open: "M88 145 L82 112 L84 82", closed: "M88 145 L82 119 L103 132", base: [88,145] },
    { open: "M113 139 L110 98 L112 62", closed: "M113 139 L110 112 L130 129", base: [113,139] },
    { open: "M139 139 L140 97 L141 60", closed: "M139 139 L142 112 L153 130", base: [139,139] },
    { open: "M164 146 L169 115 L170 88", closed: "M164 146 L174 124 L167 143", base: [164,146] },
    { open: "M91 183 L61 159 L49 133", closed: "M91 183 L90 158 L139 151", base: [91,183] },
  ];
  const animate = (attribute, open, closed) => clutch && !reducedMotion ? `<animate attributeName="${attribute}" values="${open};${open};${closed};${closed};${open}" keyTimes="0;.22;.42;.72;1" dur="4s" repeatCount="indefinite"/>` : "";
  return `<svg class="intro-hand intro-hand-${role}" viewBox="0 0 260 280" aria-hidden="true">
    <circle cx="130" cy="155" r="94" class="intro-orbit"/>
    <path d="M27 155 H48 M212 155 H233 M130 52 V72 M130 239 V260" class="intro-guides"/>
    ${clutch ? `<circle cx="130" cy="155" r="77" class="intro-fist-halo" opacity=".1">${animate("opacity", ".1", ".9")}</circle>` : '<path d="M39 192 Q16 134 53 93 M207 93 Q244 134 221 192" class="intro-motion-arrows"/>'}
    <g class="${!clutch && !reducedMotion ? "intro-control-rig" : ""}"><g transform="${mirrored ? "translate(260 0) scale(-1 1)" : ""}">
      <path d="M105 263 L105 211 M154 263 L154 211" class="intro-bones intro-forearm"/>
      <path d="M88 199 L79 149 Q82 135 100 135 H154 Q176 135 180 149 L171 199 Q131 222 88 199Z" class="intro-palm"/>
      ${fingers.map((finger) => `<path d="${finger.open}" class="intro-bones">${animate("d", finger.open, finger.closed)}</path><circle cx="${finger.base[0]}" cy="${finger.base[1]}" r="4" class="intro-joint"/>`).join("")}
      <circle cx="130" cy="211" r="10" class="intro-joint intro-wrist"/>
    </g></g></svg>`;
}
