import { AXES, DEFAULT_SPANS, TRACKING_GRACE_MS, ClutchGate, GestureMapper, PointSmoother, observation, poseIndex, fingerCurl, clamp } from "./gesture-core.mjs";
import { drawHand, handVisual, introHandSvg } from "./gesture-visuals.mjs";

const $ = (id) => document.getElementById(id);
const bridge = window.grippy;
const panel = $("gesture-panel");
panel.innerHTML = `
  <div class="vision-viewport" data-camera="off">
    <video id="vision-video" autoplay muted playsinline class="mirrored"></video><canvas id="vision-overlay" aria-label="Rozpoznane dłonie i przeguby"></canvas>
    <div id="vision-placeholder" class="vision-placeholder">
      <div id="vision-intro-left" class="intro-card"></div>
      <button id="vision-camera-start" class="intro-start" aria-label="Włącz kamerę">
        <span class="vision-reticle" aria-hidden="true"></span><span id="vision-start-label">Włącz kamerę</span>
      </button>
      <div id="vision-intro-right" class="intro-card"></div>
    </div>
    <div class="vision-hud"><span id="vision-status" class="vision-badge" role="status" aria-live="polite">PODGLĄD</span><div id="vision-metrics" class="vision-metrics">VISION SYSTEM / OFFLINE</div></div>
    <div id="vision-hint" class="vision-hint">Włącz kamerę. Pokaż barki, łokieć i obie dłonie.</div>
    <div class="vision-actions">
      <button id="vision-camera-toggle" class="camera-toggle" data-state="off" aria-pressed="false" hidden>Wyłącz kamerę</button>
      <button id="vision-fullscreen" title="Pełny ekran" aria-label="Pełny ekran">⛶</button>
    </div>
    <div class="vision-robot-inset" aria-label="Podgląd zadań robota">
      <div class="inset-label">GRIPPY</div>
      <svg id="vision-robot" role="img" aria-label="Schemat robota: cel i ostatnio wysłane pozycje"></svg>
      <div class="inset-legend"><span>Cel</span><span>Wysłano</span></div>
    </div>
  </div>
  <details class="vision-settings camera-settings"><summary>Kamera i podgląd</summary><div class="vision-controls">
    <select id="vision-camera" aria-label="Wybór kamery"><option value="">Kamera domyślna</option></select>
    <label><input id="vision-mirror" type="checkbox" checked> Lustro</label><label><input id="vision-trails" type="checkbox" checked> Ślad ruchu</label>
    <label title="Zaznacz, jeśli podgląd myli lewą i prawą rękę (kamera sama odbija obraz)"><input id="vision-source-mirrored" type="checkbox"> Kamera odbija obraz — zamień lewą i prawą rękę</label>
  </div><div id="vision-model-info" class="vision-models">Obraz przetwarzany lokalnie</div></details>
  <div id="vision-install" class="vision-install" hidden>Najpierw pobierz modele w katalogu projektu na komputerze, który uruchamia panel (w trybie sprzętowym: na Pi). Potem kliknij „Włącz kamerę”.<code>python3 -m grippy_control.prepare_vision</code></div>
  <details class="vision-settings"><summary>Dopasuj sterowanie i skalibruj ruchy</summary>
    <p>Kamera i kalibracja nie włączają serw. Sterowanie na żywo włączasz osobno u góry.</p>
    <label>Ręka sterująca <select id="vision-side"><option value="right">Prawa</option><option value="left">Lewa</option></select></label>
    <div id="vision-axis-settings"></div>
    <button id="vision-calibrate">Kalibruj wygodny zakres · 6 s</button><button id="vision-reset">Przywróć czułość</button>
    <p id="vision-calibration-note">Podczas kalibracji poruszaj sterującą ręką i nadgarstkiem w wygodnym zakresie, a drugą dłoń trzymaj otwartą. Kierunek chwytaka dopasuj do własnego montażu.</p>
  </details>
  <details class="vision-settings"><summary>Diagnostyka gestów</summary>
    <pre id="vision-diagnostics" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">Czekam na kamerę.</pre>
  </details>`;

class GestureStudio {
  constructor() {
    this.mode = false;
    this.side = "right";
    this.gate = new ClutchGate();
    this.mapper = new GestureMapper();
    this.visualFilters = Object.fromEntries(["pose", "main", "clutch"].map((key) => [key, new PointSmoother()]));
    this.displayData = null; this.displayObservation = null;
    this.generation = 0;
    this.cameraGeneration = 0;
    this.session = null;
    this.localActive = false;
    this.starting = false;
    this.beginInFlight = false; this.pauseRequest = null;
    this.requestBusy = false;
    this.lastSend = -Infinity;
    this.lastFrameSent = -Infinity;
    this.lastResultAt = 0;
    this.trail = [];
    this.blockedReason = "";
    this.statusHistory = [];
    try { this.sourceMirrored = localStorage.getItem("grippy-gesture-source-mirrored") === "1"; } catch { this.sourceMirrored = false; }
    $("vision-source-mirrored").checked = this.sourceMirrored;
    this.settings = this.loadSettings();
    this.renderSettings();
    this.renderIntro();
    $("gesture-tab").onclick = () => { this.mode = true; bridge.setMode(true); this.checkAssets(); };
    $("manual-tab").onclick = () => {
      this.mode = false; this.stopCamera(); bridge.setMode(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    $("vision-camera-start").onclick = () => {
      if (this.cameraStarting) this.stopCamera();
      else this.startCamera();
    };
    $("vision-camera-toggle").onclick = () => this.stopCamera();
    $("vision-camera").onchange = () => { if (this.stream) this.startCamera(); };
    $("vision-mirror").onchange = () => { this.trail = []; $("vision-video").classList.toggle("mirrored", $("vision-mirror").checked); this.draw(); };
    $("vision-trails").onchange = () => { this.trail = []; this.draw(); };
    $("vision-source-mirrored").onchange = () => {
      this.pause("Zamieniono lewą i prawą rękę — pauza");
      this.sourceMirrored = $("vision-source-mirrored").checked;
      try { localStorage.setItem("grippy-gesture-source-mirrored", this.sourceMirrored ? "1" : "0"); } catch { /* Session-only setting. */ }
      this.trail = []; this.displayData = null; this.displayObservation = null;
      for (const filter of Object.values(this.visualFilters)) filter.reset();
      this.draw();
    };
    $("vision-side").onchange = () => {
      this.pause("Zmieniono rękę sterującą — pauza");
      this.side = $("vision-side").value;
      this.displayData = null; this.displayObservation = null;
      for (const filter of Object.values(this.visualFilters)) filter.reset();
      this.calibration = null;
      this.settings = this.loadSettings(); this.renderSettings();
      this.renderIntro();
    };
    $("vision-calibrate").onclick = () => this.calibrate();
    $("vision-reset").onclick = () => { this.pause("Przywrócono czułość — pauza"); this.settings = this.defaults(); this.saveSettings(); this.renderSettings(); };
    $("vision-fullscreen").onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
        document.body.classList.toggle("studio-fullscreen", !!document.fullscreenElement);
      }
      catch { this.status("PAUZA", "Przeglądarka nie udostępnia pełnego ekranu"); }
    };
    document.addEventListener("fullscreenchange", () => {
      document.body.classList.toggle("studio-fullscreen", !!document.fullscreenElement);
      $("vision-fullscreen").setAttribute("aria-label", document.fullscreenElement ? "Wyjdź z pełnego ekranu" : "Pełny ekran");
      $("vision-fullscreen").title = document.fullscreenElement ? "Wyjdź z pełnego ekranu" : "Pełny ekran";
    });
    window.addEventListener("grippy:live", () => { this.calibration = null; this.pause("Zaciśnij pięść ręki zezwalającej, aby sterować"); });
    window.addEventListener("grippy:mode", () => { this.calibration = null; this.blockedReason = ""; this.pause("Zaciśnij pięść ręki zezwalającej, aby sterować"); });
    window.addEventListener("grippy:state", () => this.onState());
    window.addEventListener("blur", () => this.pause("Okno straciło fokus — pauza"));
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.pause("Karta ukryta — pauza"); });
    window.addEventListener("pagehide", () => this.stopCamera());
    setInterval(() => {
      if (this.stream && this.lastResultAt && performance.now() - this.lastResultAt > 300) {
        this.trackingGap("Czekam na aktualny obraz", performance.now());
        this.draw();
      }
    }, 100);
    bridge.preview(bridge.draft());
  }
  cameraButton(state) {
    this.cameraStarting = state === "starting";
    panel.querySelector(".vision-viewport").dataset.camera = state;
    $("vision-start-label").textContent = state === "starting" ? "Anuluj" : "Włącz kamerę";
    $("vision-camera-start").setAttribute("aria-label", state === "starting" ? "Anuluj uruchamianie kamery" : "Włącz kamerę");
    const button = $("vision-camera-toggle");
    button.hidden = state !== "on";
    button.dataset.state = state;
    button.setAttribute("aria-pressed", String(state !== "off"));
    $("vision-placeholder").hidden = state === "on";
  }
  renderIntro() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const side of ["left", "right"]) {
      const role = side === this.side ? "control" : "clutch";
      const title = role === "clutch" ? "Zaciśnij, żeby sterować" : "Poruszaj ramieniem";
      const text = role === "clutch" ? "Zaciśnij pięść i przytrzymaj chwilę. Otwarcie dłoni pauzuje ruch." : "Bark, łokieć i nadgarstek prowadzą robota. Dłoń obsługuje chwytak.";
      $("vision-intro-" + side).innerHTML = `${introHandSvg(role, side === "right", reducedMotion)}<span class="intro-side">${side === "left" ? "LEWA" : "PRAWA"} RĘKA</span><strong>${title}</strong><p>${text}</p>`;
    }
  }
  observe(data) { return observation(data, this.side, this.sourceMirrored); }
  clutchNames() { return this.side === "right" ? { label: "Lewa", acc: "lewą", gen: "lewej" } : { label: "Prawa", acc: "prawą", gen: "prawej" }; }
  // Live, specific guidance while paused, based on what the model sees right now.
  pausedHint(obs) {
    const { label, acc } = this.clutchNames();
    if (this.blockedReason) return /twórz/i.test(this.blockedReason) ? this.blockedReason : `${this.blockedReason}. Otwórz ${acc} dłoń, aby spróbować ponownie`;
    const g = obs.clutch?.gesture, pct = g ? ` ${Math.round(g.score * 100)}%` : "";
    if (this.gate.arming || obs.clutchGesture === "Closed_Fist") return `${label} pięść rozpoznana${pct} — przytrzymaj chwilę…`;
    if (obs.clutchGesture === "Open_Palm") return `${label} dłoń otwarta — zaciśnij ją w pięść, aby sterować`;
    const swapped = obs.mainGesture === "Closed_Fist" ? " Jeśli pięść zaciskasz właśnie tą ręką, a podgląd pokazuje ją jako sterującą, zaznacz „Kamera odbija obraz” w ustawieniach kamery." : "";
    const seen = g && g.categoryName && g.categoryName !== "None" ? `${g.categoryName}${pct}` : "gest nierozpoznany";
    return `${label} dłoń: ${seen}. Zaciśnij ${acc} dłoń w wyraźną pięść, aby sterować.${swapped}`;
  }
  defaults() { return Object.fromEntries([...AXES, "S5"].map((id) => [id, { dir: ["S2", "S3"].includes(id) ? -1 : 1, gain: 1, ...(id !== "S5" ? { span: DEFAULT_SPANS[id] } : {}) }])); }
  loadSettings() {
    const result = this.defaults();
    try {
      const saved = JSON.parse(localStorage.getItem(`grippy-gesture-v1-${this.side}`));
      for (const id of Object.keys(result)) {
        const v = saved?.[id];
        if ([1, -1].includes(v?.dir)) result[id].dir = v.dir;
        if (Number.isFinite(v?.gain) && v.gain >= .25 && v.gain <= 2) result[id].gain = v.gain;
        if (id !== "S5" && Number.isFinite(v?.span) && v.span >= .1 && v.span <= 10) result[id].span = v.span;
      }
    } catch { /* Storage may be disabled; defaults still work. */ }
    return result;
  }
  saveSettings() { try { localStorage.setItem(`grippy-gesture-v1-${this.side}`, JSON.stringify(this.settings)); } catch { /* Session-only settings. */ } }
  renderSettings() {
    const names = { S1: "Podstawa", S2: "Bark", S3: "Łokieć", S4: "Nadgarstek", S5: "Chwytak" };
    $("vision-axis-settings").innerHTML = Object.keys(names).map((id) => `<div class="vision-setting-row"><span>${id} · ${names[id]}</span><select data-axis="${id}" aria-label="Kierunek ${names[id]}"><option value="1">Zgodny</option><option value="-1">Odwrócony</option></select>${id === "S5" ? '<span></span>' : `<label title="Czułość"><input data-gain="${id}" aria-label="Czułość ${names[id]}" type="range" min="0.25" max="2" step="0.05" value="${this.settings[id].gain}"><output>${this.settings[id].gain.toFixed(2)}×</output></label>`}</div>`).join("");
    panel.querySelectorAll("[data-axis]").forEach((el) => { el.value = this.settings[el.dataset.axis].dir; el.onchange = () => { this.pause("Zmieniono kierunek — pauza"); this.settings[el.dataset.axis].dir = Number(el.value); this.saveSettings(); }; });
    panel.querySelectorAll("[data-gain]").forEach((el) => { el.oninput = () => { this.pause("Zmieniono czułość — pauza"); this.settings[el.dataset.gain].gain = Number(el.value); el.nextElementSibling.textContent = Number(el.value).toFixed(2) + "×"; this.saveSettings(); }; });
  }
  status(label, hint, kind = "") {
    if (!this.mode) return;
    const badge = $("vision-status");
    if (badge.textContent !== label) badge.textContent = label;
    badge.dataset.kind = kind;
    $("vision-hint").textContent = hint;
    const message = `${label}: ${hint}`.replace(/ · \d+\.\d s$/, "");
    if (this.statusHistory.at(-1)?.message !== message) {
      this.statusHistory.push({ time: new Date().toLocaleTimeString("pl-PL"), message });
      this.statusHistory = this.statusHistory.slice(-8);
    }
    this.diagnostics();
  }
  diagnostics() {
    const snap = bridge.snapshot(), data = this.latest;
    const obs = data && this.observe(data);
    const name = (hand) => hand?.gesture
      ? `${hand.gesture.categoryName} ${Math.round(hand.gesture.score * 100)}%`
      : "brak gestu";
    const lines = [
      "Diagnostyka 2026-11-07.5 · bez zapisywania obrazu",
      `Kamera: ${this.stream ? "włączona" : "wyłączona"} · Na żywo: ${snap.live ? "tak" : "nie"} · Połączenie: ${snap.connected ? "tak" : "nie"} · Kamera odbija obraz: ${this.sourceMirrored ? "tak (ręce zamienione)" : "nie"}`,
      `Ręka zezwalająca: ${this.side === "right" ? "lewa" : "prawa"} · Pięść (start): ${this.gate.arming ? "tak" : "nie"}${this.gate.latched ? " · Po błędzie: otwórz dłoń" : ""} · Zezwolenie: ${this.gate.active ? "tak" : "nie"}`,
      `Tolerancja przerwy: ${TRACKING_GRACE_MS / 1000} s · Podtrzymanie: ${this.gate.holding ? "tak — pozycja zamrożona" : "nie"}`,
      `Sesja robota: ${this.session ? "aktywna" : this.starting ? "uruchamianie" : "brak"} · Osie z sygnałem: ${snap.state?.joints.filter((j) => j.pulse !== null).map((j) => j.id).join(", ") || "brak"}`,
    ];
    if (data) {
      lines.push(`Śledzenie: ${obs.valid ? "poprawne" : obs.reason} · Analiza: ${Math.round(data.inferenceMs)} ms · Wiek klatki: ${Math.round(performance.now() - data.time)} ms`);
      if (obs.valid) lines.push(`Dłoń zezwalająca: ${name(obs.clutch)} · Dłoń sterująca: ${name(obs.main)}`,
        `Chwytak z dłoni: ${obs.mainGrip === "Closed_Fist" ? "zamknij" : obs.mainGrip === "Open_Palm" ? "otwórz" : "bez zmiany"} (zgięcie palców ${fingerCurl(obs.main, data.width, data.height)?.toFixed(2)}) · Nadgarstek S4: ${obs.reliable.S4 ? "śledzony" : "wstrzymany — dłoń skierowana do kamery"}`);
      else lines.push(`Wykryte dłonie: ${data.hands.map(name).join(" / ") || "brak"}`);
    }
    lines.push("Ostatnie komunikaty:", ...this.statusHistory.map((event) => `${event.time} ${event.message}`));
    $("vision-diagnostics").textContent = lines.join("\n");
  }
  async checkAssets() {
    try {
      const r = await fetch("/api/vision", { cache: "no-store", signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw Error("Brak połączenia z panelem");
      const data = await r.json();
      $("vision-install").hidden = data.ready;
      return data.ready;
    } catch (error) { this.status("BRAK POŁĄCZENIA", error.message, "lost"); return false; }
  }
  async startCamera() {
    this.stopCamera();
    const epoch = ++this.cameraGeneration;
    this.cameraButton("starting");
    this.status("PRZYGOTOWANIE", "Sprawdzanie modeli i uruchamianie kamery…");
    try {
      if (!await this.checkAssets()) throw Error("Przygotuj modele poleceniem poniżej");
      if (epoch !== this.cameraGeneration) return;
      if (!navigator.mediaDevices?.getUserMedia) throw Error("Otwórz panel przez http://127.0.0.1 lub localhost");
      const device = $("vision-camera").value;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
        ...(device ? { deviceId: { exact: device } } : {}),
      } });
      if (epoch !== this.cameraGeneration) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      this.cameraButton("on");
      const video = $("vision-video"); video.srcObject = stream; await video.play();
      if (epoch !== this.cameraGeneration) return;
      stream.getVideoTracks()[0].addEventListener("ended", () => { if (this.stream === stream) { this.stopCamera(); this.status("KAMERA ODŁĄCZONA", "Podłącz kamerę i uruchom ją ponownie", "lost"); } });
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (epoch !== this.cameraGeneration) return;
      $("vision-camera").replaceChildren(new Option("Kamera domyślna", ""), ...devices.filter((d) => d.kind === "videoinput").map((d, i) => new Option(d.label || `Kamera ${i + 1}`, d.deviceId)));
      $("vision-camera").value = device;
      // MediaPipe 0.10.21 loads its Emscripten runtime with importScripts;
      // use a classic worker (its own SDK import is dynamic ESM).
      this.worker = new Worker("/static/gesture-worker.mjs");
      this.worker.onmessage = ({ data }) => {
        if (epoch !== this.cameraGeneration) return;
        if (data.type === "ready") {
          clearTimeout(this.modelTimeout);
          $("vision-placeholder").hidden = true;
          $("vision-model-info").textContent = `MEDIAPIPE 0.10.21 / ${data.delegate} · LOKALNIE · 5 OSI · DWIE RĘCE`;
          this.status("PODGLĄD", "Zaciśnij pięść ręki zezwalającej, aby sterować");
          this.ready = true; this.lastVideoTime = -1; this.capture(epoch);
        }
        if (data.type === "result") { this.frameBusy = false; this.result(data); }
        if (data.type === "error") { this.stopCamera(); this.status("BŁĄD ŚLEDZENIA", data.message, "lost"); }
      };
      this.worker.onerror = (event) => { if (epoch === this.cameraGeneration) { console.error("MediaPipe worker:", event.message); this.stopCamera(); this.status("BŁĄD MODELU", "Sprawdź modele i użyj aktualnego Chrome", "lost"); } };
      this.modelTimeout = setTimeout(() => { if (epoch === this.cameraGeneration) { this.stopCamera(); this.status("BŁĄD MODELU", "Modele nie uruchomiły się w ciągu 45 sekund", "lost"); } }, 45000);
      this.worker.postMessage({ type: "init" });
    } catch (error) {
      if (epoch !== this.cameraGeneration) return;
      this.stopCamera();
      const messages = { NotAllowedError: "Zezwól tej stronie na dostęp do kamery w przeglądarce", NotFoundError: "Nie znaleziono kamery", NotReadableError: "Kamera jest zajęta lub niedostępna" };
      this.status("KAMERA NIEDOSTĘPNA", messages[error.name] || error.message, "lost");
    }
  }
  stopCamera() {
    this.pause("Kamera wyłączona — pozycja podtrzymywana");
    this.cameraGeneration++;
    this.ready = false; this.frameBusy = false; this.lastResultAt = 0;
    clearTimeout(this.modelTimeout);
    cancelAnimationFrame(this.animation);
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    $("vision-video").srcObject = null;
    $("vision-placeholder").hidden = false;
    this.cameraButton("off");
    this.latest = null; this.trail = []; this.calibration = null; this.draw();
    this.displayData = null; this.displayObservation = null;
    for (const filter of Object.values(this.visualFilters)) filter.reset();
    $("vision-metrics").textContent = "VISION SYSTEM / OFFLINE";
    this.diagnostics();
  }
  capture(epoch) {
    if (epoch !== this.cameraGeneration || !this.ready) return;
    this.animation = requestAnimationFrame(() => this.capture(epoch));
    const video = $("vision-video");
    if (document.hidden || this.frameBusy || video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.frameBusy = true; this.lastVideoTime = video.currentTime;
    const time = performance.now();
    createImageBitmap(video).then((bitmap) => {
      if (epoch !== this.cameraGeneration || !this.worker) { bitmap.close(); return; }
      this.worker.postMessage({ type: "frame", bitmap, time }, [bitmap]);
    }).catch(() => { if (epoch === this.cameraGeneration) { this.frameBusy = false; this.pause("Nie udało się odczytać klatki"); } });
  }
  result(data) {
    const now = performance.now();
    const fps = this.lastResultAt ? 1000 / (now - this.lastResultAt) : 0;
    this.fps = this.fps ? .8 * this.fps + .2 * fps : fps;
    this.lastResultAt = now;
    this.latest = data;
    $("vision-metrics").textContent = `${Math.round(this.fps)} KLATEK/S · ANALIZA ${Math.round(data.inferenceMs)} ms${this.rtt ? `\nPOŁĄCZENIE ${Math.round(this.rtt)} ms` : ""}`;
    const obs = this.observe(data);
    if (document.hidden) { this.pause("Karta ukryta — pauza"); return; }
    if (now - data.time > 250 || !obs.valid) {
      this.calibration = null;
      const reason = obs.reason || "Zbyt duże opóźnienie obrazu";
      this.trackingGap(reason, now);
      this.draw(obs, true);
      this.onState();
      return;
    }
    this.updateDisplay(data, obs);
    this.mapper.filter(obs.values, data.time, obs.reliable);
    if (this.calibration) { this.calibrationFrame(obs, now); return; }
    const allowed = this.gate.update(obs.clutchGesture, data.time);
    if (this.gate.holding) {
      this.freeze(); this.holdStatus(`Chwilowo niepewny gest ${this.side === "right" ? "lewej" : "prawej"} dłoni`, now);
      this.draw(obs, true); return;
    }
    if (!this.gate.latched) this.blockedReason = "";
    this.draw(obs, true);
    if (!allowed) {
      if (this.localActive || this.starting) this.pause("Pozycja i chwyt zachowane — pauza");
      const live = bridge.snapshot().live;
      this.status(live ? (this.gate.arming ? "GOTOWE" : "PAUZA") : "PODGLĄD", live
        ? this.pausedHint(obs)
        : `Rozpoznawanie działa. Włącz „Sterowanie na żywo” u góry, aby poruszać robotem. ${this.pausedHint(obs)}`);
      return;
    }
    if (!this.localActive && !this.starting) { this.begin(obs, data); return; }
    if (!this.localActive) return;
    const snap = bridge.snapshot();
    const joints = snap.state.joints.filter((j) => this.activeIds.includes(j.id));
    const targets = this.mapper.map(joints, this.settings, obs.mainGrip, data.time);
    bridge.preview(targets);
    this.status(this.session ? "AKTYWNE" : "PODGLĄD · RUCH", this.session ? `Otwórz ${this.side === "right" ? "lewą" : "prawą"} dłoń, aby zapauzować` : "To tylko podgląd. Włącz „Sterowanie na żywo” u góry, aby poruszać robotem.", this.session ? "active" : "");
    if (this.session) this.send(targets, data);
  }
  async begin(obs, data) {
    // An earlier start/pause can still be travelling through SSH. Do not race a
    // new session against it; the next fresh camera frame will retry.
    if (this.beginInFlight || this.pauseRequest || this.requestBusy) return;
    const snap = bridge.snapshot();
    if (!snap.connected || !snap.state) { this.block("Brak połączenia — otwórz dłoń po połączeniu"); return; }
    if (snap.switching || snap.state.busy) { this.status("TRZYMAM POZYCJĘ", "Czekam na zakończenie poprzedniego polecenia", "holding"); return; }
    this.activeIds = snap.enabled.filter((id) => !snap.live || snap.state.joints.find((j) => j.id === id)?.pulse !== null);
    if (!this.activeIds.length) { this.block("Zaznacz przeguby robota i jawnie włącz sterowanie na żywo"); return; }
    if (!snap.live) {
      this.mapper.start(bridge.draft()); this.localActive = true; this.draw(); return;
    }
    this.starting = true;
    this.beginInFlight = true;
    const epoch = ++this.generation;
    try {
      const start = performance.now();
      const state = await bridge.command({ action: "gesture_start", ids: this.activeIds, epoch: snap.state.gesture.epoch, frame: data.time, age_ms: Math.max(0, performance.now() - data.time) });
      this.rtt = performance.now() - start;
      if (epoch !== this.generation || !this.gate.active || !bridge.snapshot().live) {
        if (state.gesture.session) await this.endRemote(state.gesture.session);
        return;
      }
      this.session = state.gesture.session; this.seq = 0; this.lastFrameSent = data.time;
      const current = this.latest && this.observe(this.latest);
      if (!current?.valid || performance.now() - this.latest.time > 250 || !this.session) { this.pause("Nieaktualny obraz przy wznawianiu — pauza"); return; }
      this.mapper.start(Object.fromEntries(state.joints.map((j) => [j.id, j.pulse])));
      this.localActive = true; this.lastSend = -Infinity;
      this.draw();
    } catch (error) { if (epoch === this.generation) this.block(error.message); }
    finally { this.beginInFlight = false; if (epoch === this.generation) this.starting = false; }
  }
  async send(targets, data) {
    const now = performance.now();
    if (this.requestBusy || now - this.lastSend < 80 || data.time <= this.lastFrameSent) return;
    const epoch = this.generation;
    this.requestBusy = true; this.lastSend = now; this.lastFrameSent = data.time;
    try {
      await bridge.command({ action: "gesture_follow", session: this.session, seq: ++this.seq, targets: Object.fromEntries(this.activeIds.map((id) => [id, targets[id]])), frame: data.time, age_ms: Math.max(0, performance.now() - data.time) });
      this.rtt = performance.now() - now;
    } catch (error) { if (epoch === this.generation) this.block(error.message); }
    finally { this.requestBusy = false; }
  }
  // A refused start waits for one open palm, so a persistent error cannot loop.
  block(reason) { this.blockedReason = reason; this.pause(reason); this.gate.latch(); }
  endRemote(session) {
    const request = bridge.command({ action: "gesture_pause", session })
      .catch((error) => { this.blockedReason = error.message; this.gate.reset(); })
      .finally(() => { if (this.pauseRequest === request) this.pauseRequest = null; });
    this.pauseRequest = request;
    return request;
  }
  freeze() {
    const session = this.session;
    this.generation++; this.session = null; this.localActive = false; this.starting = false;
    this.mapper.reset();
    if (session) this.endRemote(session);
  }
  holdStatus(reason, now) {
    const remaining = Math.max(0, TRACKING_GRACE_MS - now + this.gate.gapSince);
    this.status("TRZYMAM POZYCJĘ", `${reason}. Czekam na pewną pięść · ${(remaining / 1000).toFixed(1)} s`, "holding");
  }
  trackingGap(reason, now) {
    const recoverable = this.gate.suspend(now);
    this.freeze();
    // Tracking problems are shown only while they last. They must not become a
    // sticky "blocked" message that hides the live guidance once tracking returns.
    if (recoverable) this.holdStatus(reason, now);
    else this.status("UTRATA ŚLEDZENIA", `${reason}. Potem zaciśnij ${this.clutchNames().acc} dłoń w pięść.`, "lost");
  }
  pause(reason) {
    this.freeze(); this.gate.reset();
    this.draw();
    if (reason) this.status("PAUZA", reason);
  }
  updateDisplay(data, obs) {
    const main = { ...obs.main, landmarks: this.visualFilters.main.filter(obs.main.landmarks, data.time) };
    const clutch = { ...obs.clutch, landmarks: this.visualFilters.clutch.filter(obs.clutch.landmarks, data.time) };
    this.displayData = { ...data, hands: [main, clutch], poses: [this.visualFilters.pose.filter(data.poses[0], data.time)] };
    this.displayObservation = { ...obs, main, clutch };
  }
  onState() {
    const snap = bridge.snapshot();
    if (this.session && (!snap.live || !snap.connected || snap.state?.gesture?.session !== this.session)) this.pause("Sesja zakończona — pauza");
    if (this.calibration && snap.live) this.calibration = null;
    $("vision-calibrate").disabled = !this.ready || snap.live || !!this.calibration;
    this.diagnostics();
  }
  calibrate() {
    if (!this.ready || bridge.snapshot().live) { this.status("PODGLĄD", "Wyłącz tryb na żywo i uruchom kamerę przed kalibracją"); return; }
    const obs = this.latest && this.observe(this.latest);
    if (!obs?.valid || obs.clutchGesture !== "Open_Palm" || performance.now() - this.latest.time > 250) { this.status("PODGLĄD", "Pokaż całe ramię i obie dłonie; dłoń zezwalającą trzymaj otwartą"); return; }
    this.pause("Kalibracja bez poruszania serwami");
    this.calibration = { start: performance.now(), count: 0, min: {}, max: {} };
    this.onState();
  }
  calibrationFrame(obs, now) {
    const c = this.calibration;
    if (obs.clutchGesture !== "Open_Palm") { this.calibration = null; this.status("KALIBRACJA PRZERWANA", "Trzymaj otwartą dłoń ręki zezwalającej"); this.onState(); return; }
    c.count++;
    for (const id of AXES) { c.min[id] = Math.min(c.min[id] ?? Infinity, this.mapper.filtered[id]); c.max[id] = Math.max(c.max[id] ?? -Infinity, this.mapper.filtered[id]); }
    this.status("KALIBRACJA", `Poruszaj ręką i nadgarstkiem · pozostało ${Math.max(0, Math.ceil((6000 - now + c.start) / 1000))} s`);
    if (now - c.start < 6000) return;
    const changed = [];
    if (c.count >= 30) for (const id of AXES) {
      const span = c.max[id] - c.min[id];
      if (span >= (id === "S4" ? .15 : .25) && span <= 10) { this.settings[id].span = span; changed.push(id); }
    }
    this.calibration = null; this.saveSettings(); this.pause("Kalibracja zakończona");
    $("vision-calibration-note").textContent = changed.length ? `Zapisano zakresy: ${changed.join(", ")}. Pozostałe osie zachowały dotychczasową czułość. Kalibracja nie zmienia limitów serw.` : "Za mało ruchu lub poprawnych klatek. Zachowano dotychczasową czułość.";
    this.onState();
  }
  draw(obs = null, advanceTrail = false) {
    const canvas = $("vision-overlay"), ctx = canvas.getContext("2d");
    let data = this.latest;
    if (!data) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      delete canvas.dataset.clutchVisual; delete canvas.dataset.mainVisual;
      canvas.setAttribute("aria-label", "Brak rozpoznanych dłoni");
      return;
    }
    obs ||= this.observe(data);
    const holding = this.gate.holding && !!this.stream && !document.hidden;
    const ghost = holding && !obs.valid && !!this.displayData;
    if ((obs.valid || ghost) && this.displayData) { data = this.displayData; obs = this.displayObservation; }
    if (canvas.width !== data.width || canvas.height !== data.height) { canvas.width = data.width; canvas.height = data.height; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = ghost ? .6 : 1;
    const mirror = $("vision-mirror").checked;
    const point = (p) => ({ x: (mirror ? 1 - p.x : p.x) * canvas.width, y: p.y * canvas.height });
    const line = (a, b, color, width = 2) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const ring = (p, r, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); };
    ctx.lineCap = "round"; ctx.shadowColor = "#65f5da"; ctx.shadowBlur = 8;
    const snap = bridge.snapshot();
    const fresh = !ghost && obs.valid && performance.now() - data.time <= 250 && !document.hidden;
    const engaged = fresh && this.localActive && this.gate.active && !holding;
    const active = !!(engaged && this.session && snap.live && snap.connected && snap.state?.gesture?.session === this.session);
    const preview = !!(engaged && !this.session && !snap.live);
    const descriptions = [];
    for (const hand of data.hands) {
      const isClutch = obs.valid && hand === obs.clutch;
      const style = handVisual(hand, { isClutch, active, preview, holding: isClutch && holding && this.gate.active });
      drawHand(ctx, hand, point, style, data.time, canvas.width, canvas.height);
      if (isClutch) canvas.dataset.clutchVisual = style.state;
      if (obs.valid && hand === obs.main) canvas.dataset.mainVisual = style.state;
      if (obs.valid) {
        // Name each hand's role on screen so a left/right swap is obvious at once.
        const { label } = this.clutchNames(), other = label === "Lewa" ? "PRAWA" : "LEWA";
        const tag = isClutch ? `${label.toUpperCase()} · ZEZWOLENIE` : `${other} · RAMIĘ`;
        // Above the hand, clear of the fist halo label drawn below it.
        const ps = hand.landmarks.map(point), cx = ps.reduce((n, p) => n + p.x, 0) / ps.length;
        const top = Math.min(...ps.map((p) => p.y)) - (style.fist ? 48 : 18);
        ctx.save(); ctx.shadowBlur = 0; ctx.font = "600 12px ui-monospace, monospace"; ctx.fillStyle = style.points;
        const tw = ctx.measureText(tag).width;
        ctx.fillText(tag, clamp(cx - tw / 2, 6, canvas.width - tw - 6), clamp(top, 16, canvas.height - 8));
        ctx.restore();
      }
      descriptions.push(`${isClutch ? "Dłoń zezwalająca" : "Dłoń"}: ${style.label || "otwarta"}`);
    }
    if (!obs.valid) { delete canvas.dataset.clutchVisual; delete canvas.dataset.mainVisual; }
    canvas.setAttribute("aria-label", descriptions.join("; ") || "Brak rozpoznanych dłoni");
    const pose = data.poses[0];
    if (pose) {
      for (const [a, b] of [[11,12],[11,13],[13,15],[12,14],[14,16]]) if ((pose[a].visibility ?? 0) > .5 && (pose[b].visibility ?? 0) > .5) line(point(pose[a]), point(pose[b]), "#65f5da88", 3);
      for (const [index, label] of [[poseIndex("shoulder", this.side, this.sourceMirrored),"S2 / BARK"],[poseIndex("elbow", this.side, this.sourceMirrored),"S3 / ŁOKIEĆ"],[poseIndex("wrist", this.side, this.sourceMirrored),"S4 / NADGARSTEK"]]) {
        if ((pose[index].visibility ?? 0) < .5) continue;
        const p = point(pose[index]); ring(p, 22, "#65f5da"); ring(p, 28, "#65f5da33");
        ctx.shadowBlur = 0; ctx.font = "12px ui-monospace, monospace"; ctx.fillStyle = "#b2ffeb";
        ctx.fillText(label, clamp(p.x + 35, 5, canvas.width - 160), clamp(p.y - 12, 20, canvas.height - 10)); ctx.shadowBlur = 8;
      }
    }
    if (obs?.valid && !ghost && $("vision-trails").checked) {
      if (advanceTrail) this.trail.push({ ...point(obs.main.landmarks[0]), time: data.time });
      this.trail = this.trail.filter((p) => data.time - p.time < 650).slice(-20);
      for (let i = 1; i < this.trail.length; i++) line(this.trail[i-1], this.trail[i], `rgba(101,245,218,${i / this.trail.length * .4})`, 2);
    }
    if (obs?.valid) {
      const p = point(obs.main.landmarks[0]);
      const value = this.mapper.filtered?.S4 ?? obs.values.S4;
      ctx.strokeStyle = "#b1ffe9"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, 38, -Math.PI / 2, -Math.PI / 2 + value, value < 0); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

new GestureStudio();
