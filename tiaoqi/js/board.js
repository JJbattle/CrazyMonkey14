// board.js —— 跳棋棋盘数据结构（纯逻辑，不碰 UI）
//
// 六角星跳棋棋盘共 121 个棋位，用「立方坐标」(q, r, s)、q+r+s=0 表示。
// 每个棋位有 6 个邻居（60° 六方向）。棋盘 = 中央六边形(半径4，61 位) + 6 个三角营区(各 10 位)。
//
// 本文件只负责：坐标、邻居、6 个营区、距离。不涉及任何走法规则。

(function () {
  'use strict';

  // 6 个邻居方向（轴向 q,r 偏移；s 由 -q-r 推导）
  const DIRS = [
    { q: 1, r: 0 }, { q: -1, r: 0 },
    { q: 0, r: 1 }, { q: 0, r: -1 },
    { q: 1, r: -1 }, { q: -1, r: 1 },
  ];

  // 判断 (q,r,s) 是否在棋盘上
  function isOnBoard(q, r, s) {
    if (Math.abs(q) <= 4 && Math.abs(r) <= 4 && Math.abs(s) <= 4) return true; // 中央六边形
    const cs = [q, r, s];
    for (let i = 0; i < 3; i++) {
      const c = cs[i];
      const o0 = cs[(i + 1) % 3], o1 = cs[(i + 2) % 3];
      // 三角营区：某坐标超出 4（±5..±8），另外两个坐标落在 [-4, 4-|c|]（正方向）或 [|c|-4, 4]（负方向）
      if (c >= 5 && c <= 8 && o0 >= -4 && o0 <= 4 - c && o1 >= -4 && o1 <= 4 - c) return true;
      if (c <= -5 && c >= -8 && o0 >= -c - 4 && o0 <= 4 && o1 >= -c - 4 && o1 <= 4) return true;
    }
    return false;
  }

  // 返回该棋位所属营区名（'q+'/'r+'/'s+'/'q-'/'r-'/'s-'），不在营区返回 null
  function tipOf(q, r, s) {
    const cs = [q, r, s];
    const plus = ['q+', 'r+', 's+'], minus = ['q-', 'r-', 's-'];
    for (let i = 0; i < 3; i++) {
      const c = cs[i];
      const o0 = cs[(i + 1) % 3], o1 = cs[(i + 2) % 3];
      if (c >= 5 && c <= 8 && o0 >= -4 && o0 <= 4 - c && o1 >= -4 && o1 <= 4 - c) return plus[i];
      if (c <= -5 && c >= -8 && o0 >= -c - 4 && o0 <= 4 && o1 >= -c - 4 && o1 <= 4) return minus[i];
    }
    return null;
  }

  function key(q, r, s) { return q + ',' + r + ',' + s; }
  function cell(q, r) { return { q: q, r: r, s: -q - r }; }

  // —— 生成全部 121 个棋位 ——
  const CELLS = [];
  for (let q = -8; q <= 8; q++) {
    for (let r = -8; r <= 8; r++) {
      const s = -q - r;
      if (isOnBoard(q, r, s)) CELLS.push({ q: q, r: r, s: s });
    }
  }
  const keyOf = c => key(c.q, c.r, c.s);

  // —— 邻居表 ——
  const NEIGHBORS = new Map();
  for (const c of CELLS) {
    const ns = [];
    for (const d of DIRS) {
      const n = cell(c.q + d.q, c.r + d.r);
      if (isOnBoard(n.q, n.r, n.s)) ns.push(n);
    }
    NEIGHBORS.set(keyOf(c), ns);
  }
  const neighbors = c => NEIGHBORS.get(keyOf(c));

  // —— 像素坐标（点顶轴向，用于渲染和按角度排序营区）——
  const SQ3 = Math.sqrt(3);
  function pixel(c, size) {
    return { x: size * SQ3 * (c.q + c.r / 2), y: size * 1.5 * c.r };
  }

  // —— 6 个营区，按几何角度排序成环 ——
  const TIP_NAMES = ['q+', 'r+', 's+', 'q-', 'r-', 's-'];
  const rawCamps = {};
  for (const n of TIP_NAMES) rawCamps[n] = [];
  for (const c of CELLS) {
    const t = tipOf(c.q, c.r, c.s);
    if (t) rawCamps[t].push(c);
  }
  function centroidAngle(cells) {
    let sq = 0, sr = 0;
    for (const c of cells) { sq += c.q; sr += c.r; }
    const x = SQ3 * (sq / cells.length + (sr / cells.length) / 2);
    const y = 1.5 * (sr / cells.length);
    return Math.atan2(y, x);
  }
  const CAMP_NAMES = TIP_NAMES.slice().sort(
    (a, b) => centroidAngle(rawCamps[a]) - centroidAngle(rawCamps[b])
  );
  const CAMPS = CAMP_NAMES.map(n => rawCamps[n]);

  // 每个棋位属于哪个营区（-1 表示中央区）
  const CAMP_OF = new Map();
  for (let i = 0; i < 6; i++) {
    for (const c of CAMPS[i]) CAMP_OF.set(keyOf(c), i);
  }
  const campOf = c => (CAMP_OF.has(keyOf(c)) ? CAMP_OF.get(keyOf(c)) : -1);

  // 正对营区：环上相隔 3 位
  const opposite = i => (i + 3) % 6;

  // 立方距离（= 六方向最短步数）
  function dist(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
  }

  // —— 自检（测试用）——
  function verify() {
    const errs = [];
    const seen = new Set();
    for (const c of CELLS) {
      const k = keyOf(c);
      if (seen.has(k)) errs.push('重复棋位 ' + k);
      seen.add(k);
    }
    if (CELLS.length !== 121) errs.push('棋位总数 ' + CELLS.length + '，应为 121');
    for (let i = 0; i < 6; i++) {
      if (CAMPS[i].length !== 10) errs.push('营区 ' + i + ' 有 ' + CAMPS[i].length + ' 子，应为 10');
      for (const c of CAMPS[i]) if (campOf(c) !== i) errs.push('营区归属不一致 ' + keyOf(c));
    }
    // 邻居度数：尖端 2 个邻居，其余边缘位置度 4~5，内部度 6（中央六边形内部全是 6）
    for (const c of CELLS) {
      const d = neighbors(c).length;
      if (d < 1 || d > 6) errs.push('棋位 ' + keyOf(c) + ' 邻居数异常 ' + d);
    }
    return errs;
  }

  const Board = {
    DIRS, isOnBoard, tipOf, key, keyOf, cell, CELLS, NEIGHBORS, neighbors,
    CAMPS, CAMP_NAMES, CAMP_OF, campOf, opposite, dist, pixel, SQ3, verify,
  };

  globalThis.Board = Board;
  if (typeof module !== 'undefined' && module.exports) module.exports = Board;
})();
