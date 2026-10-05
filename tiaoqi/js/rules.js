// rules.js —— 规则引擎（纯逻辑，不碰 UI）
//
// 只回答「这个子现在能走到哪」「这个位置能不能跳」「连跳之后还有哪些合法位置」「有没有获胜」。
// 完全不知道按钮、动画、音效是什么。真人 UI 和 AI 都调这一套，杜绝各写一套。

(function () {
  'use strict';
  const B = (typeof module !== 'undefined') ? require('./board.js') : globalThis.Board;

  // board：Map(key -> playerIndex)。空位 = 不在 map 里或值为负。
  function occupant(board, c) {
    const v = board.get(B.keyOf(c));
    return (v === undefined || v < 0) ? -1 : v;
  }
  function isEmpty(board, c) { return occupant(board, c) < 0; }

  // 单步落点：相邻的空位（最多 6 个）
  function stepTargets(board, from) {
    const out = [];
    for (const n of B.neighbors(from)) if (isEmpty(board, n)) out.push(n);
    return out;
  }

  // 单跳落点：跳过相邻棋子，落到其正后方的空位（跳过的棋子不会被吃、不动）
  function jumpTargets(board, from) {
    const out = [];
    for (const d of B.DIRS) {
      const mid = B.cell(from.q + d.q, from.r + d.r);
      if (!B.isOnBoard(mid.q, mid.r, mid.s) || isEmpty(board, mid)) continue;
      const to = B.cell(from.q + 2 * d.q, from.r + 2 * d.r);
      if (!B.isOnBoard(to.q, to.r, to.s) || !isEmpty(board, to)) continue;
      out.push(to);
    }
    return out;
  }

  // 连跳：从 from 出发，把所有能「连续跳」到达的落点都找出来。
  // 返回 Map(落点key -> 完整路径[from, ..., 落点])，每条路径都是逐格跳。
  // 用 visited 防止来回跳造成死循环（同一回合内不允许落回已经占过的位置）。
  function reachableJumps(board, from) {
    const reachable = new Map();
    function dfs(pos, path, visited) {
      const ts = jumpTargets(board, pos);
      for (const t of ts) {
        const k = B.keyOf(t);
        if (visited.has(k)) continue;
        const nv = new Set(visited); nv.add(k);
        const np = path.concat([t]);
        if (!reachable.has(k)) reachable.set(k, np);
        dfs(t, np, nv);
      }
    }
    dfs(from, [from], new Set([B.keyOf(from)]));
    return reachable;
  }

  // 一枚棋子的全部合法 Move（供 AI / 悔棋 / 存档用完整路径）
  // move = { kind:'step'|'jump', path:[from,...], jumps:跳的步数 }
  function getLegalMoves(board, from) {
    const moves = [];
    for (const t of stepTargets(board, from)) moves.push({ kind: 'step', path: [from, t], jumps: 0 });
    for (const path of reachableJumps(board, from).values()) {
      moves.push({ kind: 'jump', path: path, jumps: path.length - 1 });
    }
    return moves;
  }

  // 是否所有棋子都在目标营区里（胜负判定）
  function allInCamp(pieces, targetCamp) {
    for (const c of pieces) if (B.campOf(c) !== targetCamp) return false;
    return true;
  }

  const Rules = {
    occupant, isEmpty, stepTargets, jumpTargets, reachableJumps, getLegalMoves, allInCamp,
  };

  globalThis.Rules = Rules;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
})();
