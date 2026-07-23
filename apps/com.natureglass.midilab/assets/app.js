/**
 * MIDI Lab — generic MIDI controller tester + audio/visual playground.
 *
 * Boot order (each stage independent of the next so it degrades gracefully):
 *   1. Load the controller DB + resolver.
 *   2. Transport: Web MIDI (preferred) or WebUSB class-compliant fallback.
 *      Resolve the port name to a controller def BEFORE building any UI.
 *   3. Monitor: every message is logged end-to-end (proves the pipe).
 *   4. Dynamic UI generated from def.controls via expand().
 *   5. Web Audio synth + distortion driven by the same event stream.
 *   6. WebGL2 reactive background driven by the same event stream.
 *   7. LED output for devices whose controls declare an `output`.
 *
 * Standard Web APIs only — no brewser.* for hardware. Runs on PC Chrome,
 * mobile, and the Brewser Switch runtime.
 */

import { MidiControllerDB } from './midi-resolver.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const expLerp = (a, b, t) => a * Math.pow(b / a, clamp(t, 0, 1));
const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2); // C3 = 60
const BLACK_PC = new Set([1, 3, 6, 8, 10]);
const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let registry = null;                 // MidiControllerDB
let session = null;                  // { def, index, elementState, ccParamMap, isFallback, genericCC }
let transport = 'none';              // 'webmidi' | 'webusb' | 'none'
let midiAccess = null;               // MIDIAccess
let activeInputId = null;            // current driving Web MIDI input id
let midiInputs = new Map();          // id -> MIDIInput
let midiOutputs = new Map();         // id -> MIDIOutput
let usb = null;                      // { device, inEp, outEp, iface, reading }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  try {
    // fetch() resolves against the document URL (index.html at the app root),
    // not this module's URL, so the path includes assets/.
    const res = await fetch('./assets/midi-controllers.json');
    const db = await res.json();
    registry = new MidiControllerDB(db);
  } catch (err) {
    setStatus('device', 'DB load failed', 'err');
    logSystem('Failed to load midi-controllers.json: ' + err.message);
    return;
  }

  initMonitor();
  initVisual();      // guarded — disables itself if WebGL2 is unavailable
  wireButtons();
  window.__midilabReady = true;

  // Auto-attempt Web MIDI so a device that is already connected shows up.
  if (navigator.requestMIDIAccess) {
    pairWebMidi(true);
  } else {
    setStatus('transport', 'Web MIDI unavailable — use Pair USB', 'err');
  }
})();

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------
function setStatus(which, text, dot) {
  if (which === 'transport') {
    $('stTransport').textContent = text;
    setDot('dotT', dot);
  } else {
    $('stDevice').textContent = text;
    setDot('dotD', dot);
  }
}
function setDot(id, kind) {
  const el = $(id);
  el.className = 'dot' + (kind === 'on' ? ' on' : kind === 'err' ? ' err' : '');
}

// ===========================================================================
// TRANSPORT — Web MIDI
// ===========================================================================
async function pairWebMidi(silent) {
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: true });
  } catch (err) {
    if (!silent) setStatus('transport', 'Web MIDI denied', 'err');
    logSystem('requestMIDIAccess failed: ' + err.message);
    return;
  }
  transport = 'webmidi';
  midiAccess.onstatechange = onMidiStateChange;
  refreshMidiPorts();
  setStatus('transport', 'Web MIDI (sysex)', 'on');
}

function onMidiStateChange(e) {
  logSystem(`state: ${e.port.type} "${e.port.name}" ${e.port.state}`);
  refreshMidiPorts();
}

function refreshMidiPorts() {
  midiInputs = new Map();
  midiOutputs = new Map();
  for (const inp of midiAccess.inputs.values()) midiInputs.set(inp.id, inp);
  for (const out of midiAccess.outputs.values()) midiOutputs.set(out.id, out);

  // Bind message handlers on every input; only the active one drives the app.
  for (const inp of midiInputs.values()) {
    inp.onmidimessage = (ev) => {
      if (inp.id === activeInputId) dispatch(ev.data, inp.name);
    };
  }

  if (transport !== 'webmidi') return;

  if (midiInputs.size === 0) {
    activeInputId = null;
    setStatus('device', 'no MIDI inputs — connect a controller', 'err');
    populateMidiPicker();
    teardownSession();
    return;
  }

  // Keep current selection if still present, else pick the first input.
  if (!activeInputId || !midiInputs.has(activeInputId)) {
    activeInputId = midiInputs.values().next().value.id;
  }
  populateMidiPicker();
  selectMidiInput(activeInputId);
}

function populateMidiPicker() {
  const pick = $('devPick');
  pick.innerHTML = '';
  for (const inp of midiInputs.values()) {
    const opt = document.createElement('option');
    opt.value = inp.id;
    opt.textContent = inp.name || inp.id;
    pick.appendChild(opt);
  }
  if (activeInputId) pick.value = activeInputId;
  // Show the picker whenever there's a choice to make.
  $('pickWrap').classList.toggle('hidden', midiInputs.size <= 1);
  pick.onchange = () => selectMidiInput(pick.value);
}

function selectMidiInput(id) {
  activeInputId = id;
  const inp = midiInputs.get(id);
  if (!inp) return;
  const def = registry.resolve(inp.name);
  const out = findMatchingOutput(inp.name);
  startSession(def, { midiOutput: out, portName: inp.name });
}

// Find an output port that best matches an input's name (for LED feedback).
function findMatchingOutput(inputName) {
  if (!inputName) return null;
  const lname = inputName.toLowerCase();
  let best = null, bestScore = 0;
  for (const out of midiOutputs.values()) {
    const on = (out.name || '').toLowerCase();
    // score = length of shared leading token run
    let score = 0;
    const a = lname.split(/\s+/), b = on.split(/\s+/);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] && a[i] === b[i]) score++; else break;
    }
    if (score > bestScore) { bestScore = score; best = out; }
  }
  return best;
}

// ===========================================================================
// TRANSPORT — WebUSB class-compliant fallback
// ===========================================================================
async function pairWebUsb() {
  if (!navigator.usb) {
    setStatus('transport', 'WebUSB unavailable', 'err');
    return;
  }
  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: [{ classCode: 0x01 }, {}] });
  } catch (err) {
    logSystem('USB requestDevice cancelled: ' + err.message);
    return;
  }
  try {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    const found = findMidiStreamingInterface(device);
    if (!found) {
      setStatus('transport', 'no MIDIStreaming interface', 'err');
      logSystem('This USB device exposes no class-compliant MIDI interface.');
      await device.close();
      return;
    }
    await device.claimInterface(found.iface.interfaceNumber);
    usb = { device, iface: found.iface, inEp: found.inEp, outEp: found.outEp, reading: true };
    transport = 'webusb';
    setStatus('transport', 'WebUSB class-compliant', 'on');

    navigator.usb.ondisconnect = (e) => {
      if (usb && e.device === usb.device) {
        usb.reading = false;
        usb = null;
        transport = 'none';
        setStatus('transport', 'USB disconnected', 'err');
        teardownSession();
      }
    };

    // No friendly port name over raw USB — let the user pick the controller.
    populateUsbPicker();
    readUsbLoop();
  } catch (err) {
    setStatus('transport', 'USB open failed', 'err');
    logSystem('USB error: ' + err.message);
  }
}

function findMidiStreamingInterface(device) {
  const cfg = device.configuration;
  if (!cfg) return null;
  for (const iface of cfg.interfaces) {
    for (const alt of iface.alternates) {
      // Audio class (0x01), MIDIStreaming subclass (0x03)
      if (alt.interfaceClass === 0x01 && alt.interfaceSubclass === 0x03) {
        let inEp = null, outEp = null;
        for (const ep of alt.endpoints) {
          if (ep.type === 'bulk' && ep.direction === 'in') inEp = ep.endpointNumber;
          if (ep.type === 'bulk' && ep.direction === 'out') outEp = ep.endpointNumber;
        }
        if (inEp != null) return { iface, inEp, outEp };
      }
    }
  }
  return null;
}

function populateUsbPicker() {
  const pick = $('devPick');
  pick.innerHTML = '';
  for (const [id, def] of Object.entries(registry.controllers)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${def.vendor} ${def.model}`;
    pick.appendChild(opt);
  }
  // default to the generic fallback so unknown gear still works
  const fb = Object.entries(registry.controllers).find(([, d]) => d.fallback);
  pick.value = fb ? fb[0] : pick.options[0].value;
  $('pickWrap').classList.remove('hidden');
  pick.onchange = () => {
    const def = { id: pick.value, ...registry.controllers[pick.value] };
    startSession(def, { portName: `USB · ${def.model}` });
  };
  pick.onchange();
}

async function readUsbLoop() {
  const { device, inEp } = usb;
  while (usb && usb.reading) {
    let result;
    try {
      result = await device.transferIn(inEp, 64);
    } catch (err) {
      logSystem('USB transferIn ended: ' + err.message);
      break;
    }
    if (!result || !result.data) continue;
    const view = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    // 4-byte USB-MIDI Event Packets: [cable|CIN, b1, b2, b3]
    for (let i = 0; i + 3 < view.length; i += 4) {
      const cin = view[i] & 0x0f;
      if (cin < 0x2) continue; // 0x0/0x1 reserved / misc
      dispatch([view[i + 1], view[i + 2], view[i + 3]], usb ? 'USB' : '');
    }
  }
}

// Send a raw [status,d1,d2] out over the active transport (LED feedback).
function sendRaw(msg, output) {
  if (!msg) return;
  if (transport === 'webmidi' && output) {
    try { output.send(msg); } catch (e) { /* ignore */ }
  } else if (transport === 'webusb' && usb && usb.outEp != null) {
    const cin = (msg[0] & 0xf0) === 0xb0 ? 0x0b : 0x09; // cc vs note-on
    const pkt = new Uint8Array([cin, msg[0], msg[1], msg[2] | 0]);
    usb.device.transferOut(usb.outEp, pkt).catch(() => {});
  }
}

// ===========================================================================
// SESSION — resolve → index → build UI  (rebuilt on every (re)pair)
// ===========================================================================
function startSession(def, opts = {}) {
  teardownSession();
  if (!def) { setStatus('device', 'no match', 'err'); return; }

  const index = registry.buildIndex(def);
  session = {
    def,
    index,
    output: opts.midiOutput || null,
    portName: opts.portName || '',
    isFallback: !!def.fallback,
    elementState: new Map(),   // `${control}:${index}` -> widget state
    ccParamMap: new Map(),     // `${channel}:${number}` -> param binding
    genericCC: null,           // fallback: CC monitor cells
  };

  const label = def.fallback ? 'fallback / generic' : `${def.vendor} ${def.model}`;
  setStatus('device', label + (opts.portName ? ` · ${opts.portName}` : ''), 'on');

  buildDeviceBanner(def, opts.portName);
  buildParamBindings(def);
  buildUI(def);
  logSystem(`resolved "${opts.portName || ''}" → ${def.id} (${label})`);
}

function teardownSession() {
  if (session) audioAllNotesOff();
  session = null;
  $('controls').innerHTML = '';
}

function buildDeviceBanner(def, portName) {
  const b = $('devbanner');
  const controls = Object.entries(def.controls || {})
    .map(([n, s]) => `${n}·${s.kind}${s.count ? '×' + s.count : ''}`)
    .join('  ');
  b.innerHTML =
    `<span class="tag">${def.fallback ? 'GENERIC' : def.vendor.toUpperCase()}</span> ` +
    `<b>${def.model}</b> — ${controls || 'no declared controls'}` +
    (def.fallback ? ' &nbsp;(unknown device: live monitor + any-note/any-CC meters)' : '');
}

// ===========================================================================
// AUDIO param bindings (continuous controls, assigned in declared order)
// ===========================================================================
const PARAMS = [
  { name: 'cutoff',     apply: (n) => { audio.setCutoff(n); viz.hue = n; } },
  { name: 'resonance',  apply: (n) => audio.setResonance(n) },
  { name: 'attack',     apply: (n) => audio.setAttack(n) },
  { name: 'release',    apply: (n) => audio.setRelease(n) },
  { name: 'osc blend',  apply: (n) => audio.setBlend(n) },
  { name: 'reverb',     apply: (n) => { audio.setReverb(n); viz.bloom = n; } },
  { name: 'drive',      apply: (n) => { audio.setDrive(n); viz.warp = n; } },
  { name: 'volume',     apply: (n) => audio.setMaster(n) },
  { name: 'detune',     apply: (n) => audio.setDetune(n) },
  { name: 'delay time', apply: (n) => audio.setDelayTime(n) },
  { name: 'delay fb',   apply: (n) => audio.setDelayFeedback(n) },
  { name: 'bitcrush',   apply: (n) => audio.setCrush(n) },
  { name: 'width',      apply: (n) => audio.setWidth(n) },
  { name: 'shimmer',    apply: (n) => { viz.shimmer = n; } },
];
const CONTINUOUS_KINDS = new Set(['knob', 'fader', 'wheel', 'pedal']);

function buildParamBindings(def) {
  let i = 0;
  for (const [controlName, spec] of Object.entries(def.controls || {})) {
    if (!spec.input || !CONTINUOUS_KINDS.has(spec.kind)) continue;
    const rel = spec.input.range === 'relative' || spec.input.relative_capable === true;
    for (const el of registry.expand(def, controlName)) {
      const p = PARAMS[i % PARAMS.length];
      session.ccParamMap.set(`${el.channel}:${el.number}`, {
        name: p.name, apply: p.apply, relative: rel, curr: 0,
      });
      i++;
    }
  }
}

// The param label a continuous element is bound to (expand() returns fresh
// objects each call, so read it back from ccParamMap by channel+number).
function paramLabel(el) {
  const b = session && session.ccParamMap.get(`${el.channel}:${el.number}`);
  return b ? b.name : '';
}

// ===========================================================================
// DYNAMIC UI GENERATION
// ===========================================================================
function buildUI(def) {
  const host = $('controls');
  host.innerHTML = '';

  for (const [controlName, spec] of Object.entries(def.controls || {})) {
    if (!spec.input) continue;
    const group = document.createElement('div');
    group.className = 'group';
    const els = registry.expand(def, controlName);

    const glabel = document.createElement('div');
    glabel.className = 'glabel';
    glabel.innerHTML = `${controlName} · <span class="kind">${spec.kind}</span> ` +
      `<span style="color:var(--dim)">×${els.length}${spec.output ? ' · LED' : ''}${spec.mode ? ' · ' + spec.mode : ''}</span>`;
    group.appendChild(glabel);

    let body;
    switch (spec.kind) {
      case 'pad':    body = renderGrid(def, controlName, spec, els); break;
      case 'key':    body = renderKeys(def, controlName, spec, els); break;
      case 'knob':   body = renderKnobs(def, controlName, spec, els); break;
      case 'fader':  body = renderFaders(def, controlName, spec, els); break;
      case 'button': body = renderButtons(def, controlName, spec, els); break;
      case 'wheel':
      case 'pedal':
      default:       body = renderBars(def, controlName, spec, els); break;
    }
    group.appendChild(body);
    host.appendChild(group);
  }

  if (def.fallback) buildGenericMeters();
}

function elementKey(control, index) { return `${control}:${index}`; }

function registerElement(control, index, node, extra) {
  session.elementState.set(elementKey(control, index),
    Object.assign({ node, control, index }, extra));
}

// ---- pad / grid ----
function placeElement(spec, el, count, rows, cols) {
  const layout = spec.layout || {};
  const origin = layout.origin;
  const formula = String(layout.note_formula || layout.note || '');

  if (formula.indexOf('row*10') >= 0) {
    // row*10+col addressing (Launchpad family), bottom-left origin
    const r = Math.floor(el.number / 10);
    const c = el.number % 10;
    const valid = c >= 1 && c <= cols && r >= 1 && r <= rows;
    return { vr: rows - r, vc: c - 1, valid };
  }
  if (spec.input.channel_range) {
    // column = channel; rows = notes per channel
    const perCol = Math.max(1, Math.round(count / cols));
    const col = Math.floor(el.index / perCol);
    const rfb = el.index % perCol;
    const vr = origin === 'bottom-left' ? rows - 1 - rfb : rfb;
    return { vr, vc: col, valid: col < cols };
  }
  const r = Math.floor(el.index / cols);
  const c = el.index % cols;
  const vr = origin === 'bottom-left' ? rows - 1 - r : r;
  return { vr, vc: c, valid: true };
}

function renderGrid(def, controlName, spec, els) {
  const layout = spec.layout || {};
  let cols = layout.cols || Math.ceil(Math.sqrt(els.length)) || 1;
  let rows = layout.rows || Math.ceil(els.length / cols) || 1;
  const wrap = document.createElement('div');
  wrap.className = 'grid';
  wrap.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  // Build a rows×cols matrix of placeholder cells, then drop elements in.
  const cells = [];
  for (let r = 0; r < rows; r++) {
    cells[r] = [];
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell blank';
      cell.style.gridRow = String(r + 1);
      cell.style.gridColumn = String(c + 1);
      wrap.appendChild(cell);
      cells[r][c] = cell;
    }
  }

  for (const el of els) {
    const pos = placeElement(spec, el, els.length, rows, cols);
    if (!pos.valid || pos.vr < 0 || pos.vr >= rows || pos.vc < 0 || pos.vc >= cols) continue;
    const cell = cells[pos.vr][pos.vc];
    cell.className = 'cell' + (spec.output ? ' led' : '');
    cell.innerHTML = `<div class="fill"></div><div class="id">${el.channel}·${el.number}</div>`;
    cell.title = `${controlName} #${el.index} — ch${el.channel} note ${el.number} (${noteName(el.number)})` +
      (spec.output ? ' — tap to light + play' : '');
    registerElement(controlName, el.index, cell, { kind: 'pad', channel: el.channel, number: el.number, note: true });
    if (spec.output) {
      cell.addEventListener('pointerdown', () => onScreenPadHit(def, controlName, spec, el, cell));
    }
  }
  return wrap;
}

// ---- keys (piano strip) ----
function renderKeys(def, controlName, spec, els) {
  const wrap = document.createElement('div');
  wrap.className = 'keys';
  for (const el of els) {
    const key = document.createElement('div');
    const black = BLACK_PC.has(el.number % 12);
    key.className = 'key' + (black ? ' black' : '');
    key.innerHTML = `<div class="id">${el.number}</div>`;
    key.title = `${controlName} — ch${el.channel} note ${el.number} (${noteName(el.number)})`;
    wrap.appendChild(key);
    registerElement(controlName, el.index, key, { kind: 'key', channel: el.channel, number: el.number, note: true });
  }
  return wrap;
}

// ---- knobs / encoders ----
function renderKnobs(def, controlName, spec, els) {
  const wrap = document.createElement('div');
  wrap.className = 'knobrow';
  for (const el of els) {
    const k = document.createElement('div');
    k.className = 'knob';
    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 56;
    k.appendChild(cv);
    k.insertAdjacentHTML('beforeend',
      `<div class="val">0</div><div>ch${el.channel}·cc${el.number}</div>` +
      `<div class="param">${paramLabel(el)}</div>`);
    wrap.appendChild(k);
    drawKnob(cv, 0);
    registerElement(controlName, el.index, k, {
      kind: 'knob', channel: el.channel, number: el.number, cc: true,
      canvas: cv, valEl: k.querySelector('.val'),
    });
  }
  return wrap;
}

function drawKnob(cv, value) {
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height, cx = w / 2, cy = h / 2, r = w / 2 - 5;
  ctx.clearRect(0, 0, w, h);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#2a3340';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
  const t = clamp(value / 127, 0, 1);
  ctx.strokeStyle = '#38e1b0';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * t); ctx.stroke();
  const ang = a0 + (a1 - a0) * t;
  ctx.strokeStyle = '#e7ecf3';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(ang) * (r - 2), cy + Math.sin(ang) * (r - 2));
  ctx.stroke();
}

// ---- faders ----
function renderFaders(def, controlName, spec, els) {
  const wrap = document.createElement('div');
  wrap.className = 'faderrow';
  for (const el of els) {
    const f = document.createElement('div');
    f.className = 'fader';
    f.innerHTML =
      `<div class="track"><div class="bar"></div></div>` +
      `<div class="val">0</div><div>ch${el.channel}·cc${el.number}</div>` +
      `<div class="param">${paramLabel(el)}</div>`;
    wrap.appendChild(f);
    registerElement(controlName, el.index, f, {
      kind: 'fader', channel: el.channel, number: el.number, cc: true,
      bar: f.querySelector('.bar'), valEl: f.querySelector('.val'),
    });
  }
  return wrap;
}

// ---- buttons ----
function renderButtons(def, controlName, spec, els) {
  const wrap = document.createElement('div');
  wrap.className = 'btnrow';
  for (const el of els) {
    const b = document.createElement('div');
    const isNote = spec.input.type === 'note';
    b.className = 'ibtn' + (spec.output ? ' led' : '');
    b.innerHTML = `<div class="fill"></div><div class="lab">${controlName}<br>ch${el.channel}·${isNote ? 'n' : 'cc'}${el.number}</div>`;
    b.title = `${controlName} — ch${el.channel} ${isNote ? 'note' : 'cc'} ${el.number}`;
    wrap.appendChild(b);
    registerElement(controlName, el.index, b, {
      kind: 'button', channel: el.channel, number: el.number, note: isNote, cc: !isNote,
    });
    if (spec.output) {
      b.addEventListener('pointerdown', () => onScreenPadHit(def, controlName, spec, el, b));
    }
  }
  return wrap;
}

// ---- wheels / pedals / generic bars ----
function renderBars(def, controlName, spec, els) {
  const wrap = document.createElement('div');
  wrap.className = 'btnrow';
  for (const el of els) {
    const c = document.createElement('div');
    c.className = 'barctl';
    c.innerHTML =
      `<div>${controlName} · ch${el.channel}·cc${el.number}</div>` +
      `<div class="track"><div class="bar"></div></div>` +
      `<div class="param">${paramLabel(el)}</div>`;
    wrap.appendChild(c);
    registerElement(controlName, el.index, c, {
      kind: spec.kind, channel: el.channel, number: el.number, cc: true,
      bar: c.querySelector('.bar'), valEl: null,
    });
  }
  return wrap;
}

// ---- generic fallback meters (any note / any CC) ----
function buildGenericMeters() {
  const host = $('controls');
  const group = document.createElement('div');
  group.className = 'group';
  group.innerHTML = `<div class="glabel">generic monitor · <span class="kind">any CC</span> ` +
    `<span style="color:var(--dim)">×128 (lights on any channel)</span></div>`;
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.style.gridTemplateColumns = 'repeat(16, 1fr)';
  const cells = [];
  for (let cc = 0; cc < 128; cc++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.minWidth = '22px'; cell.style.minHeight = '22px';
    cell.innerHTML = `<div class="fill"></div><div class="id">${cc}</div>`;
    cell.title = `CC ${cc}`;
    grid.appendChild(cell);
    cells[cc] = cell;
  }
  group.appendChild(grid);
  host.appendChild(group);
  session.genericCC = cells;
}

// On-screen pad tapped → light the real device + play locally.
function onScreenPadHit(def, controlName, spec, el, node) {
  const msg = registry.ledMessage(def, controlName, elLedIndex(spec, el), 127, el.channel);
  sendRaw(msg, session.output);
  // Local feedback so it works even without a physical LED round-trip.
  flashNote(node, 110);
  audio.noteOn(`ui:${el.channel}:${el.number}`, el.number, 110);
  visualBurstAtNode(node, 110);
  setTimeout(() => {
    flashNoteOff(node);
    audio.noteOff(`ui:${el.channel}:${el.number}`);
    const off = registry.ledMessage(def, controlName, elLedIndex(spec, el), 0, el.channel);
    sendRaw(off, session.output);
  }, 180);
}

// The LED index for ledMessage(): for note_start/notes forms the element index
// works directly; expand() indices are per-group so they map 1:1 to output.
function elLedIndex(spec, el) {
  const o = spec.output;
  if (o && Array.isArray(o.notes)) return el.index; // aligns with input notes[]
  if (o && typeof o.note_start === 'number') return el.number - o.note_start;
  if (o && Array.isArray(o.ccs)) return el.index;
  return el.index;
}

// ===========================================================================
// DISPATCH — the one place every message flows through
// ===========================================================================
function dispatch(data, portLabel) {
  if (!data || data.length < 2) return;
  const def = session ? session.def : null;

  // Fast path first, linear-scan identify() as the correctness fallback.
  let hit = null;
  if (session && session.index) hit = registry.lookup(session.index, data);
  if (!hit && def) hit = registry.identify(def, data);

  logMonitor(data, hit, portLabel);

  // React (audio + visual + widget). Works even with no matching widget.
  react(data, hit);

  // Generic fallback meters + any-note passthrough.
  if (session && session.isFallback) genericRoute(data);
}

function react(data, hit) {
  const status = data[0] & 0xf0;
  const channel = (data[0] & 0x0f) + 1;
  const d1 = data[1];
  const d2 = data.length > 2 ? data[2] : 0;
  const isNoteOn = status === 0x90 && d2 > 0;
  const isNoteOff = status === 0x80 || (status === 0x90 && d2 === 0);
  const isCC = status === 0xb0;

  // ----- widget update (only if we resolved to a concrete element) -----
  let state = null;
  if (hit && session) state = session.elementState.get(elementKey(hit.control, hit.index));

  if (isNoteOn || isNoteOff) {
    if (state && state.note) {
      if (isNoteOn) { flashNote(state.node, d2); visualBurstAtNode(state.node, d2); }
      else flashNoteOff(state.node);
    } else if (isNoteOn) {
      visualBurstAtHash(d1, d2); // unknown note still paints
    }
    // audio: any note plays, keyed by channel+note so off matches
    const key = `${channel}:${d1}`;
    if (isNoteOn) audio.noteOn(key, d1, d2);
    else audio.noteOff(key);
  }

  if (isCC) {
    const bind = session ? session.ccParamMap.get(`${channel}:${d1}`) : null;
    let norm = d2 / 127;
    if (bind && bind.relative) {
      const delta = d2 < 64 ? d2 : -(128 - d2);
      bind.curr = clamp(bind.curr + delta, 0, 127);
      norm = bind.curr / 127;
    }
    if (state) {
      if (state.kind === 'button') {
        // CC-type button (e.g. nanoKONTROL solo/mute/rec): >0 pressed, 0 released
        if (d2 > 0) flashNote(state.node, 127); else flashNoteOff(state.node);
      } else if (state.cc) {
        updateContinuousWidget(state, bind && bind.relative ? bind.curr : d2);
      }
    }
    if (bind) bind.apply(norm);
    visualContinuous(d1, norm);
  }
}

function updateContinuousWidget(state, value) {
  if (state.canvas) drawKnob(state.canvas, value);
  if (state.bar) state.bar.style[state.kind === 'fader' ? 'height' : 'width'] =
    (clamp(value / 127, 0, 1) * 100) + '%';
  if (state.valEl) state.valEl.textContent = String(value);
}

function flashNote(node, vel) {
  if (!node) return;
  node.classList.add('on');
  const fill = node.querySelector('.fill');
  if (fill) fill.style.opacity = String(clamp(0.25 + vel / 127 * 0.75, 0, 1));
}
function flashNoteOff(node) {
  if (!node) return;
  node.classList.remove('on');
  const fill = node.querySelector('.fill');
  if (fill) fill.style.opacity = '';
}

function genericRoute(data) {
  const status = data[0] & 0xf0;
  const d1 = data[1];
  if (status === 0xb0 && session.genericCC) {
    const cell = session.genericCC[d1];
    if (cell) {
      cell.classList.add('on');
      clearTimeout(cell._t);
      cell._t = setTimeout(() => cell.classList.remove('on'), 220);
    }
  }
}

// ===========================================================================
// MONITOR
// ===========================================================================
let monCount = 0;
function initMonitor() {
  $('monHead').addEventListener('click', (e) => {
    if (e.target.id === 'monClear') return;
    const m = $('monitor');
    m.classList.toggle('collapsed');
    $('monCaret').textContent = m.classList.contains('collapsed') ? '▸' : '▾';
  });
  $('monClear').addEventListener('click', () => {
    $('monLog').innerHTML = '';
    monCount = 0;
    $('monCount').textContent = '0 msgs';
  });
}

function nowStamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function logMonitor(data, hit, portLabel) {
  const log = $('monLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const status = data[0] & 0xf0;
  const channel = (data[0] & 0x0f) + 1;
  const d1 = data[1];
  const d2 = data.length > 2 ? data[2] : 0;

  let ev = 'raw', evCls = 'ev-raw', typ = '0x' + hex2(status);
  if (status === 0x90 && d2 > 0) { ev = 'on'; evCls = 'ev-on'; typ = 'note-on'; }
  else if (status === 0x80 || (status === 0x90 && d2 === 0)) { ev = 'off'; evCls = 'ev-off'; typ = 'note-off'; }
  else if (status === 0xb0) { ev = 'cc'; evCls = 'ev-cc'; typ = 'cc'; }
  else if (status === 0xe0) { typ = 'pitch'; }
  else if (status === 0xd0) { typ = 'chan-press'; }
  else if (status === 0xa0) { typ = 'poly-press'; }

  const ctrl = hit
    ? `<span class="ctrl">${hit.control}#${hit.index} ${hit.kind}</span>`
    : `<span class="miss">— unmapped —</span>`;
  const hexStr = Array.from(data).map(hex2).join(' ');
  const num = (status === 0x90 || status === 0x80) ? `n${d1}(${noteName(d1)})` : `cc${d1}`;

  const row = document.createElement('div');
  row.className = 'logrow';
  row.innerHTML =
    `<span class="t">${nowStamp()}</span>` +
    `<span class="${evCls}">${typ.padEnd(9)}</span>` +
    `<span>ch${String(channel).padStart(2)}</span>` +
    `<span>${num.padEnd(9)}</span>` +
    `<span>v${String(d2).padStart(3)}</span>` +
    ctrl +
    `<span class="hex">[${hexStr}]${portLabel ? ' ' + portLabel : ''}</span>`;
  log.appendChild(row);

  // Cap the DOM log length.
  while (log.childNodes.length > 400) log.removeChild(log.firstChild);
  if (atBottom) log.scrollTop = log.scrollHeight;

  monCount++;
  $('monCount').textContent = monCount + ' msgs';
}

function logSystem(text) {
  const log = $('monLog');
  const row = document.createElement('div');
  row.className = 'logrow';
  row.innerHTML = `<span class="t">${nowStamp()}</span><span class="ev-raw">system</span><span class="ctrl">${text}</span>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

// ===========================================================================
// AUDIO ENGINE  (Web Audio, created inside a user gesture)
// ===========================================================================
const audio = {
  ctx: null, ready: false,
  voiceBus: null, drive: null, crush: null, sum: null, master: null, analyser: null,
  delay: null, feedback: null, delayLevel: null, convolver: null, wet: null,
  voices: new Map(), order: [],
  cutoffHz: 3000, resonance: 3, attackT: 0.008, releaseT: 0.25,
  blend: 0.3, detuneC: 0, widthAmt: 0.4,
  freqData: null,

  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { logSystem('Web Audio unavailable'); return false; }
    const ctx = new AC();
    this.ctx = ctx;

    this.voiceBus = ctx.createGain();  this.voiceBus.gain.value = 0.9;
    this.drive = ctx.createWaveShaper(); this.drive.oversample = '2x';
    this.crush = ctx.createWaveShaper();
    this.sum = ctx.createGain();
    this.master = ctx.createGain(); this.master.gain.value = 0.6;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    // delay + feedback
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = 0.18;
    this.feedback = ctx.createGain(); this.feedback.gain.value = 0.25;
    this.delayLevel = ctx.createGain(); this.delayLevel.gain.value = 0.35;

    // reverb
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._impulse(1.8, 2.5);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.25;

    this.setDrive(0.15);
    this.setCrush(0);

    // graph
    this.voiceBus.connect(this.drive);
    this.drive.connect(this.crush);
    this.crush.connect(this.sum);
    this.sum.connect(this.master);                 // dry
    this.sum.connect(this.convolver); this.convolver.connect(this.wet); this.wet.connect(this.master); // reverb
    this.sum.connect(this.delay);
    this.delay.connect(this.feedback); this.feedback.connect(this.delay); // feedback loop
    this.delay.connect(this.delayLevel); this.delayLevel.connect(this.master);
    this.master.connect(this.analyser); this.analyser.connect(ctx.destination);

    this.ready = true;
    return true;
  },

  _impulse(dur, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(dur * rate));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  },

  _driveCurve(amount) {
    const k = amount * 100;
    const n = 1024, curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  },
  _crushCurve(amount) {
    // amount 0 => linear (transparent); 1 => heavy quantisation
    const steps = Math.round(lerp(64, 3, clamp(amount, 0, 1)));
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  },

  noteOn(key, note, vel) {
    if (!this.ready) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.voices.has(key)) this.noteOff(key);
    while (this.order.length >= 24) this.noteOff(this.order[0]);

    const ctx = this.ctx, t = ctx.currentTime;
    const freq = midiToFreq(note);
    const v = clamp(vel / 127, 0, 1);

    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    o1.frequency.value = freq; o2.frequency.value = freq;
    o1.detune.value = this.detuneC; o2.detune.value = this.detuneC + this.blend * 30;

    const o2g = ctx.createGain(); o2g.gain.value = 0.15 + this.blend * 0.5;

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = this.resonance;
    const fPeak = clamp(this.cutoffHz * (0.4 + v * 1.6), 80, 16000);
    filt.frequency.setValueAtTime(clamp(this.cutoffHz * 0.5, 80, 16000), t);
    filt.frequency.linearRampToValueAtTime(fPeak, t + this.attackT);
    filt.frequency.exponentialRampToValueAtTime(clamp(this.cutoffHz, 80, 16000), t + this.attackT + 0.25);

    const g = ctx.createGain();
    const peak = 0.02 + v * 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + this.attackT);
    g.gain.linearRampToValueAtTime(peak * 0.7, t + this.attackT + 0.12);

    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = clamp((Math.random() * 2 - 1) * this.widthAmt, -1, 1);

    o1.connect(filt); o2.connect(o2g); o2g.connect(filt);
    filt.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.voiceBus); } else g.connect(this.voiceBus);
    o1.start(t); o2.start(t);

    this.voices.set(key, { o1, o2, g, filt, note });
    this.order.push(key);
  },

  noteOff(key) {
    const voice = this.voices.get(key);
    if (!voice) return;
    const ctx = this.ctx, t = ctx.currentTime;
    try {
      voice.g.gain.cancelScheduledValues(t);
      voice.g.gain.setValueAtTime(Math.max(voice.g.gain.value, 0.0001), t);
      voice.g.gain.exponentialRampToValueAtTime(0.0001, t + this.releaseT);
      voice.o1.stop(t + this.releaseT + 0.02);
      voice.o2.stop(t + this.releaseT + 0.02);
    } catch (e) { /* already stopped */ }
    this.voices.delete(key);
    const i = this.order.indexOf(key);
    if (i >= 0) this.order.splice(i, 1);
  },

  // ---- live param setters (norm 0..1) ----
  setCutoff(n)        { this.cutoffHz = expLerp(180, 12000, n);
                        this.voices.forEach(v => safeTarget(v.filt.frequency, this.cutoffHz, this.ctx)); },
  setResonance(n)     { this.resonance = lerp(0.3, 22, n);
                        this.voices.forEach(v => safeTarget(v.filt.Q, this.resonance, this.ctx)); },
  setAttack(n)        { this.attackT = expLerp(0.002, 1.5, n); },
  setRelease(n)       { this.releaseT = expLerp(0.03, 2.5, n); },
  setBlend(n)         { this.blend = n; },
  setReverb(n)        { if (this.wet) safeTarget(this.wet.gain, n, this.ctx); },
  setDrive(n)         { if (this.drive) this.drive.curve = this._driveCurve(clamp(n, 0, 1)); },
  setMaster(n)        { if (this.master) safeTarget(this.master.gain, clamp(n, 0, 1), this.ctx); },
  setDetune(n)        { this.detuneC = (n - 0.5) * 100; },
  setDelayTime(n)     { if (this.delay) safeTarget(this.delay.delayTime, n * 0.6, this.ctx); },
  setDelayFeedback(n) { if (this.feedback) safeTarget(this.feedback.gain, n * 0.9, this.ctx); },
  setCrush(n)         { if (this.crush) this.crush.curve = this._crushCurve(clamp(n, 0, 1)); },
  setWidth(n)         { this.widthAmt = n; },

  energy() {
    if (!this.ready) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let s = 0;
    for (let i = 0; i < this.freqData.length; i++) s += this.freqData[i];
    return s / (this.freqData.length * 255);
  },
};

function safeTarget(param, value, ctx) {
  try { param.setTargetAtTime(value, ctx.currentTime, 0.02); }
  catch (e) { param.value = value; }
}
function audioAllNotesOff() {
  if (!audio.ready) return;
  Array.from(audio.voices.keys()).forEach((k) => audio.noteOff(k));
}

// ===========================================================================
// WEBGL2 REACTIVE VISUAL
// ===========================================================================
const viz = { hue: 0.5, warp: 0.15, bloom: 0.25, shimmer: 0.2, energy: 0 };
const bursts = []; // { x, y, born, amp } in normalized coords (y up)

let gl = null, glOK = false;
let progFade = null, progPoint = null, progPresent = null;
let quadVBO = null, pointVBO = null;
let texA = null, texB = null, fboA = null, fboB = null, glW = 0, glH = 0;
let glStartTime = 0;

function initVisual() {
  const cv = $('glcanvas');
  gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' });
  if (!gl) { logSystem('WebGL2 unavailable — visuals disabled (UI/audio still work).'); cv.classList.add('hidden'); return; }
  try {
    setupGL();
    glOK = true;
    glStartTime = performance.now();
    resizeGL();
    window.addEventListener('resize', resizeGL);
    requestAnimationFrame(renderGL);
  } catch (err) {
    glOK = false; cv.classList.add('hidden');
    logSystem('WebGL2 init failed — visuals disabled: ' + err.message);
  }
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
  }
  return s;
}
function link(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  }
  return p;
}

const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

const FS_FADE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPrev; uniform float uDecay;
void main(){ o = texture(uPrev, vUv) * uDecay; }`;

const VS_POINT = `#version 300 es
in vec2 aPos; in vec2 aData; // aData = (amp, hue)
out float vAmp; out float vHue;
uniform float uSize;
void main(){
  vAmp = aData.x; vHue = aData.y;
  gl_Position = vec4(aPos*2.0-1.0, 0.0, 1.0);
  gl_PointSize = 4.0 + aData.x * uSize;
}`;

const FS_POINT = `#version 300 es
precision highp float;
in float vAmp; in float vHue; out vec4 o;
vec3 hsv(float h){
  vec3 c = abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0;
  return clamp(c,0.0,1.0);
}
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = smoothstep(0.5, 0.0, r);
  vec3 col = hsv(vHue) * (0.6 + 0.4*vAmp);
  o = vec4(col * a * vAmp, a);
}`;

const FS_PRESENT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
uniform float uTime, uWarp, uHue, uBloom, uEnergy, uShimmer;
vec3 hsv(float h){
  vec3 c = abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0;
  return clamp(c,0.0,1.0);
}
void main(){
  vec2 uv = vUv;
  // drive warps the field; energy adds a gentle pulse
  float w = uWarp * (0.5 + uEnergy);
  uv += w * 0.03 * vec2(
    sin(uv.y*10.0 + uTime*1.3),
    cos(uv.x*10.0 - uTime*1.1));
  vec3 c = texture(uTex, uv).rgb;
  // bloom: sample a few neighbours (cheap, no float FBO needed)
  if (uBloom > 0.01){
    float s = uBloom * 0.004;
    c += texture(uTex, uv+vec2(s,0.0)).rgb;
    c += texture(uTex, uv+vec2(-s,0.0)).rgb;
    c += texture(uTex, uv+vec2(0.0,s)).rgb;
    c += texture(uTex, uv+vec2(0.0,-s)).rgb;
    c *= 1.0/(1.0+4.0*uBloom);
    c += c * uBloom * 0.6;
  }
  // cutoff shifts colour
  float hueShift = (uHue-0.5)*0.5;
  vec3 tint = mix(vec3(1.0), hsv(fract(0.55+hueShift)), 0.5);
  c *= tint;
  // subtle scanline shimmer
  c += uShimmer * 0.03 * sin(uv.y*700.0+uTime*4.0);
  // vignette (flat)
  float vig = smoothstep(1.25, 0.35, length(vUv-0.5));
  o = vec4(c * vig, 1.0);
}`;

function setupGL() {
  progFade = link(VS_QUAD, FS_FADE);
  progPoint = link(VS_POINT, FS_POINT);
  progPresent = link(VS_QUAD, FS_PRESENT);

  quadVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  pointVBO = gl.createBuffer();
}

function makeTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo };
}

function resizeGL() {
  const cv = $('glcanvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  // Cap internal resolution for the software GPU on Switch.
  const maxW = 1280;
  let w = Math.min(Math.floor(cv.clientWidth * dpr), maxW);
  let h = Math.floor(cv.clientHeight * dpr);
  if (w < 2) w = 2; if (h < 2) h = 2;
  cv.width = w; cv.height = h; glW = w; glH = h;
  const a = makeTarget(w, h), b = makeTarget(w, h);
  texA = a.tex; fboA = a.fbo; texB = b.tex; fboB = b.fbo;
}

function renderGL(t) {
  if (!glOK) return;
  const time = (t - glStartTime) / 1000;
  viz.energy = viz.energy * 0.8 + audio.energy() * 0.2;

  gl.viewport(0, 0, glW, glH);

  // 1) fade previous frame (texA) into texB
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.disable(gl.BLEND);
  gl.useProgram(progFade);
  const decay = clamp(0.86 + viz.bloom * 0.11, 0.5, 0.985);
  gl.uniform1f(gl.getUniformLocation(progFade, 'uDecay'), decay);
  bindQuad(progFade);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.uniform1i(gl.getUniformLocation(progFade, 'uPrev'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 2) additively inject active bursts into texB
  injectBursts(time);

  // 3) present texB to screen with grading
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, glW, glH);
  gl.useProgram(progPresent);
  bindQuad(progPresent);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.uniform1i(gl.getUniformLocation(progPresent, 'uTex'), 0);
  gl.uniform1f(gl.getUniformLocation(progPresent, 'uTime'), time);
  gl.uniform1f(gl.getUniformLocation(progPresent, 'uWarp'), viz.warp);
  gl.uniform1f(gl.getUniformLocation(progPresent, 'uHue'), viz.hue);
  gl.uniform1f(gl.getUniformLocation(progPresent, 'uBloom'), viz.bloom);
  gl.uniform1f(gl.getUniformLocation(progPresent, 'uEnergy'), viz.energy);
  gl.uniform1f(gl.getUniformLocation(progPresent, 'uShimmer'), viz.shimmer);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // swap
  const tt = texA; texA = texB; texB = tt;
  const ff = fboA; fboA = fboB; fboB = ff;

  requestAnimationFrame(renderGL);
}

function bindQuad(prog) {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

function injectBursts(time) {
  // prune + build interleaved [x,y,amp,hue]
  const data = [];
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    const age = time - b.born;
    const life = 0.55;
    if (age > life) { bursts.splice(i, 1); continue; }
    const amp = b.amp * (1 - age / life);
    data.push(b.x, b.y, amp, b.hue);
  }
  if (!data.length) return;

  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive
  gl.useProgram(progPoint);
  gl.uniform1f(gl.getUniformLocation(progPoint, 'uSize'), Math.min(glW, glH) * 0.18);

  gl.bindBuffer(gl.ARRAY_BUFFER, pointVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
  const posLoc = gl.getAttribLocation(progPoint, 'aPos');
  const datLoc = gl.getAttribLocation(progPoint, 'aData');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(datLoc);
  gl.vertexAttribPointer(datLoc, 2, gl.FLOAT, false, 16, 8);
  gl.drawArrays(gl.POINTS, 0, data.length / 4);
  gl.disable(gl.BLEND);
}

function pushBurst(x, y, vel) {
  if (!glOK) return;
  bursts.push({ x, y, born: (performance.now() - glStartTime) / 1000, amp: clamp(vel / 127, 0.1, 1), hue: viz.hue });
  if (bursts.length > 96) bursts.splice(0, bursts.length - 96);
}
function visualBurstAtNode(node, vel) {
  if (!node || !glOK) return;
  const r = node.getBoundingClientRect();
  const x = clamp((r.left + r.width / 2) / window.innerWidth, 0, 1);
  const y = clamp(1 - (r.top + r.height / 2) / window.innerHeight, 0, 1);
  pushBurst(x, y, vel);
}
function visualBurstAtHash(note, vel) {
  const x = (note * 0.6180339887) % 1;
  const y = ((note * 7 + 3) * 0.381966) % 1;
  pushBurst(x, y, vel);
}
function visualContinuous(cc, norm) {
  // continuous controls nudge the global field colour a touch
  viz.hue = clamp(viz.hue * 0.9 + norm * 0.1, 0, 1);
}

// ===========================================================================
// Buttons / fullscreen
// ===========================================================================
function wireButtons() {
  $('btnMidi').addEventListener('click', () => pairWebMidi(false));
  $('btnUsb').addEventListener('click', pairWebUsb);
  $('btnAudio').addEventListener('click', enableAudio);

  const fsBtn = $('fsBtn');
  fsBtn.addEventListener('click', () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { const p = req.call(el); if (p && p.catch) p.catch(() => {}); }
  });
  document.addEventListener('fullscreenchange', () => {
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fsBtn.style.display = fs ? 'none' : '';
  });
}

function enableAudio() {
  const ok = audio.init();
  if (ok) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    $('btnAudio').classList.add('on');
    $('btnAudio').textContent = 'Audio On';
    logSystem('Web Audio started (sr ' + audio.ctx.sampleRate + ' Hz)');
  }
}

// ---------------------------------------------------------------------------
// Verification / no-hardware demo hook — inert unless explicitly invoked.
// Builds a real session for a DB controller id and feeds raw [status,d1,d2]
// messages through the actual dispatch pipeline (monitor + UI + audio + viz),
// exactly as a physical device would. Handy for headless self-tests and for
// eyeballing the UI without a controller plugged in.
// ---------------------------------------------------------------------------
window.__midilabSimulate = function (id, messages) {
  if (!registry) return 'registry not ready';
  const raw = registry.controllers[id];
  if (!raw) return 'no such controller: ' + id;
  startSession({ id, ...raw }, { portName: 'SIMULATED · ' + id });
  for (const m of (messages || [])) dispatch(m, 'SIM');
  return 'ok';
};
