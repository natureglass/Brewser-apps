/**
 * midi-resolver.js
 * Match a connected Web MIDI device to an entry in midi-controllers.json,
 * then resolve incoming MIDI messages to named controls (and build outgoing
 * LED messages).
 *
 * Usage (browser):
 *   import db from './midi-controllers.json' assert { type: 'json' };
 *   import { MidiControllerDB } from './midi-resolver.js';
 *   const registry = new MidiControllerDB(db);
 *
 *   const access = await navigator.requestMIDIAccess({ sysex: true });
 *   for (const input of access.inputs.values()) {
 *     const def = registry.resolve(input.name);
 *     input.onmidimessage = (e) => {
 *       const hit = registry.identify(def, e.data);
 *       if (hit) console.log(hit.control, hit.index, hit.value);
 *     };
 *   }
 */

export class MidiControllerDB {
  constructor(db) {
    this.db = db;
    this.controllers = db.controllers || {};
  }

  /**
   * Resolve a Web MIDI port name to a controller definition.
   * Loose, case-insensitive substring match against each entry's `match` list,
   * honouring `match_exclude`. Falls back to the entry flagged `fallback: true`.
   * @param {string} portName  e.g. input.name / output.name
   * @returns {{id:string}&object|null}
   */
  resolve(portName) {
    if (!portName) return this._fallback();
    const name = portName.toLowerCase();

    // Prefer the most specific match (longest matched token wins), so
    // "LPD8 mk2" beats "LPD8" and "APC mini mk2" beats "APC mini".
    let best = null;
    let bestLen = -1;

    for (const [id, def] of Object.entries(this.controllers)) {
      const excludes = (def.match_exclude || []).map((s) => s.toLowerCase());
      if (excludes.some((x) => name.includes(x))) continue;

      for (const token of def.match || []) {
        const t = token.toLowerCase();
        if (t && name.includes(t) && t.length > bestLen) {
          best = { id, ...def };
          bestLen = t.length;
        }
      }
    }
    return best || this._fallback();
  }

  _fallback() {
    for (const [id, def] of Object.entries(this.controllers)) {
      if (def.fallback) return { id, ...def };
    }
    return null;
  }

  /**
   * Given a resolved definition and a raw MIDI message, return the matching
   * control group plus the element index and a normalised value.
   * @param {object} def   result of resolve()
   * @param {Uint8Array|number[]} data  [status, d1, d2]
   * @returns {{control:string, kind:string, index:number, channel:number,
   *            number:number, value:number, raw:number[]}|null}
   */
  identify(def, data) {
    if (!def || !def.controls || !data || data.length < 2) return null;
    const status = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) + 1; // 1-based
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    const isNoteOn = status === 0x90 && d2 > 0;
    const isNoteOff = status === 0x80 || (status === 0x90 && d2 === 0);
    const isCC = status === 0xb0;

    for (const [control, spec] of Object.entries(def.controls)) {
      const io = spec.input;
      if (!io) continue;

      if (io.type === 'note' && (isNoteOn || isNoteOff)) {
        if (!this._channelMatches(io, channel)) continue;
        const index = this._noteIndex(io, d1);
        if (index >= 0) {
          return {
            control, kind: spec.kind, index, channel,
            number: d1, value: isNoteOff ? 0 : d2,
            event: isNoteOff ? 'off' : 'on', raw: Array.from(data),
          };
        }
      }

      if (io.type === 'cc' && isCC) {
        if (!this._channelMatches(io, channel)) continue;
        const index = this._ccIndex(io, d1);
        if (index >= 0) {
          return {
            control, kind: spec.kind, index, channel,
            number: d1, value: d2, event: 'cc', raw: Array.from(data),
          };
        }
      }
    }
    return null;
  }

  _channelMatches(io, channel) {
    if (io.channel_range) return channel >= io.channel_range[0] && channel <= io.channel_range[1];
    if (typeof io.channel === 'number') return io.channel === channel;
    return true; // unspecified => any
  }

  _noteIndex(io, note) {
    if (Array.isArray(io.notes)) return io.notes.indexOf(note);
    if (typeof io.note_start === 'number' && typeof io.note_end === 'number') {
      return note >= io.note_start && note <= io.note_end ? note - io.note_start : -1;
    }
    return -1;
  }

  _ccIndex(io, cc) {
    if (Array.isArray(io.ccs)) return io.ccs.indexOf(cc);
    if (typeof io.cc === 'number') return io.cc === cc ? 0 : -1;
    return -1;
  }

  /**
   * Expand a control group into a flat list of concrete elements
   * (one per pad/knob/key), useful for building UI or a lookup table.
   * @returns {Array<{control, kind, index, channel, type, number}>}
   */
  expand(def, controlName) {
    const spec = def.controls[controlName];
    if (!spec || !spec.input) return [];
    const io = spec.input;
    const out = [];
    const chans = io.channel_range
      ? range(io.channel_range[0], io.channel_range[1])
      : [io.channel ?? 1];

    for (const ch of chans) {
      if (io.type === 'note') {
        const notes = Array.isArray(io.notes)
          ? io.notes
          : range(io.note_start, io.note_end);
        notes.forEach((n, i) =>
          out.push({ control: controlName, kind: spec.kind, index: out.length, channel: ch, type: 'note', number: n }));
      } else if (io.type === 'cc') {
        const ccs = Array.isArray(io.ccs) ? io.ccs : [io.cc];
        ccs.forEach((c) =>
          out.push({ control: controlName, kind: spec.kind, index: out.length, channel: ch, type: 'cc', number: c }));
      }
    }
    return out;
  }

  /**
   * Build a raw outbound message to light a pad/button LED, if the control
   * defines an `output`. `value` is the colour/velocity index.
   * @returns {number[]|null} [status, d1, d2]
   */
  ledMessage(def, controlName, index, value = 127, channelOverride) {
    const spec = def.controls[controlName];
    if (!spec || !spec.output) return null;
    const o = spec.output;
    const ch = (channelOverride ?? (Array.isArray(o.channel_range) ? o.channel_range[0] : o.channel ?? 1)) - 1;

    let number;
    if (Array.isArray(o.notes)) number = o.notes[index];
    else if (typeof o.note_start === 'number') number = o.note_start + index;
    else if (Array.isArray(o.ccs)) number = o.ccs[index];
    if (number == null) return null;

    const status = (o.type && o.type.startsWith('cc')) ? 0xb0 : 0x90;
    return [status | (ch & 0x0f), number, value];
  }

  // ---------------------------------------------------------------------------
  // Additive fast-path extension (backward-compatible — does not touch
  // resolve()/identify()/expand()/ledMessage()).
  //
  // buildIndex(def) precomputes a Map from a compact (channel, status, number)
  // composite key to the concrete element record expand() already produces, so
  // per-message dispatch is O(1) instead of identify()'s linear scan. This
  // matters for dense devices (Push 2, 8x8 grids, APC40's per-channel columns)
  // under fast playing. Build it ONCE per resolved device.
  //
  // lookup(index, data) is the hot path: it returns the same shape identify()
  // returns. If it misses, callers should fall through to identify(def, data)
  // so behaviour is never worse than the linear scan.
  // ---------------------------------------------------------------------------

  /**
   * Compose the Map key for a (channel, status-nibble, number) triple.
   * `status` is 0x90/0x80 for note events, 0xb0 for CC.
   * @private
   */
  _indexKey(channel, status, number) {
    return `${channel}:${status}:${number}`;
  }

  /**
   * Precompute a lookup index for one resolved device definition.
   * Iterates def.controls, reuses expand() to enumerate concrete elements, and
   * registers each element under its (channel, note/cc-status, number) key.
   * Note controls are registered under BOTH Note On (0x90) and Note Off (0x80)
   * so either event resolves to the same element. Colliding keys keep the first
   * registration and log a warning (surfaces bad DB entries).
   * @param {object} def  result of resolve()
   * @returns {Map<string, object>}  key -> {control, kind, index, channel, type, number}
   */
  buildIndex(def) {
    const index = new Map();
    if (!def || !def.controls) return index;

    for (const controlName of Object.keys(def.controls)) {
      const spec = def.controls[controlName];
      if (!spec || !spec.input) continue;

      for (const el of this.expand(def, controlName)) {
        const statuses = el.type === 'note' ? [0x90, 0x80] : [0xb0];
        for (const status of statuses) {
          const key = this._indexKey(el.channel, status, el.number);
          if (index.has(key)) {
            const prev = index.get(key);
            // eslint-disable-next-line no-console
            console.warn(
              `MidiControllerDB.buildIndex: key collision ${key} — ` +
              `keeping ${prev.control}[${prev.index}], ignoring ${el.control}[${el.index}]`
            );
            continue;
          }
          index.set(key, el);
        }
      }
    }
    return index;
  }

  /**
   * O(1) lookup of a raw MIDI message against a prebuilt index. Returns the
   * same shape identify() returns, or null on a miss (caller should then fall
   * through to identify()). Value/event are derived exactly as identify() does:
   * note-on with velocity 0 => 'off'; cc => value d2.
   * @param {Map<string, object>} index  result of buildIndex()
   * @param {Uint8Array|number[]} data   [status, d1, d2]
   * @returns {{control, kind, index, channel, number, value, event, raw}|null}
   */
  lookup(index, data) {
    if (!index || !data || data.length < 2) return null;
    const status = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) + 1; // 1-based
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;

    const isNote = status === 0x90 || status === 0x80;
    const isCC = status === 0xb0;
    if (!isNote && !isCC) return null;

    const el = index.get(this._indexKey(channel, status, d1));
    if (!el) return null;

    const isOff = status === 0x80 || (status === 0x90 && d2 === 0);
    let value, event;
    if (isCC) { value = d2; event = 'cc'; }
    else if (isOff) { value = 0; event = 'off'; }
    else { value = d2; event = 'on'; }

    return {
      control: el.control, kind: el.kind, index: el.index, channel,
      number: d1, value, event, raw: Array.from(data),
    };
  }
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

// CommonJS interop (Node) without breaking ESM import
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MidiControllerDB };
}
