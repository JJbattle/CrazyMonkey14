// ui.js —— 跳棋 界面 + 交互 + AI 调度 + 存档（只调用 game/rules/ai/board，不碰规则本身）
//
// 屏幕：menu(主菜单) / setup(开局设置) / game(对局)
// 交互：纯点击，不拖拽。AI 回合一步步播动画，不瞬移。

(function () {
  'use strict';
  const B = globalThis.Board;
  const G = globalThis.Game;
  const AI = globalThis.AI;

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const screenMenu = $('screen-menu'), screenSetup = $('screen-setup'), screenGame = $('screen-game');
  const canvas = $('board'), ctx = canvas.getContext('2d');
  const turnAvatar = $('turn-avatar'), turnText = $('turn-text');
  const hint = $('hint'), btnEndChain = $('btn-end-chain');
  const cheerEl = $('cheer');
  const overlayMenu = $('overlay-menu'), overlayWin = $('overlay-win');
  const overlayDebug = $('overlay-debug'), debugContent = $('debug-content');
  const winTitle = $('win-title'), winSub = $('win-sub'), winBtns = $('win-btns');

  // ---------- 状态 ----------
  let game = null;          // 当前对局
  let screen = 'menu';
  let layout_ = { size: 0, ox: 0, oy: 0, spacing: 0 };
  let anim = null;          // AI/动画期间覆盖某棋子的绘制位置 {idx,pieceIdx,x,y}
  let aiTimer = null;
  let aiBusy = false;
  let soundOn = true;
  let showHints = true;     // 是否显示合法落点高亮（设置里可关）
  let aiLevel = 'normal';   // 当前对局难度（游戏界面可直接切换）
  let cheerTimer = null;
  let showDebug = false;    // 调试面板开关（菜单里切换）
  let lastAiResult = null;  // 最近一手 AI 的 {score, nodes, depth, timeMs, top5, breakdown}

  // 设置屏状态（长 6，前 playerCount 个生效）
  let setupCount = 2;
  let setupSeats = [
    { type: 'human', aiLevel: 'normal' },
    { type: 'ai', aiLevel: 'normal' },
    { type: 'ai', aiLevel: 'normal' },
    { type: 'ai', aiLevel: 'normal' },
    { type: 'ai', aiLevel: 'normal' },
    { type: 'ai', aiLevel: 'normal' },
  ];

  const SAVE_KEY = 'tiaoqi-save-v1';

  // ---------- 小工具 ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sameCell = (a, b) => a.q === b.q && a.r === b.r && a.s === b.s;
  function label(p) {
    const pl = game.players[p];
    if (p === 0 && pl.type === 'human') return '你';
    return pl.name + '方';
  }

  // ---------- 屏幕切换 ----------
  function show(el) {
    [screenMenu, screenSetup, screenGame].forEach(s => s.classList.add('hidden'));
    el.classList.remove('hidden');
  }
  function goMenu() {
    screen = 'menu';
    // 关键：回主菜单前先把所有覆盖层关掉，否则弹窗（尤其结算弹窗）还盖在菜单上，
    // 看着就像「点了返回却没反应」。
    overlayWin.classList.add('hidden');
    overlayMenu.classList.add('hidden');
    overlayDebug.classList.add('hidden');
    show(screenMenu);
    refreshMenu();
  }

  // ---------- 主菜单 ----------
  function refreshMenu() {
    $('btn-continue').classList.toggle('hidden', !hasSave());
    renderStats();
  }
  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  $('btn-start').addEventListener('click', () => {
    // 直接按默认开局：你 + 1 电脑（用当前难度）
    setupCount = 2;
    setupSeats = [
      { type: 'human', aiLevel: aiLevel },
      { type: 'ai', aiLevel: aiLevel },
      { type: 'ai', aiLevel: aiLevel },
      { type: 'ai', aiLevel: aiLevel },
      { type: 'ai', aiLevel: aiLevel },
      { type: 'ai', aiLevel: aiLevel },
    ];
    startGame();
  });

  $('btn-continue').addEventListener('click', () => {
    const d = loadSave();
    if (!d) return;
    game = G.createGame({ playerCount: d.playerCount, seats: d.seats });
    game.deserialize(d);
    enterGame();
  });

  $('btn-setup').addEventListener('click', () => {
    screen = 'setup';
    show(screenSetup);
    renderSetup();
  });

  // ---------- 设置屏 ----------
  const DIFF_NAMES = { easy: '简单', normal: '普通', hard: '困难', expert: '专家' };
  const DIFF_ORDER = ['easy', 'normal', 'hard', 'expert'];

  // —— 胜利统计（按难度；steps 是这些胜利的步数总和，用来算平均）——
  const STATS_KEY = 'tiaoqi-stats-v1';
  function loadStats() {
    const base = { easy: { win: 0, steps: 0 }, normal: { win: 0, steps: 0 }, hard: { win: 0, steps: 0 }, expert: { win: 0, steps: 0 } };
    try {
      const s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null') || {};
      for (const lv of DIFF_ORDER) { if (!s[lv]) s[lv] = { win: 0, steps: 0 }; }
      return s;
    } catch (e) { return JSON.parse(JSON.stringify(base)); }
  }
  function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {} }
  function recordWin(level, steps) {
    const s = loadStats();
    s[level].win++;
    s[level].steps += steps;
    saveStats(s);
  }
  function renderStats() {
    const el = $('stats');
    if (!el) return;
    const s = loadStats();
    const total = DIFF_ORDER.reduce((a, lv) => a + s[lv].win, 0);
    if (total === 0) { el.textContent = '还没有赢过，加油！'; return; }
    const parts = DIFF_ORDER.filter(lv => s[lv].win > 0).map(lv => {
      const d = s[lv];
      return DIFF_NAMES[lv] + ' 赢 ' + d.win + ' 局（均 ' + Math.round(d.steps / d.win) + ' 步）';
    });
    el.textContent = '胜利：' + parts.join('　');
  }

  function renderSetup() {
    const countWrap = $('count-btns');
    countWrap.innerHTML = '';
    for (let n = 2; n <= 6; n++) {
      const b = document.createElement('button');
      b.className = 'count-btn' + (n === setupCount ? ' on' : '');
      b.textContent = n;
      b.addEventListener('click', () => { setupCount = n; renderSetup(); });
      countWrap.appendChild(b);
    }

    const list = $('seat-list');
    list.innerHTML = '';
    for (let i = 0; i < setupCount; i++) {
      const st = G.PLAYER_STYLES[i];
      const row = document.createElement('div');
      row.className = 'seat-row';

      const info = document.createElement('div');
      info.className = 'seat-info';
      const dot = document.createElement('div');
      dot.className = 'seat-dot';
      dot.style.background = st.color;
      dot.textContent = st.symbol;
      const nm = document.createElement('span');
      nm.textContent = (i === 0 ? '你' : st.name + '方');
      info.appendChild(dot); info.appendChild(nm);

      const ctrl = document.createElement('div');
      ctrl.className = 'seat-ctrl';

      const typeBtn = document.createElement('button');
      typeBtn.className = 'toggle-btn' + (setupSeats[i].type === 'human' ? ' human' : '');
      typeBtn.textContent = setupSeats[i].type === 'human' ? '真人' : '电脑';
      typeBtn.addEventListener('click', () => {
        setupSeats[i].type = setupSeats[i].type === 'human' ? 'ai' : 'human';
        renderSetup();
      });

      ctrl.appendChild(typeBtn);

      if (setupSeats[i].type === 'ai') {
        for (const lv of DIFF_ORDER) {
          const db = document.createElement('button');
          db.className = 'diff-btn' + (setupSeats[i].aiLevel === lv ? ' on' : '');
          db.textContent = DIFF_NAMES[lv];
          db.addEventListener('click', () => { setupSeats[i].aiLevel = lv; renderSetup(); });
          ctrl.appendChild(db);
        }
      }

      row.appendChild(info); row.appendChild(ctrl);
      list.appendChild(row);
    }
  }

  $('btn-setup-back').addEventListener('click', goMenu);
  $('btn-setup-go').addEventListener('click', startGame);

  function updateHintsBtn() {
    const b = $('btn-hints');
    b.textContent = showHints ? '开' : '关';
    b.classList.toggle('human', showHints);
  }
  $('btn-hints').addEventListener('click', () => {
    showHints = !showHints;
    try { localStorage.setItem('tiaoqi-show-hints', showHints ? '1' : '0'); } catch (e) {}
    updateHintsBtn();
  });

  // —— 难度（游戏界面顶栏按钮，点一下循环切换并立即重开） ——
  function updateDifficultyBtn() {
    $('btn-difficulty').textContent = '难度：' + DIFF_NAMES[aiLevel];
  }
  $('btn-difficulty').addEventListener('click', () => {
    aiLevel = DIFF_ORDER[(DIFF_ORDER.indexOf(aiLevel) + 1) % DIFF_ORDER.length];
    for (const s of setupSeats) if (s.type === 'ai') s.aiLevel = aiLevel;
    updateDifficultyBtn();
    if (!game) return;
    cancelAi();
    for (const p of game.players) if (p.type === 'ai') p.aiLevel = aiLevel;
    game.restart();
    save();
    refresh();
    if (game.turnState === 'ai') runAi();
  });

  function startGame() {
    const seats = setupSeats.slice(0, setupCount);
    game = G.createGame({ playerCount: setupCount, seats: seats });
    save();
    enterGame();
  }

  function enterGame() {
    cancelAi();   // 清掉上一局可能残留的 AI 动画
    screen = 'game';
    show(screenGame);
    resizeCanvas();
    const ai = game.players.find(p => p.type === 'ai');
    if (ai) aiLevel = ai.aiLevel;
    updateDifficultyBtn();
    refresh();
    if (game.turnState === 'ai') runAi();
  }

  // ---------- 存档 ----------
  function save() {
    if (!game) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize())); } catch (e) {}
  }
  function loadSave() {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (!s) return null;
      const d = JSON.parse(s);
      if (!d || d.v !== 1) return null;
      return d;
    } catch (e) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  // ---------- 音效（极简 WebAudio，可关） ----------
  let audioCtx = null;
  function tone(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.value = vol || 0.12;
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  // ---------- 布局 ----------
  function resizeCanvas() {
    const wrap = $('board-wrap');
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 棋盘几何：棋位中心横向 12√3、纵向 24（点顶六角星，竖比横长）。
    // 棋子半径 = 0.42×spacing，四周再外扩一个半径，免得顶角棋子被裁。
    const overhang = 2 * 0.42 * B.SQ3;   // 两侧共 0.84√3
    const BW = 12 * B.SQ3 + overhang;    // 横向总宽（含棋子）
    const BH = 24 + overhang;            // 纵向总高（含棋子）
    const pad = 0.98;
    layout_.size = Math.min(w / BW, h / BH) * pad;
    layout_.ox = w / 2;
    layout_.oy = h / 2;
    layout_.spacing = B.SQ3 * layout_.size;
  }
  function screenPos(c) {
    const p = B.pixel(c, layout_.size);
    return { x: layout_.ox + p.x, y: layout_.oy + p.y };
  }
  function screenToCell(x, y) {
    const fx = (x - layout_.ox) / layout_.size;
    const fy = (y - layout_.oy) / layout_.size;
    const r = fy / 1.5;
    const q = fx / B.SQ3 - r / 2;
    const s = -q - r;
    let qr = Math.round(q), rr = Math.round(r), sr = Math.round(s);
    const dq = Math.abs(qr - q), dr = Math.abs(rr - r), ds = Math.abs(sr - s);
    if (dq > dr && dq > ds) qr = -rr - sr;
    else if (dr > ds) rr = -qr - sr;
    else sr = -qr - rr;
    if (B.isOnBoard(qr, rr, sr)) return { q: qr, r: rr, s: sr };
    return null;
  }

  // ---------- 渲染 ----------
  function draw() {
    if (!game) return;
    const sp = layout_.spacing;
    const pr = sp * 0.42;          // 棋子半径
    const cr = sp * 0.30;          // 棋位底点半径

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. 各玩家目标营区淡色提示（帮老人看清“往哪走”）
    for (let p = 0; p < game.playerCount; p++) {
      const pl = game.players[p];
      if (pl.finished) continue;
      ctx.fillStyle = pl.color;
      ctx.globalAlpha = 0.10;
      for (const c of B.CAMPS[pl.targetCamp]) {
        const pos = screenPos(c);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, sp * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 2. 棋位底点
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (const c of B.CELLS) {
      const pos = screenPos(c);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, cr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 合法落点高亮（可在设置里关掉）
    const t = game.turnState === 'selected' || game.turnState === 'chain' ? game.targets() : { steps: [], jumps: [] };
    const targets = t.steps.concat(t.jumps);
    if (showHints && targets.length) {
      for (const c of targets) {
        const pos = screenPos(c);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pr + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pr + 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. 棋子
    const cur = game.current;
    for (let p = 0; p < game.playerCount; p++) {
      const pl = game.players[p];
      for (let pi = 0; pi < pl.pieces.length; pi++) {
        let pos;
        if (anim && anim.idx === p && anim.pieceIdx === pi) {
          pos = { x: anim.x, y: anim.y };
        } else {
          let c = pl.pieces[pi];
          // 真人连跳中：当前棋子画在连跳当前位置
          if (p === cur && pi === game.selectedPieceIdx &&
              (game.turnState === 'selected' || game.turnState === 'chain')) {
            c = game.currentPos();
          }
          pos = screenPos(c);
        }
        const selected = (p === cur && pi === game.selectedPieceIdx &&
          (game.turnState === 'selected' || game.turnState === 'chain'));
        const rr = selected ? pr * 1.12 : pr;
        if (selected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, rr + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = pl.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, rr, 0, Math.PI * 2);
        ctx.fill();
        // 图形符号（照顾色觉异常）
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.round(rr * 1.15) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pl.symbol, pos.x, pos.y + rr * 0.04);
      }
    }
  }

  function refresh() {
    if (!game) return;
    // 回合指示
    const pl = game.players[game.current];
    turnAvatar.style.background = pl.color;
    turnAvatar.textContent = pl.symbol;
    if (game.turnState === 'over') {
      turnText.textContent = '本局结束';
    } else if (pl.type === 'ai') {
      turnText.textContent = pl.name + '方正在思考…';
    } else if (game.current === 0) {
      turnText.textContent = '轮到你了';
    } else {
      turnText.textContent = '轮到' + pl.name + '方';
    }

    // 结束连跳按钮
    btnEndChain.classList.toggle('hidden', game.turnState !== 'chain');

    refreshHint();
    draw();
  }

  function refreshHint() {
    if (!game) return;
    if (game.turnState === 'waiting') hint.textContent = '点一下你的棋子';
    else if (game.turnState === 'selected') hint.textContent = '点一个亮起来的位置走';
    else if (game.turnState === 'chain') hint.textContent = '还能继续跳，或点「结束连跳」';
    else if (game.turnState === 'ai') hint.textContent = '电脑正在走棋…';
    else hint.textContent = '';
  }

  function toast(text, ms) {
    hint.textContent = text;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { if (screen === 'game') refreshHint(); }, ms || 1500);
  }

  // ---------- 连跳鼓励 ----------
  function cheer(jumps) {
    let txt = '';
    if (jumps >= 6) txt = '一跳到底！';
    else if (jumps >= 5) txt = '太棒了！';
    else if (jumps >= 4) txt = '好棋！';
    else if (jumps >= 3) txt = '漂亮！';
    if (!txt) return;
    cheerEl.textContent = txt;
    cheerEl.classList.remove('hidden');
    // 重新触发动画
    cheerEl.style.animation = 'none';
    void cheerEl.offsetWidth;
    cheerEl.style.animation = '';
    tone(660, 0.25);
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => cheerEl.classList.add('hidden'), 1100);
  }

  // ---------- 走子后处理 ----------
  function afterMove(res) {
    if (res.move && res.move.jumps >= 3) cheer(res.move.jumps);
    if (game.isGameOver()) { clearSave(); refresh(); showFinalOverlay(); return; }
    if (game.stalemate()) { clearSave(); refresh(); showStalemateOverlay(); return; }
    save();
    refresh();
    if (res.finished) {
      const finisher = game.winnerOrder[game.winnerOrder.length - 1];
      const pl = game.players[finisher];
      if (pl.type === 'human') {
        if (pl.rank === 1) { showWinOverlay(finisher); return; }   // 真人拿第一：暂停等他选
        toast((finisher === 0 ? '你' : pl.name + '方') + '完成，第' + pl.rank + '名');
      } else {
        toast(pl.name + '方完成，第' + pl.rank + '名');
      }
    }
    if (game.turnState === 'ai') runAi();
  }

  // ---------- 点击交互 ----------
  canvas.addEventListener('pointerdown', e => {
    if (screen !== 'game' || !game) return;
    if (game.turnState === 'ai' || game.turnState === 'over') return;
    if (game.players[game.current].type !== 'human') return;
    const rect = canvas.getBoundingClientRect();
    const cell = screenToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (!cell) return;

    // 连跳中：点一下当前棋子所在位置 = 结束连跳（不用按底部大按钮）
    if (game.turnState === 'chain' && sameCell(cell, game.currentPos())) {
      const res = game.endChain();
      if (res.ok) afterMove(res);
      return;
    }
    // 选中但还没跳：点自己原位 = 取消选择
    if (game.turnState === 'selected' && sameCell(cell, game.currentPos())) {
      game.deselect();
      refresh();
      return;
    }

    const t = game.targets();
    const isStep = t.steps.some(c => sameCell(c, cell));
    const isJump = t.jumps.some(c => sameCell(c, cell));

    if (isStep) {
      const res = game.doStep(cell);
      if (res.ok) afterMove(res);
      return;
    }
    if (isJump) {
      const res = game.doJump(cell);
      if (res.ok) {
        if (res.done) afterMove(res);
        else { tone(520, 0.12); refresh(); }
      }
      return;
    }
    if (game.ownPiece(cell)) {
      const res = game.select(cell);
      if (res.ok) { tone(440, 0.1); refresh(); }
      else toast('请继续移动这枚棋子');
      return;
    }
    // 点错空地：什么都不做
  });

  $('btn-end-chain').addEventListener('click', () => {
    if (!game || game.turnState !== 'chain') return;
    const res = game.endChain();
    if (res.ok) afterMove(res);
  });

  // ---------- 悔棋 ----------
  $('btn-undo').addEventListener('click', () => {
    if (!game) return;
    cancelAi();
    if (game.undo()) { save(); refresh(); }
  });

  // ---------- AI 调度 ----------
  let aiEpoch = 0;   // 悔棋/重开/退出时自增，打断进行中的 AI 思考与动画

  function cancelAi() {
    aiEpoch++;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    aiBusy = false;
    anim = null;
  }

  // ---------- AI 后台线程（Web Worker）----------
  // Android 上把搜索挪到 worker，不卡 UI；worker 不可用/超时则同步兜底，保证永远能走。
  let aiWorker = null, aiWorkerTried = false, aiWorkerSeq = 0;
  const aiWorkerCbs = new Map();
  function getWorker() {
    if (aiWorkerTried) return aiWorker;
    aiWorkerTried = true;
    try {
      const w = new Worker('js/ai-worker.js');
      w.onmessage = (e) => {
        const cb = aiWorkerCbs.get(e.data.id);
        if (cb) { aiWorkerCbs.delete(e.data.id); cb(e.data.res); }
      };
      w.onerror = () => { aiWorker = null; };
      aiWorker = w;
    } catch (e) {
      aiWorker = null;
    }
    return aiWorker;
  }
  function serializeStateForWorker(g) {
    return {
      playerCount: g.playerCount,
      current: g.current,
      moveNumber: g.moveNumber,
      players: g.players.map(p => ({
        pieces: p.pieces, targetCamp: p.targetCamp, startCamp: p.startCamp,
        finished: p.finished, rank: p.rank || 0,
      })),
    };
  }
  function chooseMoveAsync(g, idx, level) {
    return new Promise((resolve) => {
      const w = getWorker();
      if (!w) { resolve(AI.chooseMove(g, idx, level)); return; }
      const id = ++aiWorkerSeq;
      aiWorkerCbs.set(id, resolve);
      w.postMessage({ type: 'chooseMove', id, playerIdx: idx, level, state: serializeStateForWorker(g) });
      setTimeout(() => {
        if (aiWorkerCbs.has(id)) { aiWorkerCbs.delete(id); resolve(AI.chooseMove(g, idx, level)); }
      }, 6000);
    });
  }

  function runAi() {
    if (!game || game.turnState !== 'ai' || game.players[game.current].type !== 'ai') return;
    if (game.isGameOver() || aiBusy) return;
    aiBusy = true;
    const myEpoch = aiEpoch;
    const delay = 500 + Math.random() * 500;   // 500~1000ms，别秒走
    aiTimer = setTimeout(async () => {
      aiTimer = null;
      if (myEpoch !== aiEpoch || screen !== 'game' || game.turnState !== 'ai') { aiBusy = false; return; }
      const idx = game.current;
      const m = await chooseMoveAsync(game, idx, game.players[idx].aiLevel);
      if (!m) { aiBusy = false; return; }
      lastAiResult = m;
      lastAiResult.playerIdx = idx;
      if (showDebug) renderDebugPanel();
      await animateAiMove(idx, m.pieceIdx, m.move, myEpoch);
      if (myEpoch !== aiEpoch || screen !== 'game') { aiBusy = false; return; }
      const res = game.applyMove(m.pieceIdx, m.move);
      aiBusy = false;
      afterMove(res);
    }, delay);
  }

  // 逐格播放 AI 走棋（150~250ms 一跳），不瞬移
  async function animateAiMove(idx, pieceIdx, move, myEpoch) {
    const path = move.path;
    anim = { idx: idx, pieceIdx: pieceIdx, x: screenPos(path[0]).x, y: screenPos(path[0]).y };
    draw();
    await sleep(260);
    for (let i = 1; i < path.length; i++) {
      if (myEpoch !== aiEpoch) break;
      tone(520, 0.12);
      await hop(idx, pieceIdx, path[i - 1], path[i], 180, myEpoch);
    }
    if (myEpoch === aiEpoch) { anim = null; draw(); }
  }

  function hop(idx, pieceIdx, from, to, dur, myEpoch) {
    return new Promise(res => {
      const a = screenPos(from), b = screenPos(to);
      const t0 = performance.now();
      function frame(now) {
        if (myEpoch !== aiEpoch) { anim = null; res(); return; }
        const k = Math.min(1, (now - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        anim = { idx: idx, pieceIdx: pieceIdx, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
        draw();
        if (k < 1) requestAnimationFrame(frame);
        else res();
      }
      requestAnimationFrame(frame);
    });
  }

  // ---------- 结算 ----------
  function showWinOverlay(finisher) {
    if (finisher === 0) {
      const steps = game.history.filter(e => e.player === 0).length;
      recordWin(aiLevel, steps);
      winTitle.textContent = '你赢啦！';
      winSub.textContent = '共走了 ' + steps + ' 步，是否继续观看其他玩家？';
    } else {
      winTitle.textContent = game.players[finisher].name + '方赢啦！';
      winSub.textContent = '是否继续观看其他玩家？';
    }
    winBtns.innerHTML = '';
    winBtns.appendChild(mkBtn('继续观看', () => { hideWin(); }));
    winBtns.appendChild(mkBtn('结束游戏', () => { clearSave(); goMenu(); }, true));
    overlayWin.classList.remove('hidden');
    buzz(80);
  }

  function showFinalOverlay() {
    winTitle.textContent = '本局结束';
    const rank = game.winnerOrder.map((p, i) => (i + 1) + '名 ' + label(p)).join('　');
    winSub.textContent = rank;
    winBtns.innerHTML = '';
    winBtns.appendChild(mkBtn('返回主菜单', () => { clearSave(); goMenu(); }));
    overlayWin.classList.remove('hidden');
  }

  function showStalemateOverlay() {
    winTitle.textContent = '走不动了';
    winSub.textContent = '大家都卡住了，这局算和棋吧';
    winBtns.innerHTML = '';
    winBtns.appendChild(mkBtn('返回主菜单', () => { clearSave(); goMenu(); }));
    overlayWin.classList.remove('hidden');
    buzz(80);
  }

  function hideWin() {
    overlayWin.classList.add('hidden');
    refresh();
    if (game.turnState === 'ai') runAi();
  }

  function mkBtn(text, fn, secondary) {
    const b = document.createElement('button');
    b.className = 'big-btn' + (secondary ? ' secondary' : '');
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  // ---------- 调试面板 ----------
  const CMP_NAMES = {
    goalDistance: '目标距离', goalCamp: '入营深度', rearPiece: '后排惩罚',
    formation: '队形', jumpNetwork: '跳板网络', mobility: '机动性',
    endgame: '残局结构', tempo: '节奏', blocking: '营口堵塞',
    enemyInCamp: '敌占我营', isolation: '孤子', regression: '疏散',
  };
  const PHASE_NAMES = { opening: '开局', midgame: '中局', endgame: '残局' };
  function moveDesc(m) {
    const p = m.move && m.move.path;
    if (!p || !p.length) return '—';
    const a = p[0], b = p[p.length - 1];
    return '第' + (m.pieceIdx + 1) + '子 ' + a.q + ',' + a.r + ' → ' + b.q + ',' + b.r +
      (p.length > 2 ? '（' + (p.length - 1) + '跳）' : '');
  }
  function renderDebugPanel() {
    if (!lastAiResult) {
      debugContent.innerHTML = '<div class="dg-sub">还没有 AI 落子，等 AI 走一手。</div>';
      return;
    }
    const r = lastAiResult;
    const who = game ? label(r.playerIdx != null ? r.playerIdx : game.current) : 'AI';
    let html = '<div class="dg-head">' + who + ' · ' + moveDesc(r) + '</div>';
    html += '<div class="dg-sub">分 ' + (r.score == null ? '—' : Math.round(r.score)) +
      ' · 节点 ' + (r.nodes || 0) + ' · 深度 ' + (r.depth || 0) +
      ' · 耗时 ' + (r.timeMs || 0) + 'ms</div>';

    // Top5 候选
    if (r.top5 && r.top5.length) {
      html += '<div class="dg-head">Top5 候选</div><table><thead><tr>' +
        '<th>走法</th><th>评分</th></tr></thead><tbody>';
      for (const t of r.top5) {
        html += '<tr><td>' + moveDesc(t) + '</td><td>' +
          (t.score == null ? '—' : Math.round(t.score)) + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    // 局面分解
    if (r.breakdown) {
      const bd = r.breakdown;
      html += '<div class="dg-head">局面分解（' + (PHASE_NAMES[bd.phase] || bd.phase) +
        '，总分 ' + Math.round(bd.total) + '）</div><table><tbody>';
      const keys = (globalThis.Eval && globalThis.Eval.COMPONENTS) || Object.keys(bd).filter(k => k !== 'phase' && k !== 'total');
      for (const k of keys) {
        if (typeof bd[k] !== 'number') continue;
        html += '<tr><td>' + (CMP_NAMES[k] || k) + '</td><td>' + Math.round(bd[k]) + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    debugContent.innerHTML = html;
  }
  function updateDebugBtn() {
    const b = $('btn-debug');
    if (b) b.textContent = '调试：' + (showDebug ? '开' : '关');
  }

  // ---------- 暂停菜单 ----------
  $('btn-menu').addEventListener('click', () => {
    overlayMenu.classList.remove('hidden');
  });
  $('btn-resume').addEventListener('click', () => overlayMenu.classList.add('hidden'));
  $('btn-sound').addEventListener('click', e => {
    soundOn = !soundOn;
    e.target.textContent = '声音：' + (soundOn ? '开' : '关');
  });
  $('btn-debug').addEventListener('click', () => {
    overlayMenu.classList.add('hidden');
    showDebug = !showDebug;
    updateDebugBtn();
    if (showDebug) { renderDebugPanel(); overlayDebug.classList.remove('hidden'); }
    else overlayDebug.classList.add('hidden');
  });
  $('btn-debug-close').addEventListener('click', () => {
    showDebug = false;
    updateDebugBtn();
    overlayDebug.classList.add('hidden');
  });
  $('btn-restart').addEventListener('click', () => {
    overlayMenu.classList.add('hidden');
    cancelAi();
    game.restart();
    save();
    refresh();
    if (game.turnState === 'ai') runAi();
  });
  $('btn-exit').addEventListener('click', () => {
    overlayMenu.classList.add('hidden');
    cancelAi();
    clearSave();
    goMenu();
  });

  // ---------- 窗口尺寸 ----------
  window.addEventListener('resize', () => {
    if (screen === 'game') { resizeCanvas(); refresh(); }
  });

  // ---------- 启动 ----------
  soundOn = true;
  $('btn-sound').textContent = '声音：开';
  try { showHints = localStorage.getItem('tiaoqi-show-hints') !== '0'; } catch (e) {}
  updateHintsBtn();
  updateDifficultyBtn();
  refreshMenu();
  show(screenMenu);
})();
