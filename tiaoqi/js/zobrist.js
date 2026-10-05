// zobrist.js —— 增量 Zobrist 哈希 + 置换表（TT），供 search.js 使用
//
// 哈希用 32 位 XOR：h = XOR(每枚子在位的 Z[player][cellIdx]) XOR ZCUR[current]。
// 走一步只需 XOR 掉旧位、XOR 进新位、再切换回合位，O(1)。
// TT 用 Map<number, entry>，条目带 age，超过容量时按 age 清空（简单可靠）。

(function () {
  'use strict';
  const B = (typeof module !== 'undefined') ? require('./board.js') : globalThis.Board;

  // 确定性 PRNG（xorshift32），保证跨进程/跨平台哈希一致（存档与 worker 结果可复现）
  let seed = 0x9E3779B9 >>> 0;
  function rnd() {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed;
  }

  // 棋位 index（0..120）
  const CELL_INDEX = new Map();
  B.CELLS.forEach((c, i) => CELL_INDEX.set(B.keyOf(c), i));
  const cellIndex = c => CELL_INDEX.get(B.keyOf(c));

  // Z[player][cellIdx]，ZCUR[player]（轮到谁）
  const Z = [];
  for (let p = 0; p < 6; p++) { Z[p] = new Array(121); for (let i = 0; i < 121; i++) Z[p][i] = rnd(); }
  const ZCUR = [];
  for (let i = 0; i < 6; i++) ZCUR[i] = rnd();

  // 从零重建某 state 的哈希（开局/校验用；搜索里走增量，不调它）
  function hashState(state) {
    let h = 0;
    for (let p = 0; p < state.playerCount; p++) {
      for (const c of state.players[p].pieces) h ^= Z[p][cellIndex(c)];
    }
    h ^= ZCUR[state.current];
    return h >>> 0;
  }

  // 增量原语：toggle 一个「player 的某格是否有子」位
  const togglePiece = (h, player, ci) => (h ^ Z[player][ci]) >>> 0;
  const toggleTurn = (h, player) => (h ^ ZCUR[player]) >>> 0;

  // —— 置换表 ——
  // entry = { hash, depth, flag, score, bestPiece, bestMove }
  //   flag: 0=exact, 1=lower bound, 2=upper bound
  const FLAG = { EXACT: 0, LOWER: 1, UPPER: 2 };

  function TranspositionTable(capacity) {
    this.capacity = capacity || 1000000;
    this.table = new Map();
    this.age = 0;
  }
  TranspositionTable.prototype.clear = function () { this.table.clear(); };
  TranspositionTable.prototype.store = function (hash, depth, flag, score, bestPiece, bestMove) {
    if (this.table.size >= this.capacity) { this.table.clear(); }  // 满则整体清空（搜一棵树足够）
    this.table.set(hash >>> 0, { hash: hash >>> 0, depth, flag, score, bestPiece, bestMove });
  };
  TranspositionTable.prototype.lookup = function (hash) {
    return this.table.get(hash >>> 0);
  };

  const Zobrist = { Z, ZCUR, CELL_INDEX, cellIndex, hashState, togglePiece, toggleTurn, TranspositionTable, FLAG };
  globalThis.Zobrist = Zobrist;
  if (typeof module !== 'undefined' && module.exports) module.exports = Zobrist;
})();
