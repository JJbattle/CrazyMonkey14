// ai.js —— AI v2 编排层（薄壳）
//
// 真正的智能在 evaluate.js（局面评价）+ search.js（搜索）+ zobrist.js（哈希/TT）。
// 本文件只负责：按难度调度 search，补全「走完这步后的局面分解」供调试面板，并保持
// 与旧版一致的对外接口 chooseMove(game, playerIdx, level) → { pieceIdx, move }。
//
// 难度四档（UI 按钮 easy→normal→hard→expert）：
//   easy   单层快速启发式 + Top5 带权随机（会明显失误）
//   normal 2 人 ID+AB（150ms）/ 多人 MaxN+Beam 2 层
//   hard   2 人 ID+AB（400ms）/ 多人 MaxN+Beam 3 层，不放水
//   expert 2 人 ID+AB（900ms）/ 多人 MaxN+Beam 3 层更宽，最强
//
// 搜索本身是同步的；Android 上通过 ai-worker.js 把 chooseMove 挪到后台线程跑，不卡 UI。

(function () {
  'use strict';
  const Eval = (typeof module !== 'undefined') ? require('./evaluate.js') : globalThis.Eval;
  const Search = (typeof module !== 'undefined') ? require('./search.js') : globalThis.Search;

  const VALID_LEVELS = { easy: 1, normal: 1, hard: 1, expert: 1 };

  function chooseMove(game, playerIdx, level) {
    level = level || game.players[playerIdx].aiLevel || 'normal';
    if (!VALID_LEVELS[level]) level = 'normal';

    const res = Search.search(game, playerIdx, level);
    if (!res || !res.move) return null;

    // 走完这步后的局面分解（调试面板用；AI 调度本身不依赖它）
    let breakdown = null;
    try {
      const s = Search.makeState(game);
      const u = {};
      Search.applyState(s, playerIdx, res.pieceIdx, res.move, u);
      breakdown = Eval.evaluate(s, playerIdx);
    } catch (e) {
      breakdown = null;
    }

    return {
      pieceIdx: res.pieceIdx,
      move: res.move,
      score: res.score,
      nodes: res.nodes,
      depth: res.depth,
      timeMs: res.timeMs,
      top5: res.top5,
      breakdown: breakdown,
    };
  }

  const AI = { chooseMove, LEVELS: { easy: 1, normal: 1, hard: 1, expert: 1 } };
  globalThis.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})();
