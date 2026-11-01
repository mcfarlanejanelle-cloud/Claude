/*
 * Lumen piano roll (canvas).
 *   click empty space ...... add a note (drag to set its length)
 *   drag a note ............ move it;  drag its right edge to resize
 *   right-click / Alt-click  delete
 *   double-click ........... edit the lyric
 *   keys (roll focused) .... Delete, ↑/↓ (Shift = octave), ←/→ move by grid
 */
(function (root) {
  'use strict';
  const S = () => root.Lumen.score;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function PianoRoll(wrap, canvas, opts) {
    this.wrap = wrap;
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.lo = opts.lo || 48;   // C3
    this.hi = opts.hi || 86;   // D6
    this.rowH = 15;
    this.beatW = 56;
    this.gutter = 46;
    this.notes = [];
    this.grid = 0.25;
    this.defaultLen = 1;
    this.sel = -1;
    this.ghost = [];           // arranged lead (runs) in beats
    this.playhead = null;
    this.onChange = opts.onChange || function () {};
    this.onSelect = opts.onSelect || function () {};
    this.onPreview = opts.onPreview || function () {};
    this.onEditLyric = opts.onEditLyric || function () {};
    this.drag = null;
    this._bind();
    this.resize();
  }

  PianoRoll.prototype.totalBeats = function () {
    let end = 0;
    for (const n of this.notes) end = Math.max(end, n.start + n.len);
    return Math.max(32, Math.ceil((end + 8) / 4) * 4);
  };

  PianoRoll.prototype.resize = function () {
    const dpr = root.devicePixelRatio || 1;
    const w = this.gutter + this.totalBeats() * this.beatW;
    const h = (this.hi - this.lo + 1) * this.rowH;
    if (this._w !== w || this._h !== h || this._dpr !== dpr) {
      this.c.width = w * dpr; this.c.height = h * dpr;
      this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
      this._w = w; this._h = h; this._dpr = dpr;
    }
    this.draw();
  };

  PianoRoll.prototype.yOf = function (m) { return (this.hi - m) * this.rowH; };
  PianoRoll.prototype.xOf = function (b) { return this.gutter + b * this.beatW; };

  PianoRoll.prototype.setNotes = function (notes, keepSel) {
    this.notes = notes;
    if (!keepSel) this.sel = -1;
    if (this.sel >= notes.length) this.sel = -1;
    this.resize();
  };

  PianoRoll.prototype.scrollToNotes = function () {
    if (!this.notes.length) { this.wrap.scrollTop = this.yOf(74) - 40; return; }
    let hi = -1, lo = 999;
    for (const n of this.notes) { hi = Math.max(hi, n.midi); lo = Math.min(lo, n.midi); }
    const mid = (hi + lo) / 2;
    this.wrap.scrollTop = Math.max(0, this.yOf(mid) - this.wrap.clientHeight / 2);
  };

  PianoRoll.prototype.draw = function () {
    const g = this.g, dpr = this._dpr || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this._w, H = this._h;
    const col = {
      bg: css('--roll-bg'), black: css('--roll-black'), line: css('--roll-line'), bar: css('--roll-bar'),
      note: css('--accent'), noteSel: css('--accent-strong'), text: css('--on-accent'), ghost: css('--sage'),
      label: css('--muted'), head: css('--fg'), keyW: css('--key-white'), keyB: css('--key-black')
    };
    g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
    // rows
    for (let m = this.lo; m <= this.hi; m++) {
      const pc = ((m % 12) + 12) % 12;
      const y = this.yOf(m);
      if ([1, 3, 6, 8, 10].includes(pc)) { g.fillStyle = col.black; g.fillRect(this.gutter, y, W, this.rowH); }
      if (pc === 0) { g.fillStyle = col.bar; g.fillRect(this.gutter, y + this.rowH - 1, W, 1); }
    }
    // beats & bars
    const total = this.totalBeats();
    for (let b = 0; b <= total; b += this.grid) {
      const x = Math.round(this.xOf(b)) + 0.5;
      const isBar = Math.abs(b % 4) < 1e-6, isBeat = Math.abs(b % 1) < 1e-6;
      if (!isBeat && this.beatW * this.grid < 10) continue;
      g.strokeStyle = isBar ? col.bar : col.line;
      g.globalAlpha = isBar ? 1 : isBeat ? 0.9 : 0.4;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    g.globalAlpha = 1;
    // ghost: what she actually sings (runs, ornaments)
    if (this.ghost.length) {
      g.fillStyle = col.ghost;
      for (const n of this.ghost) {
        if (!n.ornament) continue;
        const x = this.xOf(n.start), y = this.yOf(n.midi);
        g.globalAlpha = 0.85;
        g.fillRect(x, y + this.rowH * 0.3, Math.max(3, n.len * this.beatW - 1), this.rowH * 0.4);
      }
      g.globalAlpha = 1;
    }
    // notes
    g.font = '600 11px ' + (css('--font-body') || 'sans-serif');
    g.textBaseline = 'middle';
    this.notes.forEach((n, i) => {
      const x = this.xOf(n.start) + 1, y = this.yOf(n.midi) + 1;
      const w = Math.max(4, n.len * this.beatW - 2), h = this.rowH - 2;
      g.fillStyle = i === this.sel ? col.noteSel : col.note;
      roundRect(g, x, y, w, h, 4); g.fill();
      if (i === this.sel) { g.strokeStyle = col.head; g.lineWidth = 1.5; roundRect(g, x, y, w, h, 4); g.stroke(); g.lineWidth = 1; }
      g.fillStyle = col.text;
      const label = n.lyric ? n.lyric.replace(/~/g, ' ') : '';
      if (label && w > 14) {
        g.save(); g.beginPath(); g.rect(x, y, w - 3, h); g.clip();
        g.fillText(label, x + 5, y + h / 2 + 0.5); g.restore();
      }
    });
    // playhead
    if (this.playhead != null) {
      const x = Math.round(this.xOf(this.playhead)) + 0.5;
      g.strokeStyle = col.head; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.lineWidth = 1;
    }
    // key gutter (sticky to the left edge of the viewport)
    const sx = this.wrap.scrollLeft;
    g.fillStyle = col.keyW; g.fillRect(sx, 0, this.gutter, H);
    for (let m = this.lo; m <= this.hi; m++) {
      const pc = ((m % 12) + 12) % 12, y = this.yOf(m);
      if ([1, 3, 6, 8, 10].includes(pc)) { g.fillStyle = col.keyB; g.fillRect(sx, y, this.gutter * 0.62, this.rowH); }
      if (pc === 0 || pc === 5) { g.fillStyle = col.line; g.fillRect(sx, y + this.rowH - 1, this.gutter, 1); }
      if (pc === 0) {
        g.fillStyle = col.label; g.font = '500 10px ' + (css('--font-mono') || 'monospace');
        g.fillText(S().noteName(m), sx + this.gutter - 26, y + this.rowH / 2);
      }
    }
    g.fillStyle = col.bar; g.fillRect(sx + this.gutter - 1, 0, 1, H);
  };

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  PianoRoll.prototype.hit = function (px, py) {
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      const x = this.xOf(n.start), y = this.yOf(n.midi), w = n.len * this.beatW;
      if (px >= x && px <= x + w && py >= y && py <= y + this.rowH) return { i, edge: px > x + w - 8 && w > 14 };
    }
    return null;
  };

  PianoRoll.prototype._pos = function (e) {
    const r = this.c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  PianoRoll.prototype._bind = function () {
    const c = this.c;
    c.tabIndex = 0;
    const snap = (b) => Math.round(b / this.grid) * this.grid;
    const floorSnap = (b) => Math.floor(b / this.grid) * this.grid;
    const pitchAt = (y) => Math.max(this.lo, Math.min(this.hi, this.hi - Math.floor(y / this.rowH)));

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      const p = this._pos(e);
      if (p.x < this.wrap.scrollLeft + this.gutter) { // key gutter: audition
        this.onPreview(pitchAt(p.y));
        return;
      }
      const h = this.hit(p.x, p.y);
      if (h && (e.button === 2 || e.altKey)) {
        this.notes.splice(h.i, 1); this.sel = -1; this.draw(); this.onChange('delete'); this.onSelect(-1);
        return;
      }
      if (e.button !== 0) return;
      if (h) {
        this.sel = h.i;
        const n = this.notes[h.i];
        this.drag = { mode: h.edge ? 'resize' : 'move', i: h.i, ox: p.x, oy: p.y, start: n.start, midi: n.midi, len: n.len, moved: false };
        if (!h.edge) this.onPreview(n.midi);
      } else {
        const start = floorSnap((p.x - this.gutter) / this.beatW);
        const midi = pitchAt(p.y);
        const n = { midi, start, len: this.defaultLen, lyric: '' };
        this.notes.push(n);
        this.notes.sort((a, b) => a.start - b.start);
        this.sel = this.notes.indexOf(n);
        this.drag = { mode: 'create', i: this.sel, ox: p.x, oy: p.y, start, midi, len: n.len, moved: true };
        this.onPreview(midi);
      }
      c.setPointerCapture(e.pointerId);
      this.onSelect(this.sel);
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this._pos(e);
      if (!this.drag) {
        const h = this.hit(p.x, p.y);
        c.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : p.x < this.wrap.scrollLeft + this.gutter ? 'pointer' : 'crosshair';
        return;
      }
      const d = this.drag, n = this.notes[d.i];
      const dxBeats = (p.x - d.ox) / this.beatW;
      if (Math.abs(p.x - d.ox) > 3 || Math.abs(p.y - d.oy) > 3) d.moved = true;
      if (d.mode === 'move') {
        n.start = Math.max(0, snap(d.start + dxBeats));
        const m = pitchAt(p.y);
        if (m !== n.midi) { n.midi = m; this.onPreview(m); }
        c.style.cursor = 'grabbing';
      } else {
        n.len = Math.max(this.grid, snap(d.len + dxBeats));
      }
      this.draw();
      this.onSelect(this.sel);
    });
    const end = () => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      // keep notes sorted and selection stable
      const n = this.notes[d.i];
      this.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
      this.sel = this.notes.indexOf(n);
      this.resize();
      this.onSelect(this.sel);
      if (d.moved || d.mode === 'create') this.onChange(d.mode);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      const p = this._pos(e);
      const h = this.hit(p.x, p.y);
      if (h) { this.sel = h.i; this.onSelect(h.i); this.onEditLyric(h.i); }
    });
    c.addEventListener('keydown', (e) => {
      if (this.sel < 0) return;
      const n = this.notes[this.sel];
      let handled = true;
      if (e.key === 'Delete' || e.key === 'Backspace') { this.notes.splice(this.sel, 1); this.sel = -1; this.onChange('delete'); }
      else if (e.key === 'ArrowUp') { n.midi = Math.min(this.hi, n.midi + (e.shiftKey ? 12 : 1)); this.onPreview(n.midi); this.onChange('pitch'); }
      else if (e.key === 'ArrowDown') { n.midi = Math.max(this.lo, n.midi - (e.shiftKey ? 12 : 1)); this.onPreview(n.midi); this.onChange('pitch'); }
      else if (e.key === 'ArrowLeft') { n.start = Math.max(0, n.start - this.grid); this.onChange('move'); }
      else if (e.key === 'ArrowRight') { n.start += this.grid; this.onChange('move'); }
      else if (e.key === 'Enter') { this.onEditLyric(this.sel); }
      else handled = false;
      if (handled) { e.preventDefault(); this.notes.sort((a, b) => a.start - b.start); if (n) this.sel = this.notes.indexOf(n); this.resize(); this.onSelect(this.sel); }
    });
    this.wrap.addEventListener('scroll', () => this.draw());
  };

  root.Lumen = root.Lumen || {};
  root.Lumen.PianoRoll = PianoRoll;
})(typeof window !== 'undefined' ? window : globalThis);
