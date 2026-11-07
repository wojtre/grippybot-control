// Model inference stays off the UI thread. No remote resources or camera access.
let recognizer, pose, busy = false;
async function initialize(delegate) {
  const { FilesetResolver, GestureRecognizer, PoseLandmarker } = await import("./vendor/vision_bundle.mjs");
  const vision = await FilesetResolver.forVisionTasks(new URL("./vendor/wasm", self.location.href).href);
  try {
    recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: new URL("./vendor/gesture_recognizer.task", self.location.href).href, delegate },
      runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence: 0.65,
      minHandPresenceConfidence: 0.65, minTrackingConfidence: 0.65,
    });
    pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: new URL("./vendor/pose_landmarker_lite.task", self.location.href).href, delegate },
      runningMode: "VIDEO", numPoses: 2, minPoseDetectionConfidence: 0.65,
      minPosePresenceConfidence: 0.65, minTrackingConfidence: 0.65,
      outputSegmentationMasks: false,
    });
  } catch (error) { recognizer?.close(); pose?.close(); throw error; }
}
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      let delegate = "GPU";
      try { await initialize(delegate); }
      catch { delegate = "CPU"; await initialize(delegate); }
      self.postMessage({ type: "ready", delegate });
    } catch (error) { self.postMessage({ type: "error", message: "Nie udało się uruchomić modeli: " + error.message }); }
  }
  if (data.type !== "frame") return;
  if (busy || !recognizer || !pose) { data.bitmap.close(); return; }
  busy = true;
  const begin = performance.now();
  try {
    const h = recognizer.recognizeForVideo(data.bitmap, data.time);
    const p = pose.detectForVideo(data.bitmap, data.time);
    const hands = h.landmarks.map((landmarks, i) => ({ landmarks, gesture: h.gestures[i]?.[0] ?? null }));
    self.postMessage({ type: "result", time: data.time, width: data.bitmap.width, height: data.bitmap.height,
      poses: p.landmarks, hands, inferenceMs: performance.now() - begin });
  } catch (error) { self.postMessage({ type: "error", message: "Przerwano śledzenie: " + error.message }); }
  finally { data.bitmap.close(); busy = false; }
};
