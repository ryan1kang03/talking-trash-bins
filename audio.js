/* =============================================================================
   audio.js — the SoundEngine: plays every sound the bins make.

   For each event (open, close, full, pleaseRecycle, pleaseWaste) it plays either
     - a recorded file from /sounds (if you added one), or
     - a little synthesized effect + a text-to-speech line in that bin's voice.

   Only one "voice" plays at a time. A more important sound (higher priority)
   cuts off a less important one; a less important one waits its turn.
   ============================================================================= */

const SoundEngine = (() => {
  let ctx = null;          // Web Audio context (created on the Start click — browsers require a click first)
  let master = null;       // master volume node
  let volume = CONFIG.VOLUME;
  let muted = false;
  let voices = [];         // text-to-speech voices installed on this computer
  const fileCache = {};    // file name -> <audio> element, only for files that actually exist
  let current = null;      // the sound playing right now (a "handle", see makeHandle)
  let waiting = null;      // one lower-priority sound waiting for `current` to finish
  const speechListeners = [];   // stage.js listens here to show speech bubbles
  let nextSpeechId = 1;

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // Tell listeners a line started ('start') or stopped ('end'): { id, name, bin, text }
  function onSpeech(fn) { speechListeners.push(fn); }
  function emit(type, info) {
    for (const fn of speechListeners) {
      try { fn(type, info); } catch (err) { console.error(err); }
    }
  }

  /* ---------- setup ---------- */

  async function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
    if (ctx.state === 'suspended') await ctx.resume();

    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      voices = speechSynthesis.getVoices();
      // Chrome loads the voice list a moment later
      speechSynthesis.addEventListener('voiceschanged', () => { voices = speechSynthesis.getVoices(); });
    }

    await preloadFiles();
    return { files: Object.keys(fileCache) };
  }

  // Try to load every file listed in CONFIG.SOUNDS. Missing files are simply skipped.
  function preloadFiles() {
    const names = new Set();
    for (const def of Object.values(CONFIG.SOUNDS)) (def.files || []).forEach(f => names.add(f));
    return Promise.all([...names].map(name => new Promise(resolve => {
      const el = new Audio();
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        if (ok) fileCache[name] = el;
        resolve();
      };
      el.addEventListener('loadeddata', () => finish(true), { once: true });
      el.addEventListener('error', () => finish(false), { once: true });
      setTimeout(() => finish(false), 4000);
      el.preload = 'auto';
      el.src = 'sounds/' + encodeURI(name);
    })));
  }

  /* ---------- the main entry point ---------- */

  // play('close', { bin: 'waste' })
  function play(name, opts = {}) {
    const def = CONFIG.SOUNDS[name];
    if (!def || !ctx) return;
    const priority = def.priority ?? 1;

    if (current && current.active()) {
      if (priority < current.priority) {
        // Something more important is talking — play this right after it.
        waiting = { name, opts, at: performance.now() };
        return;
      }
      current.stop(); // same or higher priority: interrupt
    }

    const text = def.say && def.say.length ? pick(def.say) : '';
    const info = { id: nextSpeechId++, name, bin: opts.bin, text };
    const files = (def.files || []).filter(f => fileCache[f]);
    if (muted) current = playSilent(priority, info);           // muted: bubbles still show
    else if (files.length) current = playFile(pick(files), priority, info);
    else current = playSynthAndVoice(def, priority, opts.bin, text, info);
    emit('start', info);
  }

  function playSilent(priority, info) {
    const handle = makeHandle(priority, () => {}, 5000, info);
    setTimeout(handle.finish, 900 + info.text.length * 55);
    return handle;
  }

  function playWaiting() {
    const w = waiting;
    waiting = null;
    if (w && performance.now() - w.at < CONFIG.QUEUE_MAX_WAIT_MS) play(w.name, w.opts);
  }

  // A handle represents one playing sound so it can be stopped or can report that it finished.
  function makeHandle(priority, stopFn, maxMs, info) {
    const h = {
      priority,
      done: false,
      active: () => !h.done,
      stop() {               // interrupted by another sound
        if (h.done) return;
        h.done = true;
        clearTimeout(h.safety);
        stopFn();
        emit('end', info);
      },
      finish() {             // ended on its own
        if (h.done) return;
        h.done = true;
        clearTimeout(h.safety);
        emit('end', info);
        if (current === h) { current = null; playWaiting(); }
      },
    };
    // Browsers occasionally forget to say a sound ended; don't get stuck forever.
    h.safety = setTimeout(h.finish, maxMs);
    return h;
  }

  /* ---------- recorded files ---------- */

  function playFile(fileName, priority, info) {
    const el = fileCache[fileName];
    const lengthMs = isFinite(el.duration) ? el.duration * 1000 : 6000;
    const handle = makeHandle(priority, () => el.pause(), lengthMs + 800, info);
    el.onended = handle.finish;
    el.volume = volume;
    el.currentTime = 0;
    el.play().catch(handle.finish);
    return handle;
  }

  /* ---------- synth effect + text-to-speech ---------- */

  function playSynthAndVoice(def, priority, binId, text, info) {
    const out = ctx.createGain();   // private output so this sound can be cut off
    out.connect(master);
    const sfxSeconds = def.sfx && SFX[def.sfx] ? SFX[def.sfx](out) : 0;
    const canSpeak = text && 'speechSynthesis' in window;

    let timer = null;
    let speaking = false;
    const maxMs = sfxSeconds * 1000 + (canSpeak ? 2500 + text.length * 150 : 300);
    const handle = makeHandle(priority, () => {
      clearTimeout(timer);
      out.disconnect();
      if (speaking) speechSynthesis.cancel();
    }, maxMs, info);

    if (!canSpeak) {
      timer = setTimeout(handle.finish, sfxSeconds * 1000);
      return handle;
    }

    // Start talking once the sound effect is done (small minimum gap keeps Chrome happy after a cancel()).
    timer = setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      const bin = CONFIG.BINS[binId] || {};
      const voice = voiceFor(binId);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.pitch = bin.pitch ?? 1;
      u.rate = bin.rate ?? 1;
      u.volume = volume;
      u.onend = handle.finish;
      u.onerror = handle.finish;
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      speechSynthesis.resume(); // un-sticks Chrome if it got paused
      speechSynthesis.speak(u);
      speaking = true;
    }, Math.max(40, sfxSeconds * 1000));

    return handle;
  }

  // Pick the first installed English voice that matches the bin's voiceHints.
  function voiceFor(binId) {
    const hints = (CONFIG.BINS[binId] && CONFIG.BINS[binId].voiceHints) || [];
    const english = voices.filter(v => /^en/i.test(v.lang));
    for (const hint of hints) {
      const v = english.find(v => v.name.toLowerCase().includes(hint.toLowerCase()));
      if (v) return v;
    }
    return english.find(v => v.default) || english[0] || null;
  }

  /* ---------- tiny synthesizer for sound effects ---------- */

  // One note that can slide from f0 to f1 Hz.
  function tone(out, { type = 'sine', f0, f1 = null, at = 0, dur = 0.2, gain = 0.3 }) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Each effect plays into `out` and returns how long it lasts (seconds).
  const SFX = {
    gulp(out) {   // two quick downward "bloops" = a swallow
      tone(out, { f0: 520, f1: 140, dur: 0.14, gain: 0.7 });
      tone(out, { f0: 360, f1: 90, at: 0.17, dur: 0.2, gain: 0.7 });
      return 0.4;
    },
    uhoh(out) {   // high-low "uh-oh"
      tone(out, { type: 'triangle', f0: 523, dur: 0.18, gain: 0.5 });
      tone(out, { type: 'triangle', f0: 392, at: 0.22, dur: 0.3, gain: 0.5 });
      return 0.55;
    },
    alarm(out) {  // three beeps
      [0, 0.2, 0.4].forEach(at => tone(out, { type: 'square', f0: 880, at, dur: 0.13, gain: 0.15 }));
      return 0.6;
    },
    ready(out) {  // rising arpeggio when the system starts
      [523, 659, 784, 1047].forEach((f, i) => tone(out, { type: 'triangle', f0: f, at: i * 0.09, dur: 0.18, gain: 0.35 }));
      return 0.5;
    },
  };

  function playSfx(name) {
    if (!ctx || muted || !SFX[name]) return;
    const out = ctx.createGain();
    out.connect(master);
    SFX[name](out);
  }

  /* ---------- volume ---------- */

  function applyVolume() { if (master) master.gain.value = muted ? 0 : volume; }
  function setVolume(v) { volume = v; applyVolume(); }
  function setMuted(m) {
    muted = m;
    applyVolume();
    if (m) {
      waiting = null;
      if (current) { current.stop(); current = null; }
    }
  }

  function voiceName(binId) {
    const v = voiceFor(binId);
    return v ? v.name : 'default voice';
  }

  return { init, play, playSfx, setVolume, setMuted, voiceName, onSpeech, isMuted: () => muted };
})();
