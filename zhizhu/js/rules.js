// rules.js —— 蜘蛛纸牌规则层（纯函数，不碰 UI、不改 state）。
//
// 约定：tableau[col] 是「自底向上」的牌堆，下标 0 是最先发的牌（通常背面），
// 末尾是最后一张（牌堆顶）。点数随下标递增而递减（K→…→A）。

(function () {
  'use strict';

  const topCard = col => (col.length ? col[col.length - 1] : null);

  // 单张/牌组能否放到目标列：目标为空列，或目标顶牌点数比它大 1（任意花色）
  function canPlaceOn(card, targetCol) {
    if (!targetCol.length) return true;
    return card.r + 1 === topCard(targetCol).r;
  }

  // 从 idx 起能整体移动的连续牌组（同花色、逐张递减）。返回 [idx..end] 切片或 null。
  function movableStack(col, idx) {
    if (idx < 0 || idx >= col.length || !col[idx].u) return null;
    let end = idx;
    for (let i = idx; i < col.length - 1; i++) {
      const a = col[i], b = col[i + 1];
      if (b.u && a.s === b.s && a.r === b.r + 1) end = i + 1;
      else break;
    }
    return col.slice(idx, end + 1);
  }

  // 每列「可移动牌组顶端」的下标（单张也算一组）。用于枚举走法、点选。
  function runTops(col) {
    const tops = [];
    for (let i = 0; i < col.length; i++) {
      const c = col[i];
      if (!c.u) continue;
      if (i > 0) {
        const above = col[i - 1];
        if (above.u && above.s === c.s && above.r === c.r + 1) continue; // 属于上方那组，不是顶端
      }
      tops.push(i);
    }
    return tops;
  }

  // 某列顶部是否形成完整同花 K→A（13 张）。返回起始下标，否则 -1。
  function completeStart(col) {
    if (col.length < 13) return -1;
    const start = col.length - 13;
    const s = col[start].s;
    for (let i = 0; i < 13; i++) {
      const c = col[start + i];
      if (!c.u || c.s !== s || c.r !== 13 - i) return -1;
    }
    return start;
  }

  // 能否发牌：牌库有牌，且没有空列
  function canDeal(state) {
    return state.stock.length > 0 && state.tableau.every(c => c.length > 0);
  }

  // 所有合法走法：{ from, fromIdx, to, count }
  function legalMoves(state) {
    const moves = [];
    for (let s = 0; s < 10; s++) {
      const tops = runTops(state.tableau[s]);
      for (const idx of tops) {
        const top = state.tableau[s][idx];
        for (let t = 0; t < 10; t++) {
          if (t === s) continue;
          if (canPlaceOn(top, state.tableau[t])) {
            moves.push({ from: s, fromIdx: idx, to: t, count: state.tableau[s].length - idx });
          }
        }
      }
    }
    return moves;
  }

  const hasLegalMove = state => legalMoves(state).length > 0;

  const Rules = {
    topCard, canPlaceOn, movableStack, runTops, completeStart,
    canDeal, legalMoves, hasLegalMove,
  };

  globalThis.Rules = Rules;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
})();
