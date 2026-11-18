/* =============================================================================
   vision.js — the camera that decides "recyclable or not?"

   Several times a second it looks at the camera image and writes down the most
   confident thing it recognised and which bin that thing belongs in
   ('recycle' / 'waste'). app.js asks it "what did you see lately?" when a lid opens.

   Two possible brains:
     - COCO-SSD (default): a ready-made object detector (bottle, cup, banana, ...)
     - Teachable Machine: your own model trained on your own demo items
   ============================================================================= */

const Vision = (() => {
  const V = CONFIG.VISION;
  let video = null;
  let canvas = null;
  let g = null;
  let mode = 'off';        // 'coco' | 'tm' | 'off'
  let coco = null;         // COCO-SSD model
  let tm = null;           // { model, labels, size } for Teachable Machine
  let running = false;
  const history = [];      // one entry per analysed frame: { t, category, label, score }
  const listeners = [];

  /* ---------- camera ---------- */

  async function listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }

  async function startCamera(videoEl, canvasEl, deviceId) {
    video = videoEl;
    canvas = canvasEl;
    g = canvas.getContext('2d');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('this browser cannot use the camera here');
    }
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const constraints = { audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } };
    if (deviceId) constraints.video.deviceId = { exact: deviceId };
    video.srcObject = await navigator.mediaDevices.getUserMedia(constraints);
    await video.play();
    const track = video.srcObject.getVideoTracks()[0];
    return track ? track.label || 'Camera on' : 'Camera on';
  }

  function currentDeviceId() {
    const track = video && video.srcObject && video.srcObject.getVideoTracks()[0];
    return track && track.getSettings ? track.getSettings().deviceId : null;
  }

  /* ---------- model ---------- */

  // The machine-learning libraries are downloaded only when the camera is turned on.
  const LIBS = {
    tf: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    coco: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not download ' + src.split('/').pop() + ' (check internet)'));
      document.head.appendChild(s);
    });
  }

  async function loadModel() {
    const url = (V.TEACHABLE_MACHINE_URL || '').trim();
    if (typeof tf === 'undefined') await loadScript(LIBS.tf);
    if (!url && typeof cocoSsd === 'undefined') await loadScript(LIBS.coco);

    if (url) {
      const base = url.endsWith('/') ? url : url + '/';
      const [model, meta] = await Promise.all([
        tf.loadLayersModel(base + 'model.json'),
        fetch(base + 'metadata.json').then(r => r.json()),
      ]);
      tm = { model, labels: meta.labels, size: meta.imageSize || 224 };
      mode = 'tm';
      return 'Teachable Machine: ' + tm.labels.join(' / ');
    }

    if (typeof cocoSsd === 'undefined') throw new Error('COCO-SSD did not load (check internet)');
    coco = await cocoSsd.load({ base: V.COCO_BASE });
    mode = 'coco';
    return 'COCO-SSD object detector';
  }

  /* ---------- the analysis loop ---------- */

  function start() {
    if (running) return;
    running = true;
    loop();
  }

  async function loop() {
    if (!running) return;
    const t0 = performance.now();
    try {
      if (mode !== 'off' && video && video.readyState >= 2 && video.videoWidth > 0) await analyseFrame();
    } catch (err) {
      console.warn('Vision error:', err);
    }
    setTimeout(loop, Math.max(0, V.INTERVAL_MS - (performance.now() - t0)));
  }

  async function analyseFrame() {
    const detections = mode === 'tm' ? await classifyTM() : await detectCOCO();

    // The most confident thing that belongs in one of the bins.
    const best = detections
      .filter(d => d.category && d.score >= V.MIN_SCORE)
      .sort((a, b) => b.score - a.score)[0] || null;

    const now = performance.now();
    history.push({ t: now, category: best ? best.category : null, label: best ? best.label : null, score: best ? best.score : 0 });
    while (history.length && history[0].t < now - 10000) history.shift();   // keep 10 s

    draw(detections);
    const frame = { detections, best, mode };
    listeners.forEach(fn => fn(frame));
  }

  async function detectCOCO() {
    // Low threshold (0.3) so near-misses show up faintly on screen; MIN_SCORE filters the real decision.
    const preds = await coco.detect(video, 10, 0.3);
    return preds.map(p => ({
      label: p.class,
      score: p.score,
      bbox: p.bbox,
      category: V.COCO_MAP[p.class] || null,
    }));
  }

  async function classifyTM() {
    const output = tf.tidy(() => {
      const img = tf.browser.fromPixels(video);
      const [h, w] = img.shape;
      const s = Math.min(h, w);
      // centre square, mirrored like the Teachable Machine webcam, resized to 224x224, scaled to [-1, 1]
      const square = img.slice([Math.floor((h - s) / 2), Math.floor((w - s) / 2), 0], [s, s, 3]);
      const input = tf.image.resizeBilinear(square, [tm.size, tm.size]).reverse(1);
      return tm.model.predict(input.toFloat().div(127).sub(1).expandDims(0));
    });
    const probs = await output.data();
    output.dispose();
    return tm.labels.map((label, i) => ({ label, score: probs[i], category: tmCategory(label) }));
  }

  function tmCategory(label) {
    if (V.TM_MAP[label]) return V.TM_MAP[label];
    const l = label.toLowerCase();
    if (/(non|not)[\s-]*recycl/.test(l)) return 'waste';
    if (l.includes('recycl')) return 'recycle';
    if (/waste|trash|garbage|landfill/.test(l)) return 'waste';
    return null;   // "Nothing", "Background", ...
  }

  // Boxes on top of the camera preview (COCO mode only).
  function draw(detections) {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    g.clearRect(0, 0, w, h);
    if (mode !== 'coco') return;

    g.lineWidth = 3;
    g.font = '600 18px system-ui, sans-serif';
    for (const d of detections) {
      const [x, y, bw, bh] = d.bbox;
      const color = d.category === 'recycle' ? '#2f9bff' : d.category === 'waste' ? '#ff8a3d' : '#9aa0a6';
      const text = `${d.label} ${Math.round(d.score * 100)}%`;
      g.globalAlpha = d.score >= V.MIN_SCORE ? 1 : 0.4;
      g.strokeStyle = color;
      g.strokeRect(x, y, bw, bh);
      const ty = Math.max(0, y - 26);
      g.fillStyle = color;
      g.fillRect(x, ty, g.measureText(text).width + 12, 26);
      g.fillStyle = '#fff';
      g.fillText(text, x + 6, ty + 19);
    }
    g.globalAlpha = 1;
  }

  /* ---------- what app.js asks ---------- */

  // "What item did you see in the last `windowMs`?"  ->  { category, label, score } or null
  // An item counts if it was seen in MIN_FRAMES frames, or once with SURE_SCORE confidence.
  function recentItem(windowMs) {
    const since = performance.now() - windowMs;
    const tally = {};
    for (const h of history) {
      if (h.t < since || !h.category) continue;
      const k = tally[h.category] || (tally[h.category] = { category: h.category, frames: 0, score: 0, label: '' });
      k.frames++;
      if (h.score > k.score) { k.score = h.score; k.label = h.label; }
    }
    const top = Object.values(tally).sort((a, b) => b.frames - a.frames || b.score - a.score)[0];
    if (!top) return null;
    if (top.frames >= V.MIN_FRAMES || top.score >= V.SURE_SCORE) {
      return { category: top.category, label: top.label, score: top.score };
    }
    return null;
  }

  function onFrame(fn) { listeners.push(fn); }

  return { listCameras, startCamera, currentDeviceId, loadModel, start, recentItem, onFrame, mode: () => mode };
})();
