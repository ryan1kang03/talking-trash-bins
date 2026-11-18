/* =============================================================================
   stage.js — the drawn, animated side of the system (what people SEE).

   Two hand-inked bin characters live on a paper "stage". app.js tells the stage
   what happened (lid opened, lid closed, bin full, wrong item...) and the stage
   picks the matching pose:

     sleep  – before Start (eyes closed, z z z)
     idle   – breathing, small smile, googly eyes that rattle now and then
     ahhh   – lid open, mouth wide open, arms up        (pedal pressed)
     gulp   – an item drops in, lid shuts, cheeks puff  (pedal released)
     full   – stuffed: items poke out, lid ajar, stink lines, holding the lid
     warn   – stern face, points at the OTHER bin       (camera saw the wrong item)

   Everything is drawn as SVG (paths below) so it can move. The trash items are
   ink drawings made with Higgsfield (see /art). The wobbly hand-drawn feel comes
   from an SVG "line boil" filter that re-jitters the ink a few times a second.
   ============================================================================= */

const Stage = (() => {
  const W = 1600;
  const H = 900;
  const FLOOR_Y = 800;
  const BIN_SCALE = 1.1;
  const RIM_Y = -322;                 // top of the bin body in the bin's own coordinates
  const MOODS = ['sleep', 'idle', 'ahhh', 'gulp', 'full', 'warn'];
  const L = CONFIG.LOOK || {};

  const bins = {};                    // id -> { el, x, side, open, full, pedal, asleep, warnUntil, gulpUntil, timer }
  let svg = null;
  let overlay = null;

  /* ---------- the drawing (all coordinates are the bin's own: 0,0 = bottom centre) ---------- */

  const BODY = 'M -120 -6 C -127 -110 -134 -214 -141 -318 Q -2 -330 142 -320 C 135 -214 128 -110 121 -6 Q 0 4 -120 -6 Z';
  const RIM = 'M -148 -322 Q 0 -334 149 -323 L 147 -297 Q 0 -307 -146 -296 Z';
  const LID = 'M -152 0 C -150 -30 -110 -50 -2 -55 C 110 -53 150 -30 153 0 Q 0 9 -152 0 Z';
  const PEDAL = 'M -46 -4 Q 0 -8 46 -6 L 54 16 Q 0 22 -54 18 Z';

  // Two slightly mismatched googly eyes. room = how far the loose pupil can roll from the centre.
  const GOOGLY = [
    { cx: -44, cy: -228, r: 28, pupil: 12, room: 13 },
    { cx: 46, cy: -225, r: 23, pupil: 10, room: 10 },
  ];

  const hand = (x, y) => `<circle class="ink paper" cx="${x}" cy="${y}" r="9"/>`;

  // d = direction toward the OTHER bin (+1 = right, -1 = left)
  function binMarkup(id, color, items, d) {
    const arm = (path, hx, hy, extra = '') => `<path class="ink" d="${path}"/>${extra}${hand(hx, hy)}`;
    const mirror = path => path.replace(/(-?\d+(\.\d+)?) (-?\d+(\.\d+)?)/g, (m, x, _a, y) => `${-x} ${y}`);
    const both = (path, hx, hy) => arm(path, hx, hy) + arm(mirror(path), -hx, hy);
    const [i0, i1, i2] = [items[0], items[1] || items[0], items[2] || items[0]];

    return `
    <g class="bin__shake"><g class="bin__squash"><g class="bin__idle">

      <!-- stink lines (full) -->
      <g class="stink v m-full">
        <path class="ink thin" d="M -70 -390 q -12 -18 0 -36 q 12 -18 0 -36"/>
        <path class="ink thin" d="M 0 -404 q -12 -18 0 -36 q 12 -18 0 -36"/>
        <path class="ink thin" d="M 70 -390 q -12 -18 0 -36 q 12 -18 0 -36"/>
      </g>

      <!-- items poking out of a full bin -->
      <g class="overflow">
        <image href="${i0}" x="-150" y="-430" width="120" height="120" transform="rotate(-22 -90 -370)"/>
        <image href="${i1}" x="-50" y="-455" width="120" height="120" transform="rotate(8 10 -395)"/>
        <image href="${i2}" x="40" y="-425" width="110" height="110" transform="rotate(26 95 -370)"/>
      </g>

      <!-- body: flat colour printed slightly off the ink line, like a riso print -->
      <path class="spot" d="${BODY}" fill="${color}" transform="translate(9 7)"/>
      <ellipse class="hole" cx="0" cy="${RIM_Y}" rx="136" ry="15"/>
      <path class="ink" d="${BODY}"/>
      <path class="ink thin" d="M -100 -278 C -103 -200 -104 -120 -100 -40"/>
      <path class="ink thin" d="M 102 -280 C 104 -200 103 -118 99 -38"/>
      <path class="spot" d="${RIM}" fill="${color}" transform="translate(7 5)"/>
      <path class="ink" d="${RIM}"/>

      <!-- face -->
      <g class="face">
        <g class="blush v m-idle m-ahhh m-gulp m-sleep">
          <ellipse cx="-66" cy="-190" rx="14" ry="7"/><ellipse cx="66" cy="-190" rx="14" ry="7"/>
        </g>
        <!-- googly eyes: the pupils are loose and bounce around (physics at the bottom of this file) -->
        <g class="googly v m-idle m-ahhh m-gulp m-full m-warn">
          <circle class="sclera" cx="${GOOGLY[0].cx}" cy="${GOOGLY[0].cy}" r="${GOOGLY[0].r}"/>
          <circle class="sclera" cx="${GOOGLY[1].cx}" cy="${GOOGLY[1].cy}" r="${GOOGLY[1].r}"/>
          <circle class="pupil" data-eye="0" cx="${GOOGLY[0].cx}" cy="${GOOGLY[0].cy + GOOGLY[0].room}" r="${GOOGLY[0].pupil}"/>
          <circle class="pupil" data-eye="1" cx="${GOOGLY[1].cx}" cy="${GOOGLY[1].cy + GOOGLY[1].room}" r="${GOOGLY[1].pupil}"/>
        </g>
        <g class="v m-sleep">
          <path class="ink" d="M -68 -226 Q -44 -210 -20 -226"/><path class="ink" d="M 26 -224 Q 46 -210 66 -224"/>
        </g>
        <g class="v m-full">
          <path class="ink sweat" d="M 104 -276 Q 92 -256 104 -246 Q 116 -256 104 -276 Z"/>
        </g>
        <g class="v m-ahhh">
          <path class="ink" d="M -68 -270 Q -44 -284 -20 -270"/><path class="ink" d="M 26 -266 Q 46 -280 66 -266"/>
        </g>
        <g class="v m-warn">
          <path class="ink" d="M -72 -282 L -22 -264"/><path class="ink" d="M 70 -278 L 26 -262"/>
        </g>

        <!-- mouths -->
        <path class="ink v m-idle" d="M -32 -170 Q 0 -146 32 -170"/>
        <g class="v m-ahhh">
          <path class="ink inkfill" d="M -42 -180 Q 0 -188 42 -180 Q 38 -110 0 -106 Q -38 -110 -42 -180 Z"/>
          <path class="tongue" d="M -22 -122 Q 0 -146 22 -122 Q 0 -110 -22 -122 Z"/>
        </g>
        <path class="ink v m-gulp" d="M -16 -167 Q 0 -157 16 -167"/>
        <path class="ink v m-full" d="M -36 -164 q 9 -9 18 0 t 18 0 t 18 0 t 18 0"/>
        <path class="ink inkfill v m-warn" d="M -26 -174 Q 0 -180 26 -174 Q 22 -146 0 -144 Q -22 -146 -26 -174 Z"/>
        <path class="ink v m-sleep" d="M -10 -166 Q 0 -160 10 -166"/>
      </g>

      <!-- arms -->
      <g class="v m-idle m-sleep">${both('M -132 -190 C -158 -170 -166 -140 -160 -108', -160, -108)}</g>
      <g class="v m-ahhh">${both('M -132 -196 C -168 -214 -186 -250 -184 -290', -184, -290)}</g>
      <g class="v m-gulp">${both('M -132 -186 C -150 -150 -122 -120 -90 -124', -90, -124)}</g>
      <g class="v m-full">${both('M -132 -200 C -176 -232 -178 -300 -156 -338', -156, -338)}</g>
      <g class="v m-warn">
        ${arm(`M ${132 * d} -196 C ${170 * d} -204 ${210 * d} -214 ${250 * d} -214`, 250 * d, -214,
              `<path class="ink" d="M ${262 * d} -214 L ${288 * d} -217"/>`)}
        ${arm(`M ${-132 * d} -184 C ${-168 * d} -170 ${-160 * d} -132 ${-128 * d} -128`, -128 * d, -128)}
      </g>

      <!-- lid -->
      <g transform="translate(0 ${RIM_Y})">
        <g class="lid">
          <path class="spot" d="${LID}" fill="${color}" transform="translate(8 6)"/>
          <path class="ink" d="${LID}"/>
          <path class="ink paper" d="M -20 -54 C -20 -74 20 -74 20 -54"/>
        </g>
      </g>

      <!-- z z z -->
      <g class="zzz v m-sleep">
        <text x="${110 * -d}" y="-380">z</text><text x="${150 * -d}" y="-430">z</text><text x="${195 * -d}" y="-490">Z</text>
      </g>

    </g></g></g>

    <!-- the foot pedal (yellow: the thing you step on) -->
    <g class="pedal">
      <path class="spot" d="${PEDAL}" fill="#f7c948" transform="translate(5 4)"/>
      <path class="ink" d="${PEDAL}"/>
    </g>`;
  }

  /* ---------- build the stage ---------- */

  function init(svgEl, overlayEl) {
    svg = svgEl;
    overlay = overlayEl;
    const ids = Object.keys(CONFIG.BINS);
    const n = ids.length;
    let html = `
      <path class="ink floor" d="M 90 ${FLOOR_Y} q 200 -7 400 -1 t 400 2 t 400 -3 t 220 1"/>
      <path class="ink thin" d="M 300 ${FLOOR_Y + 14} l 30 0 M 760 ${FLOOR_Y + 12} l 50 0 M 1260 ${FLOOR_Y + 15} l 34 0"/>
      <image class="title" href="art/title.png" x="500" y="10" width="600" height="220"/>`;

    ids.forEach((id, i) => {
      const b = CONFIG.BINS[id];
      const x = Math.round(W * (i + 1) / (n + 1));
      const side = i < n / 2 ? -1 : 1;            // which side the lid opens toward / bubble sits
      const items = (b.items && b.items.length) ? b.items : ['art/paper.png'];
      html += `
        <g class="bin mood-sleep" id="bin-${id}" data-bin="${id}" transform="translate(${x} ${FLOOR_Y}) scale(${BIN_SCALE})"
           style="--open:${side < 0 ? 34 : -34}deg; --ajar:${side < 0 ? 11 : -11}deg; --hinge:${side < 0 ? '100% 100%' : '0% 100%'}">
          ${binMarkup(id, b.color || '#9aa0a6', items, -side)}
        </g>
        <text class="lettering" x="${x - 20}" y="${FLOOR_Y + 66}" text-anchor="middle">${escape(b.label || id)}</text>
        <g class="tally" id="tally-${id}" transform="translate(${x + 85} ${FLOOR_Y + 26})"></g>`;
      bins[id] = { x, side, dir: -side, mood: 'sleep', open: false, full: false, pedal: false, asleep: true, warnUntil: 0, gulpUntil: 0, timer: null };
    });
    svg.innerHTML = html;
    ids.forEach(id => {
      bins[id].el = svg.querySelector(`#bin-${CSS.escape(id)}`);
      bins[id].el.querySelectorAll('.pupil').forEach(el => {
        const g = GOOGLY[+el.dataset.eye];
        pupils.push({ el, bin: id, cx: g.cx, cy: g.cy, room: g.room, x: 0, y: g.room, vx: 0, vy: 0, px: 0, py: g.room, phase: Math.random() * 6 });
      });
    });

    buildBubbles(ids);
    buildDecor();
    startGoogly();
    startBoil();
  }

  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- moods ---------- */

  function moodOf(b) {
    const now = performance.now();
    if (b.asleep) return 'sleep';
    if (b.warnUntil > now) return 'warn';
    if (b.gulpUntil > now) return 'gulp';
    if (b.open) return 'ahhh';
    if (b.full) return 'full';
    return 'idle';
  }

  function refresh(id) {
    const b = bins[id];
    if (!b) return;
    const m = moodOf(b);
    b.mood = m;
    MOODS.forEach(x => b.el.classList.toggle('mood-' + x, x === m));
    b.el.classList.toggle('is-open', b.open);
    b.el.classList.toggle('is-full', b.full);
    b.el.classList.toggle('pedal-down', b.pedal);
    clearTimeout(b.timer);
    const now = performance.now();
    const next = [b.warnUntil, b.gulpUntil].filter(t => t > now).sort((p, q) => p - q)[0];
    if (next) b.timer = setTimeout(() => refresh(id), next - now + 20);
  }

  // Restart a one-shot CSS animation class.
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
  }

  function lidOpen(id) {
    const b = bins[id];
    if (!b) return;
    b.open = true;
    b.pedal = true;
    kick(id, 0, -340);                                   // eyes fly up as the lid pops
    refresh(id);
  }

  function lidClose(id, category) {
    const b = bins[id];
    if (!b) return;
    b.open = false;
    b.pedal = false;
    b.gulpUntil = performance.now() + 1200;
    dropItem(id, category);
    replay(b.el.querySelector('.bin__squash'), 'gulping');
    setTimeout(() => kick(id, 0, 420), 300);             // squash: eyes slam down…
    setTimeout(() => kick(id, 0, -380), 470);            // …stretch: and bounce back up
    refresh(id);
  }

  function setFull(id, full) {
    const b = bins[id];
    if (!b) return;
    b.full = full;
    if (full) kick(id, 0, -420);
    refresh(id);
  }

  function warn(id) {
    const b = bins[id];
    if (!b) return;
    b.warnUntil = performance.now() + 2600;
    replay(b.el.querySelector('.bin__shake'), 'shaking');
    [0, 100, 200, 300].forEach((t, i) => setTimeout(() => kick(id, (i % 2 ? 1 : -1) * 380, -80), t));
    refresh(id);
  }

  function reset(id) {
    const b = bins[id];
    if (!b) return;
    b.open = false;
    b.pedal = false;
    refresh(id);
  }

  function wake() {
    Object.keys(bins).forEach((id, i) => {
      setTimeout(() => {
        bins[id].asleep = false;
        replay(bins[id].el.querySelector('.bin__squash'), 'waking');
        refresh(id);
        kick(id, 0, -480);
      }, i * 180);
    });
  }

  /* ---------- googly-eye physics ----------
     Each pupil is a little ball rolling inside its eye. Gravity pulls it down,
     kick() throws it around, and it bounces off the eye's rim. Each pose leans
     the pupils a different way: up for "ahhh", toward the other bin for "warn",
     shaken back and forth for "full". */

  const pupils = [];
  const GRAVITY = 950;      // pulls pupils to the bottom of the eye
  const BOUNCE = 0.55;      // how much speed survives hitting the rim
  const AIR = 0.8;          // drag while flying
  const RIM_FRICTION = 6;   // drag while rolling along the rim

  // Throw both pupils of a bin, each a bit differently (that's what makes them googly).
  function kick(id, vx, vy) {
    for (const p of pupils) {
      if (p.bin !== id) continue;
      p.vx += vx * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 260;
      p.vy += vy * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 120;
    }
  }

  function startGoogly() {
    let last = performance.now();
    const frame = now => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      for (const p of pupils) {
        const b = bins[p.bin];
        if (b.mood === 'sleep') continue;
        let ax = 0;
        let ay = GRAVITY;
        if (b.mood === 'ahhh') ay = -560;                                   // looking up
        else if (b.mood === 'warn') { ax = b.dir * 1300; ay = 250; }        // glaring at the other bin
        else if (b.mood === 'full') ax = Math.sin(t * 12 + p.phase) * 2200; // rattled
        for (let s = 0; s < 2; s++) {
          const h = dt / 2;
          p.vx = (p.vx + ax * h) * (1 - AIR * h);
          p.vy = (p.vy + ay * h) * (1 - AIR * h);
          p.x += p.vx * h;
          p.y += p.vy * h;
          const d = Math.hypot(p.x, p.y);
          if (d > p.room) {
            const nx = p.x / d;
            const ny = p.y / d;
            p.x = nx * p.room;
            p.y = ny * p.room;
            const vn = p.vx * nx + p.vy * ny;
            if (vn > 0) { p.vx -= (1 + BOUNCE) * vn * nx; p.vy -= (1 + BOUNCE) * vn * ny; }
            p.vx *= 1 - RIM_FRICTION * h;
            p.vy *= 1 - RIM_FRICTION * h;
          }
        }
        if (Math.abs(p.x - p.px) > 0.05 || Math.abs(p.y - p.py) > 0.05) {
          p.el.setAttribute('cx', (p.cx + p.x).toFixed(2));
          p.el.setAttribute('cy', (p.cy + p.y).toFixed(2));
          p.px = p.x;
          p.py = p.y;
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // Every so often a bin's eyes give a little rattle on their own.
    setInterval(() => {
      for (const [id, b] of Object.entries(bins)) {
        if (b.mood !== 'sleep' && Math.random() < 0.05) kick(id, (Math.random() - 0.5) * 300, -160);
      }
    }, 400);
  }

  /* ---------- tally marks under each bin (items fed) ---------- */

  function setTally(id, count) {
    const g = svg.querySelector(`#tally-${CSS.escape(id)}`);
    if (!g) return;
    const wob = k => Math.sin(k * 12.9898) * 3;     // fixed little wobble per stroke
    let out = '';
    const shown = Math.min(count, 20);
    for (let i = 0; i < shown; i++) {
      const group = Math.floor(i / 5);
      const k = i % 5;
      const gx = group * 66;
      if (k < 4) {
        const x = gx + k * 13;
        out += `<path class="ink thin" d="M ${x + wob(i)} ${wob(i + 7)} L ${x - wob(i + 3)} ${34 + wob(i + 1)}"/>`;
      } else {
        out += `<path class="ink thin" d="M ${gx - 8} ${28 + wob(i)} L ${gx + 50} ${4 + wob(i + 2)}"/>`;
      }
    }
    if (count > 20) out += `<text class="lettering small" x="${4 * 66 + 6}" y="30">+${count - 20}</text>`;
    g.innerHTML = out;
  }

  /* ---------- speech bubbles (show what the bin is saying) ---------- */

  const bubbles = {};

  function buildBubbles(ids) {
    for (const id of ids) {
      const el = document.createElement('div');
      el.className = `bubble bubble--${bins[id].side < 0 ? 'left' : 'right'} boil`;
      el.innerHTML = `<p class="bubble__text"></p>
        <svg class="bubble__tail" viewBox="0 0 70 70" aria-hidden="true"><path d="M 6 0 Q 30 36 64 64 Q 34 26 34 0"/></svg>`;
      overlay.appendChild(el);
      bubbles[id] = { el, id: null, hideTimer: null };
    }
  }

  function say(binId, text, kind, speechId) {
    const bub = bubbles[binId];
    if (!bub || !text) return;
    clearTimeout(bub.hideTimer);
    bub.id = speechId;
    bub.el.querySelector('.bubble__text').textContent = text;
    bub.el.classList.toggle('is-short', text.length <= 10);
    bub.el.dataset.kind = kind || '';
    bub.el.classList.add('is-on');
    replay(bub.el, 'pop');
  }

  function unsay(speechId) {
    for (const bub of Object.values(bubbles)) {
      if (bub.id !== speechId) continue;
      clearTimeout(bub.hideTimer);
      bub.hideTimer = setTimeout(() => {
        if (bub.id === speechId) bub.el.classList.remove('is-on');
      }, L.BUBBLE_LINGER_MS ?? 700);
    }
  }

  /* ---------- an item dropping into the bin ---------- */

  function dropItem(id, category) {
    const b = bins[id];
    // If the camera knew what it was, draw something from that category; otherwise from this bin's set.
    const source = (category && CONFIG.BINS[category] && CONFIG.BINS[category].items) || CONFIG.BINS[id].items || [];
    if (!source.length) return;
    const img = document.createElement('img');
    img.className = 'drop boil';
    img.src = source[Math.floor(Math.random() * source.length)];
    img.alt = '';
    overlay.appendChild(img);
    const rim = FLOOR_Y + RIM_Y * BIN_SCALE;
    const pct = (x, y) => `translate(calc(${(x / W) * 100}cqw - 50%), calc(${(y / H) * 56.25}cqw - 50%))`;
    img.animate([
      { transform: `${pct(b.x + b.side * 90, rim - 170)} rotate(0deg) scale(1)`, opacity: 1 },
      { transform: `${pct(b.x, rim - 40)} rotate(${b.side * 120}deg) scale(.75)`, opacity: 1, offset: 0.75 },
      { transform: `${pct(b.x, rim + 30)} rotate(${b.side * 160}deg) scale(.5)`, opacity: 0 },
    ], { duration: 460, easing: 'cubic-bezier(.55,0,.9,.5)', fill: 'forwards' });
    setTimeout(() => img.remove(), 900);
  }

  /* ---------- floating doodles around the edges ---------- */

  function buildDecor() {
    const spots = [
      { src: 'art/can.png', x: 3.5, y: 7, w: 3.4, r: -14 },
      { src: 'art/apple-core.png', x: 90.5, y: 7.5, w: 3.4, r: 12 },
      { src: 'art/paper.png', x: 50, y: 52, w: 4.6, r: 8 },
      { src: 'art/bottle.png', x: 6, y: 70, w: 4.4, r: -20, cls: 'decor--camspot' },
      { src: 'art/banana.png', x: 94, y: 73, w: 6.5, r: 14 },
    ];
    spots.forEach((s, i) => {
      const img = document.createElement('img');
      img.className = 'decor boil ' + (s.cls || '');
      img.src = s.src;
      img.alt = '';
      img.style.cssText = `left:${s.x}%; top:${s.y}%; width:${s.w}%; --r:${s.r}deg; animation-delay:${-i * 1.3}s`;
      overlay.appendChild(img);
    });
  }

  /* ---------- "line boil": re-jitter the ink a few times a second ---------- */

  function startBoil() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (L.LINE_BOIL === false || reduce) return;
    let frame = 0;
    document.documentElement.dataset.boil = '0';
    setInterval(() => {
      frame = (frame + 1) % 3;
      document.documentElement.dataset.boil = String(frame);
    }, L.BOIL_MS || 160);
  }

  return { init, wake, lidOpen, lidClose, setFull, warn, reset, setTally, say, unsay };
})();
