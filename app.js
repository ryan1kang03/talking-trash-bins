/* =============================================================================
   app.js — the "brain": turns Makey Makey key presses + camera results into
   sounds (audio.js) and drawings (stage.js).

     pedal pressed   (key down) -> lid open   -> "Ahhh"  (or "Please recycle!" / "Please
                                                          throw that in the waste bin!" if the
                                                          camera saw the wrong kind of item)
     pedal released  (key up)   -> lid closed -> "Gulp"
     overflow touched (held)    -> bin full   -> "Take out the trash!" (repeats while full)
   ============================================================================= */

const $ = sel => document.querySelector(sel);
const BIN_IDS = Object.keys(CONFIG.BINS);
const LOG_STORAGE_KEY = 'talking-trash-bins-log';
const CAMERA_STORAGE_KEY = 'talking-trash-bins-camera';

/* ---------- state ---------- */

const state = {
  started: false,
  participant: 1,
  log: [],
  bins: {},
};
for (const id of BIN_IDS) {
  state.bins[id] = {
    open: false,
    full: false,
    session: null,          // info about the current lid opening: { openedAt, item, decided, warned }
    deposits: 0,
    warnings: 0,
    overflows: 0,
    timers: { close: null, full: null, clear: null, remind: null },
  };
}

/* ---------- key mapping ---------- */

// 'a' and 'A' are the same Makey Makey input; the space bar is called 'Space'.
function keyName(e) {
  if (e.key === ' ' || e.code === 'Space') return 'Space';
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

const KEYMAP = {};
for (const [key, m] of Object.entries(CONFIG.KEYS)) {
  const k = key === ' ' ? 'Space' : key.length === 1 ? key.toLowerCase() : key;
  if (!CONFIG.BINS[m.bin] || !['pedal', 'overflow'].includes(m.input)) {
    console.error(`config.js KEYS["${key}"] is wrong: bin must be one of ${BIN_IDS.join('/')} and input must be pedal/overflow`);
    continue;
  }
  KEYMAP[k] = m;
}

const PRETTY_KEYS = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space' };
const prettyKey = k => PRETTY_KEYS[k] || k.toUpperCase();

/* ---------- keyboard (= Makey Makey) ---------- */

const keysDown = new Set();

// Capture phase + preventDefault so arrows/space never scroll the page or change a dropdown.
window.addEventListener('keydown', e => {
  const k = keyName(e);
  if (k === '`') { toggleBackstage(); return; }
  const m = KEYMAP[k];
  showLastKey(k, m);
  if (!m) return;
  e.preventDefault();
  if (keysDown.has(k)) return;          // held down: the OS keeps repeating keydown — ignore
  keysDown.add(k);
  highlightKey(k, true);
  if (!state.started) return;
  if (m.input === 'pedal') pedalDown(m.bin);
  else overflowDown(m.bin);
}, true);

window.addEventListener('keyup', e => {
  const k = keyName(e);
  const m = KEYMAP[k];
  if (!m) return;
  e.preventDefault();
  if (!keysDown.has(k)) return;
  keysDown.delete(k);
  highlightKey(k, false);
  if (!state.started) return;
  if (m.input === 'pedal') pedalUp(m.bin);
  else overflowUp(m.bin);
}, true);

// Key presses only reach the page while its window is focused.
window.addEventListener('blur', () => {
  $('#focus-banner').hidden = false;
  keysDown.clear();
  document.querySelectorAll('kbd.is-down').forEach(el => el.classList.remove('is-down'));
  // We won't hear key-ups while unfocused, so quietly reset open lids and pending timers.
  for (const id of BIN_IDS) {
    const bin = state.bins[id];
    for (const t of ['close', 'full', 'clear']) { clearTimeout(bin.timers[t]); bin.timers[t] = null; }
    if (bin.open) { bin.open = false; bin.session = null; Stage.reset(id); }
  }
  render();
});
window.addEventListener('focus', () => { $('#focus-banner').hidden = true; });

/* ---------- pedal: open / close the lid ---------- */

function pedalDown(id) {
  const bin = state.bins[id];
  if (bin.timers.close) {               // contact flickered — the lid never really closed
    clearTimeout(bin.timers.close);
    bin.timers.close = null;
    return;
  }
  if (!bin.open) openLid(id);
}

function pedalUp(id) {
  const bin = state.bins[id];
  if (!bin.open || bin.timers.close) return;
  bin.timers.close = setTimeout(() => {
    bin.timers.close = null;
    closeLid(id);
  }, CONFIG.PEDAL_DEBOUNCE_MS);
}

function openLid(id) {
  const bin = state.bins[id];
  const item = Vision.recentItem(CONFIG.VISION.LOOKBACK_MS);   // what was held up just before stepping
  bin.open = true;
  bin.session = { openedAt: performance.now(), item, decided: !!item, warned: false };
  logEvent(id, 'lid_open', item);
  Stage.lidOpen(id);

  if (item && item.category !== id) warnWrongBin(id, item);
  else SoundEngine.play('open', { bin: id });
  render();
}

function closeLid(id) {
  const bin = state.bins[id];
  const s = bin.session;
  bin.open = false;
  bin.session = null;
  bin.deposits++;
  Stage.lidClose(id, s && s.item ? s.item.category : null);
  SoundEngine.play('close', { bin: id });
  logEvent(id, 'lid_close', s && s.item, { lid_open_ms: s ? Math.round(performance.now() - s.openedAt) : '' });
  render();
}

function warnWrongBin(id, item) {
  const bin = state.bins[id];
  bin.session.warned = true;
  bin.warnings++;
  Stage.warn(id);
  // Recyclable item at the waste bin -> "Please recycle!"; anything else -> "Please throw that in the waste bin!"
  SoundEngine.play(item.category === 'recycle' ? 'pleaseRecycle' : 'pleaseWaste', { bin: id });
  logEvent(id, 'wrong_bin_warning', item);
  render();
}

// If nothing was recognised when the lid opened, keep watching while it's open
// (the item may only come into view now). Each opening is judged once.
Vision.onFrame(frame => {
  renderSeeing(frame);
  for (const id of BIN_IDS) {
    const bin = state.bins[id];
    if (!bin.open || !bin.session || bin.session.decided) continue;
    const item = Vision.recentItem(CONFIG.VISION.LIVE_WINDOW_MS);
    if (!item) continue;
    bin.session.item = item;
    bin.session.decided = true;
    if (item.category !== id) warnWrongBin(id, item);
  }
});

/* ---------- overflow sensor ---------- */

function overflowDown(id) {
  const bin = state.bins[id];
  const t = bin.timers;
  if (t.clear) { clearTimeout(t.clear); t.clear = null; return; }   // flicker while already full
  if (bin.full || t.full) return;
  t.full = setTimeout(() => { t.full = null; setFull(id, true); }, CONFIG.OVERFLOW_CONFIRM_MS);
}

function overflowUp(id) {
  const bin = state.bins[id];
  const t = bin.timers;
  if (t.full) { clearTimeout(t.full); t.full = null; return; }      // just a brush, not really full
  if (bin.full && !t.clear) {
    t.clear = setTimeout(() => { t.clear = null; setFull(id, false); }, CONFIG.OVERFLOW_CONFIRM_MS);
  }
}

function setFull(id, full) {
  const bin = state.bins[id];
  bin.full = full;
  Stage.setFull(id, full);
  clearInterval(bin.timers.remind);
  bin.timers.remind = null;
  if (full) {
    bin.overflows++;
    SoundEngine.play('full', { bin: id });
    const every = CONFIG.OVERFLOW_REMIND_EVERY_SEC;
    if (every > 0) {
      bin.timers.remind = setInterval(() => {
        if (!bin.open) SoundEngine.play('full', { bin: id });
      }, every * 1000);
    }
  }
  logEvent(id, full ? 'overflow_detected' : 'overflow_cleared');
  render();
}

/* ---------- speech bubbles follow whatever the bins say ---------- */

SoundEngine.onSpeech((type, info) => {
  if (type === 'start') Stage.say(info.bin, info.text, info.name, info.id);
  else Stage.unsay(info.id);
});

/* ---------- event log (for your observation sessions) ---------- */

const LOG_COLUMNS = ['time', 'participant', 'bin', 'event', 'item', 'item_category', 'confidence', 'lid_open_ms'];

function logEvent(binId, event, item, extra = {}) {
  const entry = {
    time: new Date().toISOString(),
    participant: state.participant,
    bin: binId,
    event,
    item: item ? item.label : '',
    item_category: item ? item.category : '',
    confidence: item ? item.score.toFixed(2) : '',
    lid_open_ms: '',
    ...extra,
  };
  state.log.push(entry);
  saveLog();
  renderLogEntry(entry);
}

function saveLog() {
  try { localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(state.log)); } catch (e) { /* storage blocked: log still works in memory */ }
}

function restoreLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(saved) && saved.length) {
      state.log = saved;
      state.participant = saved[saved.length - 1].participant || 1;
      saved.forEach(renderLogEntry);
    }
  } catch (e) { /* ignore */ }
}

function downloadCsv() {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [LOG_COLUMNS.join(','), ...state.log.map(r => LOG_COLUMNS.map(c => esc(r[c])).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
  a.download = `trash-bin-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function nextParticipant() {
  state.participant++;
  for (const id of BIN_IDS) Object.assign(state.bins[id], { deposits: 0, warnings: 0, overflows: 0 });
  logEvent('', 'participant_start');
  render();
}

function clearLog() {
  if (!confirm('Delete the whole event log? (Download the CSV first if you need it.)')) return;
  state.log = [];
  state.participant = 1;
  saveLog();
  $('#log').innerHTML = '';
  for (const id of BIN_IDS) Object.assign(state.bins[id], { deposits: 0, warnings: 0, overflows: 0 });
  render();
}

/* ---------- backstage screen ---------- */

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildBinsTable() {
  const body = $('#bins-table tbody');
  for (const id of BIN_IDS) {
    const b = CONFIG.BINS[id];
    const keysFor = input => Object.entries(KEYMAP)
      .filter(([, m]) => m.bin === id && m.input === input)
      .map(([k]) => `<kbd data-key="${escapeHtml(k)}">${escapeHtml(prettyKey(k))}</kbd>`)
      .join(' ') || '<span class="muted">—</span>';
    body.insertAdjacentHTML('beforeend', `
      <tr id="row-${escapeHtml(id)}">
        <td><span class="bin-name" style="color:${escapeHtml(b.color || 'inherit')}">${escapeHtml(b.label || id)}</span>
            <div class="muted" data-voice style="font-size:13px"></div></td>
        <td>${keysFor('pedal')}</td>
        <td>${keysFor('overflow')}</td>
        <td data-stat="deposits">0</td>
        <td data-stat="warnings">0</td>
        <td data-stat="overflows">0</td>
      </tr>`);
  }
}

function render() {
  for (const id of BIN_IDS) {
    const bin = state.bins[id];
    const row = $(`#row-${CSS.escape(id)}`);
    if (row) for (const stat of ['deposits', 'warnings', 'overflows']) row.querySelector(`[data-stat="${stat}"]`).textContent = bin[stat];
    Stage.setTally(id, bin.deposits);
  }
  $('#participant').textContent = state.participant;
}

function renderLogEntry(entry) {
  const li = document.createElement('li');
  const time = new Date(entry.time).toLocaleTimeString();
  const bin = entry.bin ? (CONFIG.BINS[entry.bin] ? CONFIG.BINS[entry.bin].label || entry.bin : entry.bin) : '';
  const item = entry.item ? ` — ${entry.item} (${entry.item_category}, ${Math.round(entry.confidence * 100)}%)` : '';
  const held = entry.lid_open_ms ? ` — open ${(entry.lid_open_ms / 1000).toFixed(1)} s` : '';
  li.className = 'ev ev--' + entry.event;
  li.innerHTML = `<time>${time}</time><span class="p">P${entry.participant}</span><span>${escapeHtml(bin)}</span><b>${escapeHtml(entry.event.replace(/_/g, ' '))}</b><span class="muted">${escapeHtml(item + held)}</span>`;
  const list = $('#log');
  list.prepend(li);
  while (list.children.length > 200) list.lastChild.remove();
}

function renderSeeing(frame) {
  const item = frame.best;
  $('#seeing').textContent = item
    ? `I see a ${item.label} → ${(CONFIG.BINS[item.category] || {}).label || item.category}!`
    : 'looking…';
}

function highlightKey(k, down) {
  document.querySelectorAll(`kbd[data-key="${CSS.escape(k)}"]`).forEach(el => el.classList.toggle('is-down', down));
}

function showLastKey(k, m) {
  const el = $('#last-key');
  if (m) el.textContent = `Last input: ${prettyKey(k)} = ${CONFIG.BINS[m.bin].label || m.bin} ${m.input}`;
  else if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(k)) el.textContent = `Last input: ${prettyKey(k)} (not mapped in config.js)`;
}

function setChip(name, status, text) {
  const chip = $(`#chip-${name}`);
  chip.dataset.status = status;
  chip.querySelector('span').textContent = text;
  chip.title = text;
}

function toggleBackstage(force) {
  const panel = $('#backstage');
  panel.hidden = force === undefined ? !panel.hidden : !force;
  if (document.activeElement) document.activeElement.blur();
}

/* ---------- start-up ---------- */

async function start() {
  const btn = $('#start-btn');
  btn.disabled = true;
  btn.textContent = 'waking up…';

  try {
    const info = await SoundEngine.init();
    setChip('sound', 'ok', info.files.length ? `Sound on · ${info.files.length} recorded file(s)` : 'Sound on · text-to-speech');
  } catch (err) {
    setChip('sound', 'bad', 'Sound failed: ' + err.message);
  }

  state.started = true;
  $('#start-overlay').hidden = true;
  btn.blur();
  Stage.wake();
  SoundEngine.playSfx('ready');
  keepAwake();
  logEvent('', 'system_start');
  setTimeout(showVoices, 800);   // voices list arrives a moment after start in Chrome

  if (!CONFIG.VISION.ENABLED) return;   // audio + Makey Makey only
  setChip('camera', 'wait', 'Waiting for camera permission…');
  setChip('model', 'wait', 'Loading model…');
  Vision.start();   // the loop simply idles until both the camera and the model are ready
  const savedCamera = (() => { try { return localStorage.getItem(CAMERA_STORAGE_KEY); } catch (e) { return null; } })();
  startCamera(savedCamera).then(ok => { if (!ok && savedCamera) startCamera(null); });
  Vision.loadModel()
    .then(name => setChip('model', 'ok', name))
    .catch(err => setChip('model', 'bad', 'Model failed: ' + err.message));
}

async function startCamera(deviceId) {
  try {
    const label = await Vision.startCamera($('#video'), $('#overlay'), deviceId);
    setChip('camera', 'ok', label);
    await fillCameraList();
    return true;
  } catch (err) {
    const why = err.name === 'NotAllowedError' ? 'permission denied — allow the camera in the address bar'
      : err.name === 'NotFoundError' ? 'no camera found'
      : err.message;
    setChip('camera', 'bad', 'Camera: ' + why);
    $('#seeing').textContent = 'no camera :(';
    return false;
  }
}

async function fillCameraList() {
  const sel = $('#camera-select');
  const cams = await Vision.listCameras();
  sel.innerHTML = cams.map((c, i) => `<option value="${escapeHtml(c.deviceId)}">${escapeHtml(c.label || 'Camera ' + (i + 1))}</option>`).join('');
  const active = Vision.currentDeviceId();
  if (active) sel.value = active;
  sel.disabled = cams.length < 2;
}

function showVoices() {
  for (const id of BIN_IDS) {
    const el = $(`#row-${CSS.escape(id)} [data-voice]`);
    if (el) el.textContent = 'voice: ' + SoundEngine.voiceName(id);
  }
}

let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not available */ }
  if (wakeLock) wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
}
document.addEventListener('visibilitychange', () => {
  if (state.started && document.visibilityState === 'visible') keepAwake();
});

/* ---------- controls ---------- */

function buildSoundCheck() {
  const wrap = $('#sound-check');
  const sel = $('#sound-check-bin');
  sel.innerHTML = BIN_IDS.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(CONFIG.BINS[id].label || id)}</option>`).join('');
  for (const name of Object.keys(CONFIG.SOUNDS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ink-btn small ghost';
    b.textContent = name;
    b.addEventListener('click', () => { SoundEngine.play(name, { bin: sel.value }); b.blur(); });
    wrap.appendChild(b);
  }
}

// Buttons/sliders shouldn't keep focus (so a Makey Makey Space press can't "click" them).
const blurAfter = (el, fn) => el.addEventListener(el.tagName === 'BUTTON' ? 'click' : 'change', e => { fn(e); el.blur(); });

$('#start-overlay').addEventListener('click', () => { if (!state.started && !$('#start-btn').disabled) start(); });
blurAfter($('#backstage-btn'), () => toggleBackstage());
blurAfter($('#backstage-close'), () => toggleBackstage(false));
blurAfter($('#mute-btn'), () => {
  const m = !SoundEngine.isMuted();
  SoundEngine.setMuted(m);
  $('#mute-btn').textContent = m ? 'unmute' : 'mute';
  $('#mute-btn').setAttribute('aria-pressed', m);
});
$('#volume').addEventListener('input', e => SoundEngine.setVolume(Number(e.target.value)));
$('#volume').addEventListener('change', e => e.target.blur());
$('#volume').value = CONFIG.VOLUME;
blurAfter($('#camera-select'), e => {
  try { localStorage.setItem(CAMERA_STORAGE_KEY, e.target.value); } catch (err) { /* ignore */ }
  startCamera(e.target.value);
});
blurAfter($('#download-log'), downloadCsv);
blurAfter($('#next-participant'), nextParticipant);
blurAfter($('#clear-log'), clearLog);

document.body.classList.add(CONFIG.VISION.ENABLED ? 'has-vision' : 'no-vision');
Stage.init($('#stage-art'), $('#stage-overlay'));
buildBinsTable();
buildSoundCheck();
restoreLog();
render();
