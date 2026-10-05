// search.js —— AI v2 搜索框架
//
// 在「轻量可变 state」上搜索（真实 game 的 current/board/players 是只读 getter，不便就地改），
// state 与 evaluate.js 期望的形状一致，所以 evaluate 可直接复用。
//
//   makeState(game)        克隆成轻量 state（含 Zobrist hash）
//   generateMoves(state,p) 某玩家全部合法走法 [{pieceIdx, move}]
//   applyState / undoState 就地走一步 / 撤销（含增量 hash、胜负、轮转）
//   2 人：Negamax + Alpha-Beta + 置换表 + 迭代加深 + 根节点按历史分排序
//   多人：MaxN + Beam（按快速启发式每层保 Top-K）
//
// search(game, playerIdx, level) → { pieceIdx, move, score, nodes, depth, timeMs, top5 }

(function () {
  'use strict';
  const B = (typeof module !== 'undefined') ? require('./board.js') : globalThis.Board;
  const R = (typeof module !== 'undefined') ? require('./rules.js') : globalThis.Rules;
  const Eval = (typeof module !== 'undefined') ? require('./evaluate.js') : globalThis.Eval;
  const Zob = (typeof module !== 'undefined') ? require('./zobrist.js') : globalThis.Zobrist;

  const WIN = 1000000;

  // —— 轻量 state ——
  function copyCell(c) { return { q: c.q, r: c.r, s: c.s }; }
  function makeState(game) {
    const n = game.playerCount;
    const players = [];
    for (let p = 0; p < n; p++) {
      const gp = game.players[p];
      players.push({
        pieces: gp.pieces.map(copyCell),
        targetCamp: gp.targetCamp,
        startCamp: gp.startCamp,
        finished: gp.finished,
        rank: gp.rank || 0,
      });
    }
    let finishedCount = 0;
    const finishedOrder = [];
    for (let p = 0; p < n; p++) if (players[p].finished) { finishedCount++; finishedOrder.push(p); }
    const s = {
      playerCount: n,
      players,
      board: new Map(game.board),
      current: game.current,
      moveNumber: game.moveNumber || 0,
      finishedCount,
      finishedOrder,
      hash: 0,
    };
    s.hash = Zob.hashState(s);
    return s;
  }

  function generateMoves(state, playerIdx) {
    const out = [];
    const pieces = state.players[playerIdx].pieces;
    for (let pieceIdx = 0; pieceIdx < pieces.length; pieceIdx++) {
      const moves = R.getLegalMoves(state.board, pieces[pieceIdx]);
      for (const move of moves) out.push({ pieceIdx, move });
    }
    return out;
  }

  // 走一步，返回是否触发「该玩家直接获胜（入满目标营）」。u 为撤销信息对象。
  function applyState(s, playerIdx, pieceIdx, move, u) {
    const from = move.path[0], to = move.path[move.path.length - 1];
    u.from = from; u.to = to; u.pieceIdx = pieceIdx; u.playerIdx = playerIdx;
    u.prevFinished = s.players[playerIdx].finished;
    u.prevRank = s.players[playerIdx].rank;
    u.prevCurrent = s.current;
    u.prevFinishedCount = s.finishedCount;
    u.prevFinishedOrderLen = s.finishedOrder.length;
    u.prevHash = s.hash;

    s.board.delete(B.keyOf(from));
    s.board.set(B.keyOf(to), playerIdx);
    s.players[playerIdx].pieces[pieceIdx] = to;
    s.hash = Zob.togglePiece(s.hash, playerIdx, Zob.cellIndex(from));
    s.hash = Zob.togglePiece(s.hash, playerIdx, Zob.cellIndex(to));

    let finished = s.players[playerIdx].finished;
    if (!finished && R.allInCamp(s.players[playerIdx].pieces, s.players[playerIdx].targetCamp)) {
      s.players[playerIdx].finished = true;
      s.players[playerIdx].rank = s.finishedOrder.length + 1;
      s.finishedOrder.push(playerIdx);
      s.finishedCount++;
      finished = true;
    }

    s.moveNumber++;
    let next = -1;
    for (let i = 1; i <= s.playerCount; i++) {
      const idx = (playerIdx + i) % s.playerCount;
      if (!s.players[idx].finished) { next = idx; break; }
    }
    s.hash = Zob.toggleTurn(s.hash, playerIdx);
    if (next >= 0) s.hash = Zob.toggleTurn(s.hash, next);
    s.current = next;
    return finished;
  }

  function undoState(s, u) {
    s.board.set(B.keyOf(u.from), u.playerIdx);
    s.board.delete(B.keyOf(u.to));
    s.players[u.playerIdx].pieces[u.pieceIdx] = u.from;
    s.players[u.playerIdx].finished = u.prevFinished;
    s.players[u.playerIdx].rank = u.prevRank;
    s.current = u.prevCurrent;
    s.finishedCount = u.prevFinishedCount;
    s.finishedOrder.length = u.prevFinishedOrderLen;
    s.moveNumber--;
    s.hash = u.prevHash;
  }

  // 一步的净推进：起点到目标营尖端平方距离 − 终点平方距离（>0 为前进）
  function progressOf(state, playerIdx, pieceIdx, move) {
    const camp = state.players[playerIdx].targetCamp;
    const from = move.path[0], to = move.path[move.path.length - 1];
    const fd = Eval.DIST_TIP.get(B.keyOf(from))[camp];
    const td = Eval.DIST_TIP.get(B.keyOf(to))[camp];
    return fd * fd - td * td;
  }

  // 「到营尖平方距离」和（越小越好）：只用作解堵搜索里的走法排序，
  // 让「往营深处挪」的走法优先被尝试（给营口让路的第一步往往就是往里塞一格）。
  function tipScore(state, playerIdx) {
    const camp = state.players[playerIdx].targetCamp;
    let sum = 0;
    for (const c of state.players[playerIdx].pieces) {
      const d = Eval.DIST_TIP.get(B.keyOf(c))[camp];
      sum += d * d;
    }
    return sum;
  }

  // 营外子数（尚未进入目标营的己方棋子）。解堵的真正目标是把它压下去，
  // 而不是「往营深处挪一格」这种假进展——假进展会让最后一子永远堵在营口。
  function outsideCount(state, playerIdx) {
    const camp = state.players[playerIdx].targetCamp;
    let n = 0;
    for (const c of state.players[playerIdx].pieces) if (B.campOf(c) !== camp) n++;
    return n;
  }

  function pieceKey(state, playerIdx) {
    return state.players[playerIdx].pieces.map(c => B.keyOf(c)).sort().join('|');
  }

  // 单玩家深搜：能否在 remaining 步内把营外子数降到 target 以下。
  // 只走自己、不给对手回应——用于 2 人局里「最后一子被自己堵在营口」的场景，
  // 典型解法「营口子往里让一格、再把卡子放进去」是多步配合，单步看不到。
  function canReduceOutside(s, playerIdx, target, remaining, budget) {
    if (budget.n++ > budget.max) return false;
    if (outsideCount(s, playerIdx) < target) return true;
    if (remaining <= 0) return false;
    const key = remaining + '|' + pieceKey(s, playerIdx);
    if (budget.visited.has(key)) return false;
    budget.visited.add(key);
    const moves = generateMoves(s, playerIdx);
    // 排序：先进营 / 往深处挪的走法先试，解堵序列更早被搜到
    for (const m of moves) m.order = -quickMoveScore(s, playerIdx, m.pieceIdx, m.move);
    moves.sort((a, b) => a.order - b.order);
    const u = {};
    for (const m of moves) {
      const fin = applyState(s, playerIdx, m.pieceIdx, m.move, u);
      let ok = outsideCount(s, playerIdx) < target;
      if (!ok && !fin) ok = canReduceOutside(s, playerIdx, target, remaining - 1, budget);
      undoState(s, u);
      if (ok) return true;
    }
    return false;
  }

  // 解堵入口：返回能把营外子数压下去（让最后一子进营）的第一步；找不到返回 null。
  // 用「迭代加深」先找最短解：返回的第一步必然在最短解上，配合下一轮重搜，
  // 每一步都单调逼近「进营」，避免 DFS 随手选一个横向废步、下轮又走回来来回打转。
  function unstickMove(s, playerIdx, maxDepth) {
    const target = outsideCount(s, playerIdx);
    if (target === 0) return null;
    const rootMoves = generateMoves(s, playerIdx);
    for (const m of rootMoves) m.order = -quickMoveScore(s, playerIdx, m.pieceIdx, m.move);
    rootMoves.sort((a, b) => a.order - b.order);
    const u = {};
    const budget = { n: 0, max: 500000, visited: new Set() };
    for (let d = 1; d <= (maxDepth || 10); d++) {
      for (const rm of rootMoves) {
        const fin = applyState(s, playerIdx, rm.pieceIdx, rm.move, u);
        let ok = outsideCount(s, playerIdx) < target;
        if (!ok && !fin) ok = canReduceOutside(s, playerIdx, target, d - 1, budget);
        undoState(s, u);
        if (ok) return rm;
      }
    }
    return null;
  }

  // 快速启发式（走法排序 / easy / beam 用）：到尖端平方距离的净改善 + 进营 + 连跳小幅。
  // 用「尖端平方距离」（与评价一致、与 V1 同款）而非「到营区距离」排序，
  // 这样最落后的棋子（尤其起始营尖、离目标最远）改善量最大、排最前，
  // beam 剪枝时才不会把「疏散起始营」这一步丢掉 → 避免最后一子被堵死在起始营。
  function quickMoveScore(s, playerIdx, pieceIdx, move) {
    const targetCamp = s.players[playerIdx].targetCamp;
    const from = move.path[0], to = move.path[move.path.length - 1];
    const fromD = Eval.DIST_TIP.get(B.keyOf(from))[targetCamp];
    const toD = Eval.DIST_TIP.get(B.keyOf(to))[targetCamp];
    let sc = fromD * fromD - toD * toD;
    const fromInGoal = B.campOf(from) === targetCamp;
    const toInGoal = B.campOf(to) === targetCamp;
    if (toInGoal && !fromInGoal) sc += 30;
    if (fromInGoal && !toInGoal) sc -= 80;
    sc += move.jumps * 2;
    return sc;
  }

  // —— 2 人：Negamax + AB + TT + 候选剪枝（beam）——
  function negamax(s, depth, alpha, beta, tt, stats, beam) {
    stats.nodes++;
    const cur = s.current;
    const opp = 1 - cur;

    // 置换表
    const alphaOrig = alpha;
    const ttE = tt.lookup(s.hash);
    if (ttE && ttE.depth >= depth) {
      if (ttE.flag === Zob.FLAG.EXACT) return ttE.score;
      if (ttE.flag === Zob.FLAG.LOWER && ttE.score > alpha) alpha = ttE.score;
      if (ttE.flag === Zob.FLAG.UPPER && ttE.score < beta) beta = ttE.score;
      if (alpha >= beta) return ttE.score;
    }

    // 对手已完赛：我方已输（分差被 900000 压住），直接按静态分返回
    if (s.players[opp].finished) return Eval.evaluate(s, cur).total - 900000;
    if (depth <= 0) return Eval.evaluate(s, cur).total - Eval.evaluate(s, opp).total;

    const moves = generateMoves(s, cur);
    if (moves.length === 0) return -WIN + s.moveNumber;

    // 走法排序：优先沿用 TT 最优步，否则按快速启发式
    if (ttE && ttE.bestMove) {
      for (const m of moves) m.order = (m.pieceIdx === ttE.bestPiece ? 1e9 : 0) - quickMoveScore(s, cur, m.pieceIdx, m.move);
    } else {
      for (const m of moves) m.order = -quickMoveScore(s, cur, m.pieceIdx, m.move);
    }
    moves.sort((a, b) => a.order - b.order);
    // 候选剪枝：只搜快速启发式最靠前的 beam 个，控制分支、加深搜索
    const cands = (beam && moves.length > beam) ? moves.slice(0, beam) : moves;
    const pruned = cands.length < moves.length;

    let best = -Infinity, bestPiece = -1, bestMove = null;
    const u = {};
    for (const m of cands) {
      const finished = applyState(s, cur, m.pieceIdx, m.move, u);
      let val;
      if (finished) val = WIN - s.moveNumber;      // 当前方直接获胜
      else val = -negamax(s, depth - 1, -beta, -alpha, tt, stats, beam);
      undoState(s, u);
      if (val > best) { best = val; bestPiece = m.pieceIdx; bestMove = m.move; }
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }

    // 被剪枝的节点只保证是下界（可能漏掉更优步），标记 LOWER 而非 EXACT，避免污染 TT
    const flag = pruned ? Zob.FLAG.LOWER
      : (best <= alphaOrig ? Zob.FLAG.UPPER : (best >= beta ? Zob.FLAG.LOWER : Zob.FLAG.EXACT));
    tt.store(s.hash, depth, flag, best, bestPiece, bestMove);
    return best;
  }

  // 2 人根节点：迭代加深，时间预算内不断加深，返回最优步
  function rootID(s, playerIdx, moves, opts, stats) {
    const tt = new Zob.TranspositionTable();
    const start = Date.now();
    const beam = opts.beam2p;
    const u = {};
    let best = { score: -Infinity, pieceIdx: -1, move: null, depth: 0 };
    // order 约定「越大越好」：初始用快速启发式，之后用上一轮搜索值。
    // 每轮都按 order 降序搜（最优的先试），既利于 alpha-beta 剪枝，
    // 又保证时间不够时优先搜过的是好棋，best 不会落在一个坏棋上。
    for (const m of moves) m.order = quickMoveScore(s, playerIdx, m.pieceIdx, m.move);

    for (let depth = 1; depth <= opts.maxDepth; depth++) {
      moves.sort((a, b) => b.order - a.order);
      let alpha = -Infinity;
      let iterBest = -Infinity, iterPiece = -1, iterMove = null;
      for (const m of moves) {
        if (Date.now() - start > opts.timeMs) break;
        const finished = applyState(s, playerIdx, m.pieceIdx, m.move, u);
        let val;
        if (finished) val = WIN - s.moveNumber;
        else val = -negamax(s, depth - 1, -Infinity, -alpha, tt, stats, beam);
        undoState(s, u);
        m.order = val;
        if (val > iterBest) { iterBest = val; iterPiece = m.pieceIdx; iterMove = m.move; }
        if (val > alpha) alpha = val;
      }
      if (iterMove) { best = { score: iterBest, pieceIdx: iterPiece, move: iterMove, depth }; }
      if (Date.now() - start > opts.timeMs) break;
      if (Math.abs(iterBest) >= WIN - 100) break;   // 已见必胜/必败
    }
    return best;
  }

  // —— 多人：MaxN + Beam ——
  function terminalVector(s) {
    const v = new Array(s.playerCount).fill(-WIN);
    for (let p = 0; p < s.playerCount; p++) {
      if (s.players[p].finished) v[p] = 900000 - (s.players[p].rank || 0) * 1000;
      else v[p] = -WIN;
    }
    return v;
  }

  function maxn(s, depth, beam, stats) {
    stats.nodes++;
    const cur = s.current;
    if (cur < 0) return terminalVector(s);
    if (depth <= 0) return Eval.evaluateAll(s);

    const moves = generateMoves(s, cur);
    if (moves.length === 0) return terminalVector(s);
    for (const m of moves) m.order = quickMoveScore(s, cur, m.pieceIdx, m.move);
    moves.sort((a, b) => b.order - a.order);
    const cands = moves.slice(0, beam);

    const u = {};
    let best = null;
    for (const m of cands) {
      applyState(s, cur, m.pieceIdx, m.move, u);
      const vec = maxn(s, depth - 1, beam, stats);
      undoState(s, u);
      if (best === null || vec[cur] > best[cur]) best = vec;
    }
    return best;
  }

  function rootMaxN(s, playerIdx, moves, opts, stats) {
    const start = Date.now();
    const beam = opts.beam, depth = opts.depth;
    for (const m of moves) m.order = quickMoveScore(s, playerIdx, m.pieceIdx, m.move);
    moves.sort((a, b) => b.order - a.order);
    const cands = moves.slice(0, beam);
    const u = {};
    let best = { score: -Infinity, pieceIdx: -1, move: null, depth };
    for (const m of cands) {
      applyState(s, playerIdx, m.pieceIdx, m.move, u);
      const vec = maxn(s, depth - 1, beam, stats);
      undoState(s, u);
      m.order = vec[playerIdx];
      if (vec[playerIdx] > best.score) { best.score = vec[playerIdx]; best.pieceIdx = m.pieceIdx; best.move = m.move; }
      if (Date.now() - start > opts.timeMs) break;
    }
    return best;
  }

  // —— easy：单层快速启发式 + Top5 带权随机 ——
  function rootEasy(s, playerIdx, moves, stats) {
    const scored = moves.map(m => ({ m, s: quickMoveScore(s, playerIdx, m.pieceIdx, m.move) + Math.random() * 35 }));
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, 5);
    const min = top[top.length - 1].s;
    let sum = 0;
    for (const t of top) { t.w = (t.s - min) + 1; sum += t.w; }
    let r = Math.random() * sum;
    let pick = top[0];
    for (const t of top) { r -= t.w; if (r <= 0) { pick = t; break; } }
    stats.nodes = scored.length;
    return { score: pick.s, pieceIdx: pick.m.pieceIdx, move: pick.m.move, depth: 1 };
  }

  // —— 顶层入口 ——
  const LEVELS = {
    easy:   { timeMs: 60,  maxDepth: 1 },
    normal: { timeMs: 150, maxDepth: 8,  depth: 2, beam: 8,  beam2p: 10 },
    hard:   { timeMs: 300, maxDepth: 12, depth: 3, beam: 10, beam2p: 14 },
    expert: { timeMs: 900, maxDepth: 16, depth: 3, beam: 14, beam2p: 18 },
  };

  // 环境变量覆盖时间预算（调参/测试用，不改代码即可扫参数）
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.AI_HARD_MS) LEVELS.hard.timeMs = parseInt(process.env.AI_HARD_MS, 10);
    if (process.env.AI_NORMAL_MS) LEVELS.normal.timeMs = parseInt(process.env.AI_NORMAL_MS, 10);
    if (process.env.AI_EXPERT_MS) LEVELS.expert.timeMs = parseInt(process.env.AI_EXPERT_MS, 10);
  }

  function search(game, playerIdx, level) {
    const t0 = Date.now();
    const s = makeState(game);
    const moves = generateMoves(s, playerIdx);
    if (moves.length === 0) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    const stats = { nodes: 0 };

    let best;
    if (game.playerCount === 2) {
      if (level === 'easy') best = rootEasy(s, playerIdx, moves, stats);
      else best = rootID(s, playerIdx, moves, opts, stats);
    } else {
      if (level === 'easy') best = rootEasy(s, playerIdx, moves, stats);
      else best = rootMaxN(s, playerIdx, moves, opts, stats);
    }

    // 2 人局兜底：搜索若想「原地打转 / 后退」（无净推进、且非必胜），
    // 改走净推进最优的走法，杜绝双方互相堵死直到僵局。
    if (game.playerCount === 2 && level !== 'easy' && best.move &&
        Math.abs(best.score) < WIN - 100 &&
        progressOf(s, playerIdx, best.pieceIdx, best.move) <= 0) {
      let alt = null, altScore = -Infinity;
      for (const m of moves) {
        if (progressOf(s, playerIdx, m.pieceIdx, m.move) > 0) {
          const sc = quickMoveScore(s, playerIdx, m.pieceIdx, m.move);
          if (sc > altScore) { altScore = sc; alt = m; }
        }
      }
      if (alt) {
        best = { score: altScore, pieceIdx: alt.pieceIdx, move: alt.move, depth: best.depth };
      } else {
        // 无任何前进走法 → 残局最后一子被自己堵在营口：单玩家深搜解堵
        const us = unstickMove(s, playerIdx, 5);
        if (us) best = { score: best.score, pieceIdx: us.pieceIdx, move: us.move, depth: best.depth };
      }
    }

    // Top5（供调试面板）：按最终评分排序的前 5 个候选
    const ranked = moves.slice().sort((a, b) => (b.order || -1e9) - (a.order || -1e9));
    const top5 = ranked.slice(0, 5).map(m => ({
      pieceIdx: m.pieceIdx,
      move: m.move,
      score: (m.order === undefined || m.order <= -1e8) ? null : m.order,
    }));

    return {
      pieceIdx: best.pieceIdx,
      move: best.move,
      score: best.score,
      nodes: stats.nodes,
      depth: best.depth,
      timeMs: Date.now() - t0,
      top5,
    };
  }

  const Search = { search, makeState, generateMoves, applyState, undoState, quickMoveScore, progressOf, tipScore, outsideCount, unstickMove, WIN };
  globalThis.Search = Search;
  if (typeof module !== 'undefined' && module.exports) module.exports = Search;
})();
