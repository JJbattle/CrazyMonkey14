// game.js —— 游戏控制器（回合状态机 / 胜负 / 悔棋 / 存档），不碰 UI
//
// 依赖 board.js（坐标）+ rules.js（走法），被 UI 和 AI 共同调用。
// 规则决策：目标营自由进出；不设占营限制（可以停在别人目标营）。移动生成完全不看营区。

(function () {
  'use strict';
  const B = (typeof module !== 'undefined') ? require('./board.js') : globalThis.Board;
  const R = (typeof module !== 'undefined') ? require('./rules.js') : globalThis.Rules;

  // 每个营区的格子 key 集合（用于快速判断「某子是否已入目标营」）
  const CAMP_SETS = B.CAMPS.map(c => new Set(c.map(B.keyOf)));

  // 6 个阵营的颜色 + 图形标识（颜色 + 符号，照顾色觉异常玩家）
  const PLAYER_STYLES = [
    { color: '#e23b3b', symbol: '●', name: '红' },
    { color: '#2f6fe0', symbol: '★', name: '蓝' },
    { color: '#2f9e44', symbol: '▲', name: '绿' },
    { color: '#e8a200', symbol: '◆', name: '黄' },
    { color: '#7a3fd0', symbol: '■', name: '紫' },
    { color: '#00a0a0', symbol: '♥', name: '青' },
  ];

  // 环序（顺时针从顶部开始）：top=1, up-right=2, down-right=3, bottom=4, down-left=5, up-left=0
  // 玩家 0 永远坐「正下方」那个营区（最自然）。
  function campSelection(N) {
    if (N === 2) return [4, 1];            // 正下 + 正上
    if (N === 3) return [4, 0, 2];         // 正下 + 左上 + 右上（120° 等分）
    if (N === 4) return [4, 1, 2, 5];      // 两组相对：上下 + 右上/左下
    if (N === 5) return [4, 3, 2, 1, 0];   // 空掉左下
    if (N === 6) return [4, 3, 2, 1, 0, 5];// 全用
    return [4, 1];
  }

  function sameCell(a, b) { return a.q === b.q && a.r === b.r && a.s === b.s; }
  function copyCell(c) { return { q: c.q, r: c.r, s: c.s }; }

  function createGame(config) {
    const playerCount = config.playerCount || 2;
    // seats：每个玩家 { type:'human'|'ai', aiLevel:'easy'|'normal'|'hard' }
    // 默认：玩家 0 真人，其余普通电脑
    const seats = (config.seats && config.seats.length === playerCount)
      ? config.seats
      : Array.from({ length: playerCount }, (_, i) =>
          i === 0 ? { type: 'human' } : { type: 'ai', aiLevel: 'normal' });

    const camps = campSelection(playerCount);
    const players = seats.map((seat, i) => ({
      type: seat.type, aiLevel: seat.aiLevel || 'normal',
      color: PLAYER_STYLES[i].color, symbol: PLAYER_STYLES[i].symbol, name: PLAYER_STYLES[i].name,
      startCamp: camps[i], targetCamp: B.opposite(camps[i]),
      pieces: B.CAMPS[camps[i]].map(copyCell),
      finished: false, rank: 0,
    }));

    let board = new Map();            // key -> playerIndex
    let current = 0;
    let turnState = 'waiting';        // waiting | selected | chain | ai | over
    let selectedCell = null;          // 选中棋子的原始位置
    let selectedPieceIdx = -1;
    let chain = [];                   // 本回合连跳经过的棋位（chain[0]=选中位，最后一位=当前位置）
    let winnerOrder = [];
    let history = [];                 // 已完成回合：{ player, pieceIdx, move, snapshot }
    let moveNumber = 0;
    let turnSnapshot = null;          // 本回合开始前状态（悔棋用）
    // 僵局检测：连续多少步没有任何棋子进入目标营，就判「走不动了」。
    // 多人局棋子会交叉堵死，谁都没有能推进的走法，此时不再无限挂机。
    const STALEMATE_MOVES = playerCount * 25;
    let minRemaining = Infinity;      // 历史最少「未入目标营」棋子数
    let lastProgressMove = 0;         // 最近一次进度推进发生在第几步

    function rebuildBoard() {
      board = new Map();
      for (let p = 0; p < playerCount; p++) {
        for (const c of players[p].pieces) board.set(B.keyOf(c), p);
      }
    }
    rebuildBoard();
    turnSnapshot = snapshot();

    function snapshot() {
      return {
        pieces: players.map(p => p.pieces.map(copyCell)),
        finished: players.map(p => p.finished),
        rank: players.map(p => p.rank),
        winnerOrder: winnerOrder.slice(),
        current: current,
      };
    }
    function restore(s) {
      players.forEach((p, i) => {
        p.pieces = s.pieces[i].map(copyCell);
        p.finished = s.finished[i];
        p.rank = s.rank[i];
      });
      winnerOrder = s.winnerOrder.slice();
      current = s.current;
      rebuildBoard();
      selectedCell = null; selectedPieceIdx = -1; chain = [];
      turnState = players[current].type === 'ai' ? 'ai' : 'waiting';
      turnSnapshot = snapshot();
      minRemaining = remainingCount(); lastProgressMove = moveNumber;
    }

    function occupant(cell) {
      const v = board.get(B.keyOf(cell));
      return v === undefined ? -1 : v;
    }
    function ownPiece(cell) { return occupant(cell) === current; }

    // 尚未进入目标营的棋子总数（越小 = 整体越接近终局）
    function remainingCount() {
      let rem = 0;
      for (let p = 0; p < playerCount; p++) {
        if (players[p].finished) continue;
        const set = CAMP_SETS[players[p].targetCamp];
        for (const c of players[p].pieces) if (!set.has(B.keyOf(c))) rem++;
      }
      return rem;
    }
    function trackProgress() {
      const r = remainingCount();
      if (r < minRemaining) { minRemaining = r; lastProgressMove = moveNumber; }
    }
    // 连续 STALEMATE_MOVES 步没有任何棋子进入目标营 → 判定走不动了
    function stalemate() {
      return (moveNumber - lastProgressMove) >= STALEMATE_MOVES;
    }

    // 当前连跳位置（选中但还没跳 = 选中位；已跳 = chain 末尾）
    function currentPos() { return chain.length ? chain[chain.length - 1] : selectedCell; }

    // 连跳中不允许落回已经占过的位置（防来回跳死循环）
    function legalJumpsFrom(cell) {
      const visited = new Set(chain.map(B.keyOf));
      return R.jumpTargets(board, cell).filter(t => !visited.has(B.keyOf(t)));
    }

    // 当前可走的目标（供 UI 高亮）
    function targets() {
      if (turnState === 'selected') {
        const c = currentPos();
        return { steps: R.stepTargets(board, c), jumps: legalJumpsFrom(c) };
      }
      if (turnState === 'chain') {
        return { steps: [], jumps: legalJumpsFrom(currentPos()) };
      }
      return { steps: [], jumps: [] };
    }

    function select(cell) {
      if (players[current].type !== 'human') return { ok: false };
      if (turnState !== 'waiting' && turnState !== 'selected') return { ok: false };
      if (!ownPiece(cell)) return { ok: false };
      selectedCell = copyCell(cell);
      selectedPieceIdx = players[current].pieces.findIndex(p => sameCell(p, cell));
      chain = [copyCell(cell)];
      turnState = 'selected';
      const t = targets();
      return { ok: true, steps: t.steps, jumps: t.jumps };
    }

    // 走一步（普通移动），立即结束本回合
    function doStep(to) {
      if (turnState !== 'selected') return { ok: false };
      if (!R.stepTargets(board, currentPos()).some(c => sameCell(c, to))) return { ok: false };
      const move = { kind: 'step', path: [chain[0], copyCell(to)], jumps: 0 };
      return commit(move);
    }

    // 跳一步（进入/继续连跳）。若跳完没得继续跳，自动结束本回合。
    function doJump(to) {
      if (turnState !== 'selected' && turnState !== 'chain') return { ok: false };
      if (!legalJumpsFrom(currentPos()).some(c => sameCell(c, to))) return { ok: false };
      const from = currentPos();
      chain.push(copyCell(to));
      const further = legalJumpsFrom(to);
      if (further.length === 0) {
        const move = { kind: 'jump', path: chain.map(copyCell), jumps: chain.length - 1 };
        const res = commit(move);
        res.from = from; res.to = copyCell(to); res.done = true;
        return res;
      }
      turnState = 'chain';
      return { ok: true, from: from, to: copyCell(to), done: false, jumps: further };
    }

    // 结束连跳（玩家点「结束连跳」按钮，或连跳中再点一下当前棋子）
    function endChain() {
      if (turnState !== 'chain') return { ok: false };
      const move = { kind: 'jump', path: chain.map(copyCell), jumps: chain.length - 1 };
      return commit(move);
    }

    // 取消选择（选中但还没跳时，再点一下自己原位 = 不走了）
    function deselect() {
      if (turnState !== 'selected') return { ok: false };
      selectedCell = null; selectedPieceIdx = -1; chain = [];
      turnState = 'waiting';
      return { ok: true };
    }

    // 提交一回合的 Move（step 或整条连跳），判胜负，轮到下家
    function commit(move) {
      const pieceIdx = selectedPieceIdx;
      const from = move.path[0], to = move.path[move.path.length - 1];
      // 更新棋盘与棋子
      board.delete(B.keyOf(from));
      board.set(B.keyOf(to), current);
      players[current].pieces[pieceIdx] = copyCell(to);
      moveNumber++;
      history.push({ player: current, pieceIdx: pieceIdx, move: move, snapshot: turnSnapshot });

      // 判胜负
      let finished = false, rank = 0;
      if (!players[current].finished && R.allInCamp(players[current].pieces, players[current].targetCamp)) {
        players[current].finished = true;
        players[current].rank = winnerOrder.length + 1;
        winnerOrder.push(current);
        finished = true; rank = players[current].rank;
      }

      advanceTurn();
      trackProgress();
      return { ok: true, move: move, finished: finished, rank: rank };
    }

    // AI 用：直接执行一整个 Move（含连跳路径），不经过 selected/chain 状态
    function applyMove(pieceIdx, move) {
      const from = move.path[0], to = move.path[move.path.length - 1];
      board.delete(B.keyOf(from));
      board.set(B.keyOf(to), current);
      players[current].pieces[pieceIdx] = copyCell(to);
      moveNumber++;
      history.push({ player: current, pieceIdx: pieceIdx, move: move, snapshot: turnSnapshot });

      let finished = false, rank = 0;
      if (!players[current].finished && R.allInCamp(players[current].pieces, players[current].targetCamp)) {
        players[current].finished = true;
        players[current].rank = winnerOrder.length + 1;
        winnerOrder.push(current);
        finished = true; rank = players[current].rank;
      }
      advanceTurn();
      trackProgress();
      return { ok: true, move: move, finished: finished, rank: rank };
    }

    function advanceTurn() {
      if (winnerOrder.length >= playerCount) { turnState = 'over'; return; }
      // 找到下一个未完成的玩家
      for (let i = 1; i <= playerCount; i++) {
        const idx = (current + i) % playerCount;
        if (!players[idx].finished) { current = idx; break; }
      }
      selectedCell = null; selectedPieceIdx = -1; chain = [];
      turnState = players[current].type === 'ai' ? 'ai' : 'waiting';
      turnSnapshot = snapshot();
    }

    // 悔棋：撤销到自己本回合开始之前；连跳中也能撤销。
    function undo() {
      if ((turnState === 'selected' || turnState === 'chain') && players[current].type === 'human') {
        restore(turnSnapshot);
        return true;
      }
      let did = false;
      while (history.length > 0) {
        const e = history.pop();
        restore(e.snapshot);
        did = true;
        if (players[e.player].type === 'human') break;
      }
      return did;
    }

    // 重新开始
    function restart() {
      players.forEach((p, i) => { p.pieces = B.CAMPS[p.startCamp].map(copyCell); p.finished = false; p.rank = 0; });
      rebuildBoard();
      current = 0; winnerOrder = []; history = []; moveNumber = 0;
      selectedCell = null; selectedPieceIdx = -1; chain = [];
      turnState = players[0].type === 'ai' ? 'ai' : 'waiting';
      turnSnapshot = snapshot();
      minRemaining = Infinity; lastProgressMove = 0;
    }

    function isGameOver() { return turnState === 'over'; }

    // —— 存档 ——
    function serialize() {
      return {
        v: 1,
        playerCount: playerCount,
        seats: players.map(p => ({ type: p.type, aiLevel: p.aiLevel })),
        players: players.map(p => ({
          type: p.type, aiLevel: p.aiLevel, color: p.color, symbol: p.symbol, name: p.name,
          startCamp: p.startCamp, targetCamp: p.targetCamp,
          pieces: p.pieces.map(copyCell), finished: p.finished, rank: p.rank,
        })),
        current: current, turnState: turnState,
        selectedCell: selectedCell ? copyCell(selectedCell) : null,
        selectedPieceIdx: selectedPieceIdx,
        chain: chain.map(copyCell),
        winnerOrder: winnerOrder.slice(), moveNumber: moveNumber,
        turnSnapshot: turnSnapshot,
        history: history.map(e => ({
          player: e.player, pieceIdx: e.pieceIdx,
          move: { kind: e.move.kind, jumps: e.move.jumps, path: e.move.path.map(copyCell) },
          snapshot: e.snapshot,
        })),
      };
    }

    function deserialize(d) {
      players.forEach((p, i) => {
        const s = d.players[i];
        p.type = s.type; p.aiLevel = s.aiLevel; p.color = s.color; p.symbol = s.symbol; p.name = s.name;
        p.startCamp = s.startCamp; p.targetCamp = s.targetCamp;
        p.pieces = s.pieces.map(copyCell); p.finished = s.finished; p.rank = s.rank;
      });
      current = d.current; turnState = d.turnState;
      selectedCell = d.selectedCell ? copyCell(d.selectedCell) : null;
      selectedPieceIdx = d.selectedPieceIdx;
      chain = (d.chain || []).map(copyCell);
      winnerOrder = d.winnerOrder.slice(); moveNumber = d.moveNumber || 0;
      turnSnapshot = d.turnSnapshot;
      history = (d.history || []).map(e => ({
        player: e.player, pieceIdx: e.pieceIdx,
        move: { kind: e.move.kind, jumps: e.move.jumps, path: e.move.path.map(copyCell) },
        snapshot: e.snapshot,
      }));
      rebuildBoard();
      minRemaining = remainingCount(); lastProgressMove = moveNumber;
    }

    return {
      get playerCount() { return playerCount; },
      get players() { return players; },
      get board() { return board; },
      get current() { return current; },
      get turnState() { return turnState; },
      get winnerOrder() { return winnerOrder; },
      get history() { return history; },
      get chain() { return chain; },
      get selectedCell() { return selectedCell; },
      get selectedPieceIdx() { return selectedPieceIdx; },
      get moveNumber() { return moveNumber; },
      occupant, ownPiece, targets, select, doStep, doJump, endChain, deselect,
      applyMove, advanceTurn, undo, restart, isGameOver, serialize, deserialize,
      sameCell, copyCell, currentPos, remainingCount, stalemate, PLAYER_STYLES,
    };
  }

  const Game = { createGame, campSelection, PLAYER_STYLES };
  globalThis.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
})();
