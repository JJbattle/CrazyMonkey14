// ai.js —— 电脑对手（简单/普通/困难），只读 game 状态 + Rules，不碰 UI
//
// 三档难度：
//   简单：会往目标方向走，偶尔走次优，不刻意堵人
//   普通：评估 + 一层对手最佳回应（避免明显送子/送跳）
//   困难：2 层 negamax 搜索（我走一步、对手回一步），连跳路径完全展开
// 评估核心：到目标营的最短立方距离（已入营 = 0）的平方和，落后棋子权重更高。
// 所有难度都复用同一套 Rules.getLegalMoves()，绝不复刻规则。

(function () {
  'use strict';
  const B = (typeof module !== 'undefined') ? require('./board.js') : globalThis.Board;
  const R = (typeof module !== 'undefined') ? require('./rules.js') : globalThis.Rules;

  // 每个营区的尖端（最深处那格）。
  // 用「到尖端的立方距离平方和」做评分：离尖端最近的 10 个格恰是目标营本身，
  // 这既等价于「往目标营走」，又天然要求「先往深处填、营口留到最后」——
  // 否则营口先被堵死，最后一个子进不去，整局卡死。
  const TIP = B.CAMPS.map(camp =>
    camp.find(c => Math.abs(c.q) === 8 || Math.abs(c.r) === 8 || Math.abs(c.s) === 8));

  // 某玩家的局势评分（越小越好）：每枚棋子到目标营尖端的距离平方和。
  // 平方让「落后棋子」权重更高，正好实现「让落后棋子跟上」。
  function playerScore(game, playerIdx) {
    const p = game.players[playerIdx];
    const tip = TIP[p.targetCamp];
    let total = 0;
    for (const c of p.pieces) {
      const d = B.dist(c, tip);
      total += d * d;
    }
    return total;
  }

  function listMoves(game, playerIdx) {
    const p = game.players[playerIdx];
    const out = [];
    for (let pi = 0; pi < p.pieces.length; pi++) {
      for (const m of R.getLegalMoves(game.board, p.pieces[pi])) {
        out.push({ pieceIdx: pi, move: m });
      }
    }
    return out;
  }

  // 临时把某棋子从 from 挪到 to，返回还原函数
  function applyTmp(game, playerIdx, pieceIdx, from, to) {
    game.board.delete(B.keyOf(from));
    game.board.set(B.keyOf(to), playerIdx);
    const p = game.players[playerIdx];
    const old = p.pieces[pieceIdx];
    p.pieces[pieceIdx] = to;
    return function revert() {
      p.pieces[pieceIdx] = old;
      game.board.set(B.keyOf(from), playerIdx);
      game.board.delete(B.keyOf(to));
    };
  }

  // 一步的「净收益」= 自身评分下降量（越大越好）
  function improvement(game, playerIdx, pieceIdx, move) {
    const before = playerScore(game, playerIdx);
    const from = move.path[0], to = move.path[move.path.length - 1];
    const revert = applyTmp(game, playerIdx, pieceIdx, from, to);
    const after = playerScore(game, playerIdx);
    revert();
    return before - after;
  }

  // 下一个还没完成的玩家（跳过自己和已完成的）
  function nextActive(game, playerIdx) {
    for (let i = 1; i <= game.playerCount; i++) {
      const j = (playerIdx + i) % game.playerCount;
      if (j === playerIdx) continue;
      if (!game.players[j].finished) return j;
    }
    return -1;
  }

  // 从 playerIdx 视角的「优势」（越大越好）= 对手平均评分 - 我方评分
  function evaluate(game, playerIdx) {
    const mine = playerScore(game, playerIdx);
    let oppSum = 0, n = 0;
    for (let j = 0; j < game.playerCount; j++) {
      if (j === playerIdx || game.players[j].finished) continue;
      oppSum += playerScore(game, j); n++;
    }
    if (n === 0) return 1e9;   // 没有对手 = 必胜
    return oppSum / n - mine;
  }

  // negamax：返回 playerIdx 在当前局面下的最大优势（depth 层之后）。
  function negamax(game, playerIdx, depth, alpha, beta) {
    if (depth === 0) return evaluate(game, playerIdx);
    const moves = listMoves(game, playerIdx);
    if (moves.length === 0) return -1e9;   // 无路可走 = 极差
    // 走法排序：收益大的先试，利于剪枝
    const scored = moves.map(m => ({ m: m, v: improvement(game, playerIdx, m.pieceIdx, m.move) }));
    scored.sort((a, b) => b.v - a.v);

    let best = -Infinity;
    for (const { m } of scored) {
      const from = m.move.path[0], to = m.move.path[m.move.path.length - 1];
      const revert = applyTmp(game, playerIdx, m.pieceIdx, from, to);
      const opp = nextActive(game, playerIdx);
      const v = (opp < 0) ? evaluate(game, playerIdx)
                           : -negamax(game, opp, depth - 1, -beta, -alpha);
      revert();
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 终局「卡住」时的自救：在 depth 步内找一条能降低自身评分的走子序列，返回其第一步。
  // 用于解决「最后一个子被自己堵在营外、需临时挪开营口棋子再绕进去」这种多步配合，
  // 单步贪心看不到，只能小范围深搜。
  function findUnstick(game, playerIdx, depth) {
    const startScore = playerScore(game, playerIdx);
    const rootMoves = listMoves(game, playerIdx);
    rootMoves.sort((a, b) =>
      improvement(game, playerIdx, b.pieceIdx, b.move) - improvement(game, playerIdx, a.pieceIdx, a.move));
    const budget = { n: 0, max: 80000 };
    for (const rm of rootMoves) {
      const from = rm.move.path[0], to = rm.move.path[rm.move.path.length - 1];
      const revert = applyTmp(game, playerIdx, rm.pieceIdx, from, to);
      const visited = new Set();
      const ok = canReduce(game, playerIdx, startScore, depth - 1, budget, visited);
      revert();
      if (ok) return rm;
    }
    return null;
  }

  function canReduce(game, playerIdx, targetScore, remaining, budget, visited) {
    if (budget.n++ > budget.max) return false;
    if (playerScore(game, playerIdx) < targetScore) return true;
    if (remaining <= 0) return false;
    const key = game.players[playerIdx].pieces.map(c => B.keyOf(c)).sort().join('|');
    if (visited.has(key)) return false;
    visited.add(key);
    const moves = listMoves(game, playerIdx);
    for (const m of moves) {
      const from = m.move.path[0], to = m.move.path[m.move.path.length - 1];
      const revert = applyTmp(game, playerIdx, m.pieceIdx, from, to);
      const ok = canReduce(game, playerIdx, targetScore, remaining - 1, budget, visited);
      revert();
      if (ok) return true;
    }
    return false;
  }

  // 「让路」：己方一步都推进不了时（多人交叉堵死），挑一步最能帮对手打开局面的。
  // 牺牲自己当前评分，换取全局松绑——多人局里某个子的前进路径常被别人的子挡住，
  // 必须有人先退一步让路，否则整局卡死。只在「无改善走法」时启用，避免乱让。
  function giveWayMove(game, playerIdx) {
    const moves = listMoves(game, playerIdx);
    let best = null, bestV = -Infinity;
    for (const m of moves) {
      const from = m.move.path[0], to = m.move.path[m.move.path.length - 1];
      const revert = applyTmp(game, playerIdx, m.pieceIdx, from, to);
      let oppGain = 0;
      for (let oi = 0; oi < game.playerCount; oi++) {
        if (oi === playerIdx || game.players[oi].finished) continue;
        let ob = 0;
        for (const x of listMoves(game, oi)) {
          const v = improvement(game, oi, x.pieceIdx, x.move);
          if (v > ob) ob = v;
        }
        oppGain += Math.max(0, ob);
      }
      revert();
      if (oppGain > bestV) { bestV = oppGain; best = m; }
    }
    return best;
  }

  function chooseMove(game, playerIdx, level) {
    level = level || game.players[playerIdx].aiLevel || 'normal';
    const moves = listMoves(game, playerIdx);
    if (moves.length === 0) return null;

    let best = null;

    if (level === 'easy') {
      const scored = moves.map(m => ({ pieceIdx: m.pieceIdx, move: m.move, v: improvement(game, playerIdx, m.pieceIdx, m.move) }));
      scored.sort((a, b) => b.v - a.v);
      if (Math.random() < 0.2) {
        const fwd = scored.filter(s => s.v >= 0);
        const pool = fwd.length ? fwd : scored;
        best = pool[Math.floor(Math.random() * pool.length)];
      } else {
        best = scored[0];
      }
    } else if (level === 'normal') {
      // 自己走一步，再看所有对手的最佳回应，取「净收益」最大者（避免送子/送跳）
      const scored = moves.map(m => ({ pieceIdx: m.pieceIdx, move: m.move, v: improvement(game, playerIdx, m.pieceIdx, m.move) }));
      scored.sort((a, b) => b.v - a.v);
      const top = scored.slice(0, 14);
      let bestV = -Infinity;
      for (const m of top) {
        const from = m.move.path[0], to = m.move.path[m.move.path.length - 1];
        const revert = applyTmp(game, playerIdx, m.pieceIdx, from, to);
        let oppBest = 0;
        for (let oi = 0; oi < game.playerCount; oi++) {
          if (oi === playerIdx || game.players[oi].finished) continue;
          for (const x of listMoves(game, oi)) {
            const v = improvement(game, oi, x.pieceIdx, x.move);
            if (v > oppBest) oppBest = v;
          }
        }
        revert();
        const v = m.v - 0.8 * oppBest;
        if (v > bestV) { bestV = v; best = m; }
      }
    } else {
      // hard：2 层搜索（根层全展开 + 对手回一层）
      const scored = moves.map(m => ({ pieceIdx: m.pieceIdx, move: m.move, v: improvement(game, playerIdx, m.pieceIdx, m.move) }));
      scored.sort((a, b) => b.v - a.v);
      let bestV = -Infinity;
      for (const m of scored) {
        const from = m.move.path[0], to = m.move.path[m.move.path.length - 1];
        const revert = applyTmp(game, playerIdx, m.pieceIdx, from, to);
        const opp = nextActive(game, playerIdx);
        const v = (opp < 0) ? evaluate(game, playerIdx)
                            : -negamax(game, opp, 1, -Infinity, Infinity);
        revert();
        if (v > bestV) { bestV = v; best = m; }
      }
    }

    // 终局自救：所选走法若不能推进自身，分两种情况松绑——
    //   多人局先「让路」（交叉堵死只能靠有人退一步），
    //   再尝试单人深搜（自己临时挪开营口棋子再绕进去，2 人局靠这个）。
    if (best && improvement(game, playerIdx, best.pieceIdx, best.move) <= 0) {
      if (game.playerCount >= 3) {
        const gw = giveWayMove(game, playerIdx);
        if (gw) best = gw;
      }
      if (improvement(game, playerIdx, best.pieceIdx, best.move) <= 0) {
        const u = findUnstick(game, playerIdx, 6);
        if (u) best = u;
      }
    }
    return best;
  }

  const AI = { chooseMove, playerScore, listMoves, improvement, evaluate, negamax };
  globalThis.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})();
