/* =============================================================================
   vision.js — the camera and the "is this the right bin?" judge.

   judge() takes a photo from the camera and asks a vision-language model which
   bin the item belongs in. It answers { category: 'recycle' | 'waste' | null,
   label, score, ms }  (null category = no item visible / not sure).

   Two possible judges (pick in config.js -> VISION.ENGINE):
     CLIP   - runs inside the browser (transformers.js). Compares the photo with the
              descriptions in CONFIG.VISION.CLIP_LABELS and picks the closest one.
     Claude - sends the photo to the Claude API with the rules in CLAUDE_PROMPT and
              gets back a structured answer { item, bin }.
   ============================================================================= */

const Vision = (() => {
  const V = CONFIG.VISION;
  const LIBS = {
    transformers: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1',
    anthropic: 'https://esm.sh/@anthropic-ai/sdk@1.5.0',
  };
  const KEY_STORAGE = 'trashy-anthropic-api-key';   // kept in this browser only, never in the repo

  let video = null;
  let engine = 'off';      // 'clip' | 'claude' | 'off'
  let clip = null;         // CLIP zero-shot classifier
  let claude = null;       // Anthropic client
  let AnthropicSDK = null; // the SDK module's default export (for its error classes)
  let busy = false;

  /* ---------- camera ---------- */

  async function listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }

  async function startCamera(videoEl, deviceId) {
    video = videoEl;
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

  // Grab the current camera frame as a small JPEG (data URL).
  function snapshot() {
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * scale);
    c.height = Math.round(video.videoHeight * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }

  /* ---------- API key (only for the Claude judge) ---------- */

  function apiKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (e) { return ''; }
  }
  function setApiKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (e) { /* storage blocked */ }
  }

  /* ---------- loading the judge ---------- */

  function chooseEngine() {
    if (V.ENGINE === 'clip') return 'clip';
    if (V.ENGINE === 'claude') return 'claude';
    return apiKey() ? 'claude' : 'clip';
  }

  // onProgress(percent) is called while CLIP downloads.
  async function loadModel(onProgress) {
    engine = 'off';
    clip = null;
    claude = null;
    const want = chooseEngine();

    if (want === 'claude') {
      if (!apiKey()) throw new Error('no Anthropic API key saved (Backstage → Camera check)');
      AnthropicSDK = (await import(LIBS.anthropic)).default;
      // The key is typed into Backstage on the demo laptop and stays in that browser.
      claude = new AnthropicSDK({ apiKey: apiKey(), dangerouslyAllowBrowser: true });
      engine = 'claude';
      return `Claude (${V.CLAUDE_MODEL})`;
    }

    const tf = await import(LIBS.transformers);
    tf.env.allowLocalModels = false;
    tf.env.useBrowserCache = location.protocol !== 'file:';   // the browser cache only works on http(s)
    clip = await tf.pipeline('zero-shot-image-classification', V.CLIP_MODEL, {
      progress_callback: p => {
        if (onProgress && p.status === 'progress' && /\.onnx$/.test(p.file || '')) onProgress(Math.round(p.progress));
      },
    });
    engine = 'clip';
    return 'CLIP (runs in this browser)';
  }

  /* ---------- judging ---------- */

  // Take a photo now (or use `image`, a data URL, for testing) and ask the judge.
  // Returns null when the camera or judge isn't ready, or a check is already running.
  async function judge(image) {
    if (busy || engine === 'off') return null;
    const photo = image || snapshot();
    if (!photo) return null;
    busy = true;
    const t0 = performance.now();
    try {
      const verdict = engine === 'claude' ? await askClaude(photo) : await askClip(photo);
      return verdict && { ...verdict, engine, image: photo, ms: Math.round(performance.now() - t0) };
    } finally {
      busy = false;
    }
  }

  async function askClip(photo) {
    const labels = [];
    const cats = [];
    for (const [cat, list] of Object.entries(V.CLIP_LABELS)) {
      for (const label of list) { labels.push(label); cats.push(cat); }
    }
    const results = await clip(photo, labels, { hypothesis_template: 'a photo of {}.' });  // best first
    const totals = {};
    for (const r of results) {
      const cat = cats[labels.indexOf(r.label)];
      totals[cat] = (totals[cat] || 0) + r.score;
    }
    const best = results[0];
    const cat = cats[labels.indexOf(best.label)];
    const score = totals[cat];
    if (cat === 'none' || score < V.MIN_CONFIDENCE) return { category: null, label: best.label, score };
    return { category: cat, label: best.label, score };
  }

  // Structured output: Claude must answer with exactly this JSON shape.
  const VERDICT_SCHEMA = {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Short name of the item being thrown away, e.g. "plastic bottle". "nothing" if none.' },
      bin: { type: 'string', enum: ['recycle', 'waste', 'none'] },
    },
    required: ['item', 'bin'],
    additionalProperties: false,
  };

  async function askClaude(photo) {
    const request = {
      model: V.CLAUDE_MODEL,
      max_tokens: 2048,
      system: V.CLAUDE_PROMPT,
      output_config: {
        effort: 'low',                                        // a quick judgement, not deep reasoning
        format: { type: 'json_schema', schema: VERDICT_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photo.split(',')[1] } },
          { type: 'text', text: 'Which bin does the item being thrown away belong in?' },
        ],
      }],
    };

    let response;
    try {
      // If the model declines for safety reasons, the API retries on a fallback model.
      response = await claude.beta.messages.create({
        ...request,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      if (!(err instanceof AnthropicSDK.BadRequestError)) throw err;
      console.warn('Retrying without fallbacks:', err.message);
      response = await claude.messages.create(request);
    }

    if (response.stop_reason === 'refusal') return { category: null, label: 'declined', score: 0 };
    const text = response.content.find(b => b.type === 'text');
    if (!text) return null;
    const verdict = JSON.parse(text.text);
    return { category: verdict.bin === 'none' ? null : verdict.bin, label: verdict.item, score: 1 };
  }

  return {
    listCameras, startCamera, currentDeviceId, snapshot,
    loadModel, judge, apiKey, setApiKey,
    engine: () => engine,
  };
})();
