// ui.js —— 蜘蛛纸牌 UI 层（画布渲染 + 交互 + 动画 + 声音 + 计时 + 存档）
//
// 规则一律问 Rules/Game，这里不改牌数据、不自己判规则。
// 横屏优先：顶部（难度/时间/步数 + 8 完成槽），中间 10 列画布，底部（悔棋/提示/菜单 + 右下牌库）。

(function () {
  'use strict';
  const C = globalThis.Cards, R = globalThis.Rules, G = globalThis.Game;

  const el = id => document.getElementById(id);
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ============ 设置（持久化，与牌局分开） ============ */
  const SETTINGS_KEY = 'zhizhu-settings';
  const LAST_DIFF_KEY = 'zhizhu-lastdiff';

  // —— 胜利统计（按难度 0简单/1普通/2困难）——
  const STATS_KEY = 'zhizhu-stats-v1';
  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null') || {};
      for (let d = 0; d < 3; d++) if (typeof s[d] !== 'number') s[d] = 0;
      return s;
    } catch (e) { return { 0: 0, 1: 0, 2: 0 }; }
  }
  function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {} }
  function recordWin(diff) {
    const s = loadStats();
    s[diff] = (s[diff] || 0) + 1;
    saveStats(s);
  }
  function renderStats() {
    const elStats = el('stats');
    if (!elStats) return;
    const s = loadStats();
    const parts = [];
    for (let d = 0; d < 3; d++) parts.push(C.DIFFICULTIES[d].name + ' ' + (s[d] || 0) + ' 局');
    elStats.textContent = '胜利：' + parts.join('　');
  }
  const TUTORIAL_KEY = 'zhizhu-tutorial-done';
  function loadSettings() {
    try { return Object.assign({ sound: true, vibrate: true, cardSize: 1, animSpeed: 1, clickMove: true, dragMove: true }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch (e) { return { sound: true, vibrate: true, cardSize: 1, animSpeed: 1, clickMove: true, dragMove: true }; }
  }
  let S = loadSettings();
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); }
  const SPEED_MUL = [1.6, 1.0, 0.6];
  const CARD_FRAC = [0.72, 0.85, 0.95];

  /* ============ 声音（WebAudio 合成，不依赖外部音频文件） ============ */
  let actx = null;
  function ac() { if (!actx) { const A = window.AudioContext || window.webkitAudioContext; if (A) actx = new A(); } return actx; }
  function tone(freq, dur, type, vol, delay) {
    if (!S.sound) return;
    const c = ac(); if (!c) return;
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      const t = c.currentTime + (delay || 0);
      g.gain.setValueAtTime(vol || 0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + (dur || 0.08) + 0.03);
    } catch (e) {}
  }
  function sfx(name) {
    if (name === 'select') tone(540, 0.05, 'sine', 0.12);
    else if (name === 'place') { tone(360, 0.06, 'triangle', 0.15); tone(490, 0.07, 'triangle', 0.11, 0.045); }
    else if (name === 'flip') tone(620, 0.05, 'sine', 0.11);
    else if (name === 'deal') { for (let i = 0; i < 3; i++) tone(300 + i * 70, 0.045, 'triangle', 0.09, i * 0.035); }
    else if (name === 'complete') { tone(520, 0.09, 'sine', 0.17); tone(660, 0.11, 'sine', 0.17, 0.09); tone(790, 0.15, 'sine', 0.17, 0.18); }
    else if (name === 'win') { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'sine', 0.18, i * 0.12)); }
    else if (name === 'error') tone(200, 0.09, 'square', 0.07);
  }
  function vibrate(ms) { if (S.vibrate && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

  /* ============ 状态 ============ */
  let state = null;
  let elapsedMs = 0;
  let sel = null;            // { col, idx }（idx = 点击的那张牌，从它往上是可移动牌组）
  let hintMove = null, hintUntil = 0;
  let emptyFlashUntil = 0;
  let busy = false;          // 动画进行中锁输入
  let gameActive = false;    // 是否正处在对局画面（决定设置/教学返回哪里）

  /* ============ 画布与布局 ============ */
  const canvas = el('board');
  const ctx = canvas.getContext('2d');
  const backImg = new Image();
  let cardRatio = 0.75;
  backImg.onload = () => { cardRatio = backImg.naturalWidth / backImg.naturalHeight || 0.75; relayout(); render(); };
  backImg.src = 'assets/cat-back.jpg';

  let dpr = 1, W = 0, H = 0;
  let margin = 4, gap = 4, anchorTop = 4, baseY = 4, cardW = 60, cardH = 80, gapBudget = 0;
  let geos = [];            // 每列几何缓存

  function colX(i) { return margin + i * (cardW + gap); }

  // 每列几何：自顶向下，index 0 在最上（最先发的那张）。返回 tops（含一个追加位）。
  function geoFor(col) {
    const n = col.length;
    let nd = 0, nu = 0;
    for (let i = 0; i < n - 1; i++) { if (col[i].u) nu++; else nd++; }
    const dyDownMax = cardH * 0.10, dyUpMax = cardH * 0.30;
    const dyDownMin = cardH * 0.05, dyUpMin = cardH * 0.12;
    let dyDown = dyDownMax, dyUp = dyUpMax;
    if (n > 1 && gapBudget > 0) {
      if (nu > 0) {
        dyUp = Math.max(dyUpMin, Math.min(dyUpMax, (gapBudget - nd * dyDown) / nu));
        if (cardH + nd * dyDown + nu * dyUp > gapBudget + cardH && nd > 0) {
          dyDown = Math.max(dyDownMin, (gapBudget - nu * dyUp) / nd);
        }
      } else {
        dyDown = Math.max(dyDownMin, Math.min(dyDownMax, gapBudget / nd));
      }
    }
    const tops = new Array(n + 1);
    let y = anchorTop;
    for (let i = 0; i <= n; i++) { tops[i] = y; if (i < n) y += (col[i].u ? dyUp : dyDown); }
    return { dyDown, dyUp, tops, n };
  }

  function relayout() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    W = cw; H = ch;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    margin = Math.max(4, W * 0.01);
    gap = Math.max(4, W * 0.006);
    anchorTop = Math.max(2, H * 0.02);
    baseY = H - Math.max(2, H * 0.02);
    const cwWidth = (W - 2 * margin - 9 * gap) / 10;
    const cwHeight = (baseY - anchorTop) * CARD_FRAC[S.cardSize] * cardRatio;
    cardW = Math.max(30, Math.min(cwWidth, cwHeight));
    cardH = cardW / cardRatio;
    gapBudget = baseY - anchorTop - cardH;
    geos = state ? state.tableau.map(geoFor) : [];
  }

  /* ============ 绘制 ============ */
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function withScale(x, y, w, h, sx, fn) {
    if (sx === 1) { fn(); return; }
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, 1); ctx.translate(-cx, -cy);
    fn(); ctx.restore();
  }
  function drawCardBack(x, y, w, h) {
    roundRect(x, y, w, h, w * 0.12);
    ctx.fillStyle = '#5a6b7d'; ctx.fill();
    if (backImg.naturalWidth) {
      const iw = backImg.naturalWidth, ih = backImg.naturalHeight;
      const ir = iw / ih, cr = w / h;
      let sx = 0, sy = 0, sw = iw, sh = ih;
      if (ir > cr) { sh = ih; sw = ih * cr; sx = (iw - sw) / 2; }
      else { sw = iw; sh = iw / cr; sy = (ih - sh) / 2; }
      ctx.save(); roundRect(x, y, w, h, w * 0.12); ctx.clip();
      ctx.drawImage(backImg, sx, sy, sw, sh, x, y, w, h);
      ctx.restore();
    }
    roundRect(x, y, w, h, w * 0.12);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, w * 0.03); ctx.stroke();
  }
  function drawCardFace(x, y, w, h, card, visibleH) {
    roundRect(x, y, w, h, w * 0.12);
    ctx.fillStyle = '#fdfdfb'; ctx.fill();
    roundRect(x, y, w, h, w * 0.12);
    ctx.strokeStyle = '#c8ccd2'; ctx.lineWidth = Math.max(1, w * 0.02); ctx.stroke();

    const red = (card.s === 1 || card.s === 3);
    const color = red ? '#c0392b' : '#1a1a1a';
    const rank = C.rankText(card.r), suit = C.SUITS[card.s];
    const isTop = (visibleH >= h - 1);
    const fs = Math.max(9, Math.min(h * 0.30, visibleH * 0.78));

    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = 'bold ' + fs + 'px Arial, "Segoe UI", sans-serif';
    const px = x + w * 0.05, py = y + h * 0.015;
    ctx.fillText(rank, px, py);
    const rw = ctx.measureText(rank).width;
    ctx.font = fs * 0.85 + 'px Arial, "Segoe UI", sans-serif';
    ctx.fillText(suit, px + rw + w * 0.04, py + h * 0.02);

    // 中间大花色（只有整张可见的顶牌才画，避免压住被遮住的部分）
    if (isTop && h > 40) {
      ctx.globalAlpha = 0.14;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = (h * 0.52) + 'px Arial, "Segoe UI", sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(suit, x + w * 0.63, y + h * 0.52);
      ctx.globalAlpha = 1;
    }
  }
  function drawCard(x, y, w, h, card, visibleH) {
    if (card.u) drawCardFace(x, y, w, h, card, visibleH);
    else drawCardBack(x, y, w, h);
  }

  function drawFelt() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2e7d4f'); g.addColorStop(1, '#256a41');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  function strokeRect(x, y, w, h, color, lw, dash) {
    roundRect(x, y, w, h, w * 0.12);
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw; if (dash) ctx.setLineDash(dash);
    ctx.stroke(); ctx.restore();
  }

  let hide = null;      // { col, fromIdx, count } 移动/拖动期间在源列隐藏的牌
  let ghostCards = null; // [{ card, x, y }]

  function render() {
    if (!state) return;
    if (!W || !H) relayout();
    if (!W || !H) return;
    geos = state.tableau.map(geoFor);
    drawFelt();

    // 各列
    for (let c = 0; c < 10; c++) {
      const col = state.tableau[c], geo = geos[c], x = colX(c);
      for (let idx = 0; idx < col.length; idx++) {
        if (hide && hide.col === c && idx >= hide.fromIdx && idx < hide.fromIdx + hide.count) continue;
        if (flipping(c, idx)) continue;
        const visibleH = (idx === col.length - 1) ? cardH : (col[idx].u ? geo.dyUp : geo.dyDown);
        drawCard(x, geo.tops[idx], cardW, cardH, col[idx], visibleH);
      }
    }

    drawHighlights();
    drawFlips();
    drawGhosts();
  }

  // 选中/提示/空列高亮
  function drawHighlights() {
    // 发牌失败的空列闪烁
    if (performance.now() < emptyFlashUntil) {
      for (let c = 0; c < 10; c++) if (!state.tableau[c].length) {
        strokeRect(colX(c), anchorTop, cardW, cardH, '#ffd34d', 3, [6, 4]);
      }
    }
    // 选中：跑动高亮 + 合法目标
    if (sel) {
      const col = state.tableau[sel.col], geo = geos[sel.col];
      const run = R.movableStack(col, sel.idx); // 只框真正能一起移动的同花降序牌组
      if (run) {
        for (let k = 0; k < run.length; k++) {
          strokeRect(colX(sel.col), geo.tops[sel.idx + k], cardW, cardH, '#ffd34d', 3);
        }
        for (let t = 0; t < 10; t++) {
          if (t === sel.col) continue;
          if (R.canPlaceOn(run[0], state.tableau[t])) {
            if (state.tableau[t].length) {
              const g = geos[t], top = state.tableau[t].length - 1;
              ctx.save(); ctx.globalAlpha = 0.35; roundRect(colX(t), g.tops[top], cardW, cardH, cardW * 0.12); ctx.fillStyle = '#7be08a'; ctx.fill(); ctx.restore();
            } else {
              strokeRect(colX(t), anchorTop, cardW, cardH, '#7be08a', 3, [6, 4]);
            }
          }
        }
      }
    }
    // 提示：脉冲高亮
    if (hintMove && performance.now() < hintUntil) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
      const col = state.tableau[hintMove.from], geo = geos[hintMove.from];
      const run = R.movableStack(col, hintMove.fromIdx);
      const n = run ? run.length : (col.length - hintMove.fromIdx);
      for (let k = 0; k < n; k++) {
        ctx.save(); ctx.globalAlpha = 0.4 + 0.4 * pulse;
        roundRect(colX(hintMove.from), geo.tops[hintMove.fromIdx + k], cardW, cardH, cardW * 0.12); ctx.fillStyle = '#ffb13d'; ctx.fill(); ctx.restore();
      }
      const g2 = geos[hintMove.to];
      const ty = state.tableau[hintMove.to].length ? g2.tops[state.tableau[hintMove.to].length - 1] : anchorTop;
      strokeRect(colX(hintMove.to), ty, cardW, cardH, '#ffb13d', 3.5, [6, 4]);
    }
  }

  // 翻牌动画
  let flips = [];   // { col, idx, t0, dur }
  function flipping(c, idx) { return flips.some(f => f.col === c && f.idx === idx); }
  function drawFlips() {
    const now = performance.now();
    for (const f of flips) {
      const card = state.tableau[f.col] && state.tableau[f.col][f.idx];
      if (!card) continue;
      const geo = geos[f.col], x = colX(f.col), y = geo.tops[f.idx];
      const p = Math.min(1, (now - f.t0) / f.dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const sx = Math.abs(Math.cos(e * Math.PI)); // 0..1..0
      if (e < 0.5) withScale(x, y, cardW, cardH, sx, () => drawCardBack(x, y, cardW, cardH));
      else withScale(x, y, cardW, cardH, sx, () => drawCardFace(x, y, cardW, cardH, card, cardH));
    }
  }

  function drawGhosts() {
    if (!ghostCards) return;
    for (const g of ghostCards) {
      if (g.card.u) drawCardFace(g.x, g.y, cardW, cardH, g.card, cardH);
      else drawCardBack(g.x, g.y, cardW, cardH);
    }
  }

  /* ============ 动画循环 ============ */
  let tweens = [];
  let animating = false, rafId = 0;
  function addTween(dur, onFrame, onEnd) {
    tweens.push({ t0: performance.now(), dur, onFrame, onEnd });
    startLoop();
  }
  function needsAnim() {
    const now = performance.now();
    return tweens.length > 0 || flips.length > 0 ||
      (hintMove && now < hintUntil) || now < emptyFlashUntil;
  }
  function loop(now) {
    const done = [];
    for (const t of tweens) { let p = Math.min(1, (now - t.t0) / t.dur); t.onFrame(p); if (p >= 1) done.push(t); }
    if (done.length) { tweens = tweens.filter(t => done.indexOf(t) < 0); done.forEach(t => t.onEnd && t.onEnd()); }
    flips = flips.filter(f => (now - f.t0) < f.dur);
    render();
    if (needsAnim()) rafId = requestAnimationFrame(loop);
    else { animating = false; if (ghostCards && !hide) ghostCards = null; }
  }
  function startLoop() { if (!animating) { animating = true; rafId = requestAnimationFrame(loop); } }
  const ease = p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

  /* ============ 交互（点击 + 拖动） ============ */
  let down = null;

  function canvasPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function hitTest(x, y) {
    for (let c = 0; c < 10; c++) {
      if (x < colX(c) || x > colX(c) + cardW) continue;
      const col = state.tableau[c];
      if (!col.length) return { col: c, idx: -1 };
      const geo = geoFor(col);
      for (let idx = col.length - 1; idx >= 0; idx--) {
        const ty = geo.tops[idx];
        const stripH = (idx === col.length - 1) ? cardH : (col[idx].u ? geo.dyUp : geo.dyDown);
        if (y >= ty && y < ty + stripH) return { col: c, idx };
      }
      return { col: c, idx: -1 };
    }
    return null;
  }
  function columnAt(x) {
    for (let c = 0; c < 10; c++) if (x >= colX(c) - gap / 2 && x <= colX(c) + cardW + gap / 2) return c;
    return -1;
  }

  canvas.addEventListener('pointerdown', e => {
    if (!state || state.status !== 'playing') return;
    if (busy) return;
    if (!S.dragMove && !S.clickMove) return;
    hide = null; ghostCards = null; // 清理上次拖拽可能残留的状态，防止牌消失
    const pt = canvasPoint(e);
    const hit = hitTest(pt.x, pt.y);
    if (!hit || hit.idx < 0) { clearSel(); return; }
    const col = state.tableau[hit.col];
    if (!col[hit.idx].u) return;
    const geo = geoFor(col);
    down = { x: pt.x, y: pt.y, col: hit.col, idx: hit.idx, moved: false, grabDx: pt.x - colX(hit.col), grabDy: pt.y - geo.tops[hit.idx] };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });

  canvas.addEventListener('pointermove', e => {
    if (!down || !state) return;
    const pt = canvasPoint(e);
    if (!down.moved && Math.hypot(pt.x - down.x, pt.y - down.y) < 8) return;
    if (!S.dragMove) return;
    down.moved = true;
    const col = state.tableau[down.col];
    const run = R.movableStack(col, down.idx);
    if (!run) return;
    const geo = geoFor(col);
    hide = { col: down.col, fromIdx: down.idx, count: run.length };
    // 把拖拽的牌限制在画布内，别让牌被拖出屏幕「消失」
    const baseX = Math.max(0, Math.min(W - cardW, pt.x - down.grabDx));
    const baseY = Math.max(0, Math.min(H - cardH, pt.y - down.grabDy));
    const top0 = geo.tops[down.idx];
    ghostCards = run.map((c, k) => ({ card: c, x: baseX, y: baseY + (geo.tops[down.idx + k] - top0) }));
    render();
  });

  function endDrag(pt) {
    if (!down || !state) return;
    const from = down.col, fromIdx = down.idx;
    const wasDrag = down.moved;
    down = null;
    if (wasDrag) {
      const to = columnAt(pt.x);
      const run = R.movableStack(state.tableau[from], fromIdx);
      if (to >= 0 && to !== from && run && R.canPlaceOn(run[0], state.tableau[to])) {
        // 从当前拖动位置起飞，落到目标列
        commitMoveWithAnim(from, fromIdx, to, ghostCards);
      } else {
        // 平滑返回原位
        snapBack(from, fromIdx, ghostCards);
      }
      ghostCards = null;
    } else {
      hide = null; ghostCards = null;
      handleTap(pt.x, pt.y);
    }
    render();
  }

  canvas.addEventListener('pointerup', e => endDrag(canvasPoint(e)));
  canvas.addEventListener('pointercancel', () => { down = null; hide = null; ghostCards = null; render(); });

  // 兜底：手指在画布外松手（或 capture 失效）时，canvas 收不到 pointerup，
  // 用 window 级监听收尾，保证拖拽状态一定被清理，牌不会悬空/消失导致「卡死」。
  window.addEventListener('pointerup', e => endDrag(canvasPoint(e)));
  window.addEventListener('pointercancel', () => { down = null; hide = null; ghostCards = null; render(); });

  function handleTap(x, y) {
    if (!state || state.status !== 'playing') return;
    if (busy) return;
    if (!S.clickMove) { clearSel(); return; }
    const hit = hitTest(x, y);
    if (!hit) { clearSel(); return; }
    // 点到空列 → 若已有选中且能进空列，就移动
    if (hit.idx < 0) {
      if (sel) { tryMoveToColumn(hit.col); } else clearSel();
      return;
    }
    const col = state.tableau[hit.col];
    const card = col[hit.idx];
    if (!card.u) { clearSel(); return; }

    // 再次点同一张牌：若只有一个明显目标 → 智能移动；否则取消选中
    if (sel && sel.col === hit.col && sel.idx === hit.idx) {
      const run = R.movableStack(col, hit.idx);
      const targets = legalTargets(sel.col, run);
      if (targets.length === 1) { tryMoveToColumn(targets[0]); }
      else { clearSel(); }
      return;
    }
    // 已选中时点目标列 → 移动
    if (sel) {
      const run = R.movableStack(state.tableau[sel.col], sel.idx);
      if (run && R.canPlaceOn(run[0], state.tableau[hit.col]) && hit.col !== sel.col) {
        tryMoveToColumn(hit.col);
        return;
      }
    }
    // 否则选中这张牌（从它往上的同花连续牌组）
    sel = { col: hit.col, idx: hit.idx };
    sfx('select'); render();
  }

  function legalTargets(from, run) {
    const ts = [];
    for (let t = 0; t < 10; t++) if (t !== from && R.canPlaceOn(run[0], state.tableau[t])) ts.push(t);
    return ts;
  }
  function tryMoveToColumn(to) {
    if (!sel) return;
    const run = R.movableStack(state.tableau[sel.col], sel.idx);
    if (run && R.canPlaceOn(run[0], state.tableau[to])) {
      commitMoveWithAnim(sel.col, sel.idx, to, null);
      sel = null;
    }
  }
  function clearSel() { sel = null; }

  /* ============ 动作 ============ */
  function commitMoveWithAnim(from, fromIdx, to, startRectsOverride) {
    const src = state.tableau[from];
    const run = R.movableStack(src, fromIdx);
    if (!run || !R.canPlaceOn(run[0], state.tableau[to])) return;
    sfx('place');
    const dst = state.tableau[to];
    const finalCol = dst.concat(run);
    const geoFinal = geoFor(finalCol);
    const geoSrc = geoFor(src);
    const startRects = startRectsOverride || run.map((c, k) => ({ x: colX(from), y: geoSrc.tops[fromIdx + k] }));
    const endRects = run.map((c, k) => ({ x: colX(to), y: geoFinal.tops[dst.length + k] }));
    const dur = 180 * SPEED_MUL[S.animSpeed];
    busy = true;
    hide = { col: from, fromIdx, count: run.length };
    addTween(dur, p => {
      const e = ease(p);
      ghostCards = run.map((c, k) => ({ card: c, x: startRects[k].x + (endRects[k].x - startRects[k].x) * e, y: startRects[k].y + (endRects[k].y - startRects[k].y) * e }));
    }, () => {
      hide = null; ghostCards = null;
      const r = Game.move(state, from, fromIdx, to);
      busy = false;
      afterMove(r, from);
    });
  }

  function snapBack(from, fromIdx, ghost) {
    const col = state.tableau[from];
    const run = R.movableStack(col, fromIdx);
    if (!run) { hide = null; return; }
    const geo = geoFor(col);
    const startRects = (ghost || []).map(g => ({ x: g.x, y: g.y }));
    const endRects = run.map((c, k) => ({ x: colX(from), y: geo.tops[fromIdx + k] }));
    if (!startRects.length) { hide = null; return; }
    const dur = 150 * SPEED_MUL[S.animSpeed];
    hide = { col: from, fromIdx, count: run.length };
    addTween(dur, p => {
      const e = ease(p);
      ghostCards = run.map((c, k) => ({ card: c, x: startRects[k].x + (endRects[k].x - startRects[k].x) * e, y: startRects[k].y + (endRects[k].y - startRects[k].y) * e }));
    }, () => { hide = null; ghostCards = null; });
  }

  function afterMove(r, from) {
    if (r.flipped) { animateFlip(from, Math.max(0, state.tableau[from].length - 1)); sfx('flip'); }
    if (r.completed > 0) { sfx('complete'); vibrate(40); celebrateComplete(r.completed, from); }
    save(); updateHUD(); render();
    if (state.status === 'won') onWin();
    else checkStuck();
  }

  function animateFlip(col, idx) {
    if (idx < 0 || !state.tableau[col][idx]) return;
    flips.push({ col, idx, t0: performance.now(), dur: 220 * SPEED_MUL[S.animSpeed] });
    startLoop();
  }

  function doDeal() {
    if (!state || state.status !== 'playing') return;
    if (busy) return;
    if (!R.canDeal(state)) {
      if (state.stock.length === 0) { toast('没有牌可以发了'); sfx('error'); }
      else { toast('请先在空位放一张牌'); emptyFlashUntil = performance.now() + 1300; sfx('error'); }
      startLoop(); return;
    }
    clearSel(); clearHint(); sfx('deal');
    const dealt = state.stock.slice(0, 10);
    const startX = W - cardW - margin * 1.5, startY = Math.max(0, H - cardH * 0.45);
    const starts = dealt.map(() => ({ x: startX, y: startY }));
    const ends = state.tableau.map((col, i) => { const g = geoFor(col); return { x: colX(i), y: g.tops[col.length] }; });
    const dur = 260 * SPEED_MUL[S.animSpeed];
    busy = true;
    hide = null;
    addTween(dur, p => {
      const e = ease(p);
      ghostCards = dealt.map((c, k) => ({ card: { s: c.s, r: c.r, u: 1 }, x: starts[k].x + (ends[k].x - starts[k].x) * e, y: starts[k].y + (ends[k].y - starts[k].y) * e }));
    }, () => {
      ghostCards = null;
      Game.deal(state);
      busy = false;
      save(); updateHUD(); render(); checkStuck();
    });
  }

  function doUndo() {
    if (!state || state.status !== 'playing') return;
    if (busy) return;
    clearSel(); clearHint();
    if (G.undo(state)) { sfx('flip'); save(); updateHUD(); render(); checkStuck(); }
    else { toast('没有可以悔棋的了'); sfx('error'); }
  }

  function doHint() {
    if (!state || state.status !== 'playing') return;
    if (busy) return;
    clearSel();
    const mv = G.hint(state);
    if (!mv) { toast('没有可移动的牌了'); sfx('error'); return; }
    state.hintCount++;
    hintMove = mv; hintUntil = performance.now() + 3000;
    sfx('select'); save(); render(); startLoop();
    setTimeout(() => { if (hintMove === mv) { hintMove = null; render(); } }, 3100);
  }
  function clearHint() { hintMove = null; }

  function checkStuck() {
    const s = G.stuck(state);
    if (s === 'deal') { toast('没有可移动的牌了，可以发一组新牌'); flashStock(); }
    else if (s === 'stuck') showScreen('overlay-stuck');
  }

  function celebrateComplete(n, col) {
    // 简单庆祝：文字 + 收牌飞入右上（装饰）
    const msg = (state.completed >= 8) ? '全部完成！' : (state.completed === 1 ? '完成一组！' : '好棋！');
    cheer(msg);
    // 一组牌缩小飞向完成区（装饰性）
    const geo = geos[col];
    const startY = geo ? geo.tops[Math.max(0, state.tableau[col].length - 1)] : H * 0.3;
    const startX = colX(col);
    const ghost = Array.from({ length: Math.min(13, 13) }, (_, i) => ({ card: { s: 0, r: 13 - i, u: 1 }, x: startX, y: startY - i * 2 }));
    addTween(360 * SPEED_MUL[S.animSpeed], p => {
      const e = ease(p);
      const gx = W * 0.78, gy = H * 0.02;
      ghostCards = ghost.map((g, k) => ({ card: g.card, x: g.x + (gx - g.x) * e, y: g.y + (gy - g.y) * e - k * 3, w: cardW, h: cardH }));
    }, () => { ghostCards = null; });
  }

  function onWin() {
    save(); localStorage.removeItem(G.SAVE_KEY);
    recordWin(state.difficulty);
    const t = formatTime(Math.round(elapsedMs / 1000));
    el('win-sub').textContent = '用时 ' + t + '　步数 ' + state.moveCount + '　悔棋 ' + state.undoCount + '　提示 ' + state.hintCount;
    sfx('win'); cheer('恭喜完成！');
    setTimeout(() => showScreen('overlay-win'), 400);
  }

  /* ============ HUD ============ */
  function formatTime(s) { const m = Math.floor(s / 60), ss = s % 60; return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss; }
  function updateHUD() {
    const d = C.DIFFICULTIES[state.difficulty];
    el('info-diff').textContent = d.name + ' · ' + d.suitDesc;
    el('info-moves').textContent = '步数 ' + state.moveCount;
    el('info-time').textContent = '时间 ' + formatTime(Math.round(elapsedMs / 1000));
    // 完成槽
    const slots = el('slots');
    slots.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('div');
      s.className = 'slot' + (i < state.completed ? ' full' : '');
      s.textContent = i < state.completed ? '✓' : '';
      slots.appendChild(s);
    }
    // 牌库
    const groups = Math.ceil(state.stock.length / 10);
    el('stock-count').textContent = groups;
    el('stock').classList.toggle('empty', state.stock.length === 0);
  }

  /* ============ 存档 ============ */
  function save() {
    if (!state) return;
    state.elapsed = Math.round(elapsedMs / 1000);
    try { localStorage.setItem(G.SAVE_KEY, G.serialize(state)); } catch (e) {}
  }
  function hasSave() { return !!localStorage.getItem(G.SAVE_KEY); }

  /* ============ 计时 ============ */
  let running = true, lastNow = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (running && state && state.status === 'playing') { elapsedMs += now - lastNow; el('info-time').textContent = '时间 ' + formatTime(Math.round(elapsedMs / 1000)); }
    lastNow = now;
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; save(); }
    else { running = true; lastNow = Date.now(); }
  });
  window.addEventListener('beforeunload', save);

  /* ============ 屏幕切换 / 浮字 ============ */
  function showScreen(name) {
    const target = el(name);
    if (!target) return;
    const isOverlay = target.classList.contains('overlay');
    if (!isOverlay) {
      $$('.screen').forEach(s => s.classList.add('hidden'));
      $$('.overlay').forEach(o => o.classList.add('hidden'));
    } else {
      $$('.overlay').forEach(o => o.classList.add('hidden'));
    }
    target.classList.remove('hidden');
    // 从菜单进入对局时，屏幕尺寸可能刚变，重排
    if (name === 'screen-game') requestAnimationFrame(() => { relayout(); render(); updateHUD(); });
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 1900);
  }
  let cheerTimer = 0;
  function cheer(msg) {
    const c = el('cheer');
    c.textContent = msg;
    c.classList.remove('hidden');
    c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => c.classList.add('hidden'), 1300);
  }
  function flashStock() {
    const s = el('stock');
    s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash');
    setTimeout(() => s.classList.remove('flash'), 1800);
  }

  /* ============ 游戏流程 ============ */
  function newGame(difficulty) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    state = G.newState(difficulty, seed);
    elapsedMs = 0; sel = null; hintMove = null; hide = null; ghostCards = null; flips = []; tweens = []; busy = false;
    localStorage.setItem(LAST_DIFF_KEY, String(difficulty));
    save();
    gameActive = true;
    showScreen('screen-game');
    updateHUD();
    if (!localStorage.getItem(TUTORIAL_KEY)) showScreen('overlay-tutorial');
  }
  function continueGame() {
    const json = localStorage.getItem(G.SAVE_KEY);
    if (!json) return;
    const st = G.deserialize(json);
    if (!st) return;
    state = st; elapsedMs = (state.elapsed || 0) * 1000;
    sel = null; hintMove = null; hide = null; ghostCards = null; flips = []; tweens = []; busy = false;
    gameActive = true;
    showScreen('screen-game');
    updateHUD();
  }
  function refreshMenu() {
    el('btn-continue').classList.toggle('hidden', !hasSave());
    renderStats();
  }
  function toMenu() { save(); gameActive = false; showScreen('screen-menu'); refreshMenu(); }
  function showDifficulty() {
    const last = Number(localStorage.getItem(LAST_DIFF_KEY) || '0');
    $$('.diff-card').forEach(b => b.classList.toggle('current', Number(b.dataset.d) === last));
    showScreen('screen-difficulty');
  }

  /* ============ 设置 UI ============ */
  function applySettingsUI() {
    el('set-sound').textContent = S.sound ? '开' : '关'; el('set-sound').classList.toggle('on', S.sound);
    el('set-vibrate').textContent = S.vibrate ? '开' : '关'; el('set-vibrate').classList.toggle('on', S.vibrate);
    el('set-click').textContent = S.clickMove ? '开' : '关'; el('set-click').classList.toggle('on', S.clickMove);
    el('set-drag').textContent = S.dragMove ? '开' : '关'; el('set-drag').classList.toggle('on', S.dragMove);
    el('btn-menu-sound').textContent = '音效：' + (S.sound ? '开' : '关');
    el('btn-menu-vibrate').textContent = '震动：' + (S.vibrate ? '开' : '关');
    $$('#set-cardsize .seg-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === S.cardSize));
    $$('#set-animspeed .seg-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === S.animSpeed));
  }

  /* ============ 事件绑定 ============ */
  function bind() {
    // 主菜单
    el('btn-continue').addEventListener('click', continueGame);
    el('btn-new').addEventListener('click', showDifficulty);
    el('btn-settings').addEventListener('click', () => showScreen('overlay-settings'));
    // 难度
    $$('.diff-card').forEach(b => b.addEventListener('click', () => newGame(Number(b.dataset.d))));
    el('btn-diff-back').addEventListener('click', () => { showScreen('screen-menu'); refreshMenu(); });
    // 对局底部
    el('btn-undo').addEventListener('click', doUndo);
    el('btn-hint').addEventListener('click', doHint);
    el('btn-menu').addEventListener('click', () => showScreen('overlay-menu'));
    el('stock').addEventListener('click', doDeal);
    // 菜单覆盖层
    el('btn-resume').addEventListener('click', () => showScreen('screen-game'));
    el('btn-menu-sound').addEventListener('click', () => { S.sound = !S.sound; saveSettings(); applySettingsUI(); });
    el('btn-menu-vibrate').addEventListener('click', () => { S.vibrate = !S.vibrate; saveSettings(); applySettingsUI(); });
    el('btn-menu-settings').addEventListener('click', () => showScreen('overlay-settings'));
    el('btn-restart').addEventListener('click', () => { if (state) newGame(state.difficulty); });
    el('btn-exit').addEventListener('click', toMenu);
    // 设置覆盖层
    el('set-sound').addEventListener('click', () => { S.sound = !S.sound; saveSettings(); applySettingsUI(); });
    el('set-vibrate').addEventListener('click', () => { S.vibrate = !S.vibrate; saveSettings(); applySettingsUI(); });
    el('set-click').addEventListener('click', () => { S.clickMove = !S.clickMove; saveSettings(); applySettingsUI(); });
    el('set-drag').addEventListener('click', () => { S.dragMove = !S.dragMove; saveSettings(); applySettingsUI(); });
    $$('#set-cardsize .seg-btn').forEach(b => b.addEventListener('click', () => { S.cardSize = Number(b.dataset.v); saveSettings(); applySettingsUI(); relayout(); render(); }));
    $$('#set-animspeed .seg-btn').forEach(b => b.addEventListener('click', () => { S.animSpeed = Number(b.dataset.v); saveSettings(); applySettingsUI(); }));
    el('btn-tutorial').addEventListener('click', () => showScreen('overlay-tutorial'));
    el('btn-settings-back').addEventListener('click', () => {
      // 从菜单进设置 → 回菜单；从游戏菜单进设置 → 回游戏菜单
      showScreen(gameActive ? 'overlay-menu' : 'screen-menu');
    });
    // 教学
    el('btn-tutorial-close').addEventListener('click', () => {
      localStorage.setItem(TUTORIAL_KEY, '1');
      showScreen(gameActive ? 'screen-game' : 'screen-menu');
    });
    // 结算
    el('btn-win-again').addEventListener('click', () => { if (state) newGame(state.difficulty); });
    el('btn-win-home').addEventListener('click', toMenu);
    // 走不下去
    el('btn-stuck-undo').addEventListener('click', () => { showScreen('screen-game'); doUndo(); });
    el('btn-stuck-restart').addEventListener('click', () => { if (state) newGame(state.difficulty); });
  }

  /* ============ 初始化 ============ */
  window.addEventListener('resize', () => { relayout(); render(); });
  function init() {
    applySettingsUI();
    bind();
    showScreen('screen-menu');
    refreshMenu();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  globalThis.ZhizhuUI = { newGame, continueGame, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.ZhizhuUI;
})();
