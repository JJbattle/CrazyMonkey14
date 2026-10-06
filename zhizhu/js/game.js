// game.js —— 蜘蛛纸牌：游戏状态 + 控制器（走子/发牌/悔棋/提示/存档）
//
// 只有这里能改 state。UI 只调用这里的方法，不自己判断规则。

(function () {
  'use strict';
  const C = globalThis.Cards;
  const R = globalThis.Rules;

  const SAVE_KEY = 'zhizhu-save-v1';

  function newState(difficulty, seed) {
    const deck = C.buildDeck(difficulty);
    C.shuffle(deck, seed);
    const { tableau, stock } = C.dealInitial(deck);
    return {
      difficulty, seed,
      tableau, stock,
      completed: 0,
      moveCount: 0,
      undoCount: 0,
      hintCount: 0,
      elapsed: 0,
      status: 'playing',   // 'playing' | 'won'
      history: [],         // 悔棋快照栈（每步一帧完整局面）
    };
  }

  // —— 悔棋快照（不含计时，悔棋不回退计时）——
  function snapshot(s) {
    return JSON.stringify({
      t: s.tableau.map(col => col.map(c => [c.s, c.r, c.u])),
      k: s.stock.map(c => [c.s, c.r, c.u]),
      c: s.completed, m: s.moveCount,
    });
  }
  function restore(s, snap) {
    const d = JSON.parse(snap);
    s.tableau = d.t.map(col => col.map(([ss, r, u]) => ({ s: ss, r, u })));
    s.stock = d.k.map(([ss, r, u]) => ({ s: ss, r, u }));
    s.completed = d.c; s.moveCount = d.m;
    s.status = 'playing';
  }

  // 移动后自动翻牌 + 自动收完整序列（级联）。返回 { flipped, completed }
  function settle(state) {
    let flipped = false, completed = 0;
    for (let i = 0; i < 10; i++) {
      const col = state.tableau[i];
      if (col.length && !col[col.length - 1].u) { col[col.length - 1].u = 1; flipped = true; }
      for (;;) {
        const start = R.completeStart(col);
        if (start < 0) break;
        col.splice(start, 13);
        state.completed++;
        completed++;
        if (col.length && !col[col.length - 1].u) { col[col.length - 1].u = 1; flipped = true; }
      }
    }
    if (state.completed >= 8) state.status = 'won';
    return { flipped, completed };
  }

  // 移动一组牌。成功返回 { ok:true, flipped, completed, count }
  function move(state, from, fromIdx, to) {
    if (state.status !== 'playing') return { ok: false };
    const src = state.tableau[from], dst = state.tableau[to];
    const stack = R.movableStack(src, fromIdx);
    if (!stack || !R.canPlaceOn(stack[0], dst)) return { ok: false };

    state.history.push(snapshot(state));
    const moved = src.splice(fromIdx, stack.length);
    dst.push(...moved);
    state.moveCount++;
    const r = settle(state);
    return { ok: true, count: moved.length, flipped: r.flipped, completed: r.completed };
  }

  // 发一组新牌（10 张）
  function deal(state) {
    if (state.status !== 'playing' || !R.canDeal(state)) return { ok: false, reason: 'empty' };
    state.history.push(snapshot(state));
    for (let i = 0; i < 10; i++) {
      const c = state.stock.shift();
      c.u = 1;
      state.tableau[i].push(c);
    }
    state.moveCount++;
    return { ok: true };
  }

  // 悔棋：整体回退上一次操作（含其自动翻牌/收牌级联）
  function undo(state) {
    if (!state.history.length) return false;
    restore(state, state.history.pop());
    state.undoCount++;
    return true;
  }

  // —— 提示评分（对应 §23 的优先级）——
  function hintScore(state, mv) {
    const src = state.tableau[mv.from], dst = state.tableau[mv.to];
    const top = src[mv.fromIdx];
    let score = 0;

    // 1. 直接完成一组 K→A（模拟放置后判断）
    if (R.completeStart(dst.concat(src.slice(mv.fromIdx))) >= 0) score += 10000;
    // 2. 翻开背面牌
    if (mv.fromIdx > 0 && !src[mv.fromIdx - 1].u) score += 500;
    // 3. 同花色连接（优于异花色）
    const sameSuit = dst.length > 0 && R.topCard(dst).s === top.s;
    score += sameSuit ? 100 : 20;
    // 4. 制造空列（整列被移空）
    if (mv.fromIdx === 0) score += 200;
    // 5. 拉长同花序列
    if (sameSuit) score += Math.min(mv.count, 12) * 3;
    // 6. 移动到空列略扣分（通常不如翻牌/连接）
    if (dst.length === 0) score -= 50;

    return score;
  }

  // 提示：返回得分最高的合法走法，无走法返回 null
  function hint(state) {
    const moves = R.legalMoves(state);
    if (!moves.length) return null;
    let best = moves[0], bs = -Infinity;
    for (const mv of moves) {
      const sc = hintScore(state, mv);
      if (sc > bs) { bs = sc; best = mv; }
    }
    return best;
  }

  // 无路可走判断：'deal' 可发新牌 / 'stuck' 走不下去 / null 正常
  function stuck(state) {
    if (state.status === 'won') return null;
    if (R.hasLegalMove(state)) return null;
    return state.stock.length > 0 ? 'deal' : 'stuck';
  }

  // —— 存档 ——
  function serialize(state) {
    return JSON.stringify({
      v: 1, difficulty: state.difficulty, seed: state.seed,
      tableau: state.tableau.map(col => col.map(c => [c.s, c.r, c.u])),
      stock: state.stock.map(c => [c.s, c.r, c.u]),
      completed: state.completed, moveCount: state.moveCount,
      undoCount: state.undoCount, hintCount: state.hintCount,
      elapsed: state.elapsed, status: state.status,
      history: state.history,
    });
  }
  function deserialize(json) {
    const d = JSON.parse(json);
    if (!d || d.v !== 1) return null;
    return {
      difficulty: d.difficulty, seed: d.seed,
      tableau: d.tableau.map(col => col.map(([ss, r, u]) => ({ s: ss, r, u }))),
      stock: d.stock.map(([ss, r, u]) => ({ s: ss, r, u })),
      completed: d.completed, moveCount: d.moveCount,
      undoCount: d.undoCount, hintCount: d.hintCount,
      elapsed: d.elapsed, status: d.status,
      history: d.history || [],
    };
  }

  const Game = {
    SAVE_KEY, newState, move, deal, undo, hint, stuck,
    serialize, deserialize, snapshot, restore, topCard: R.topCard,
  };

  globalThis.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
})();
