// test-board.js —— 校验棋盘数据结构：121 位、6 营区、邻接、对称性
const B = require('../js/board.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

const errs = B.verify();
ok(errs.length === 0, 'verify 无错误 ' + JSON.stringify(errs));
ok(B.CELLS.length === 121, '121 个棋位，实得 ' + B.CELLS.length);

// 6 营区各 10 子、互不重叠
let overlap = 0;
const used = new Set();
for (let i = 0; i < 6; i++) {
  ok(B.CAMPS[i].length === 10, '营区 ' + i + ' 有 10 子');
  for (const c of B.CAMPS[i]) {
    const k = B.keyOf(c);
    if (used.has(k)) overlap++;
    used.add(k);
  }
}
ok(overlap === 0, '营区互不重叠');
ok(used.size === 60, '营区共 60 子');

// 正对关系自反
for (let i = 0; i < 6; i++) ok(B.opposite(B.opposite(i)) === i, 'opposite 自反 i=' + i);

// 中央六边形内部（|q|,|r|,|s|<=3）邻居都是 6
let interiorBad = 0;
for (const c of B.CELLS) {
  if (Math.abs(c.q) <= 3 && Math.abs(c.r) <= 3 && Math.abs(c.s) <= 3) {
    if (B.neighbors(c).length !== 6) interiorBad++;
  }
}
ok(interiorBad === 0, '中央内部全 6 邻居');

// 尖端（|坐标|==8）邻居 2
let tip = 0, tipBad = 0;
for (const c of B.CELLS) {
  if (Math.abs(c.q) === 8 || Math.abs(c.r) === 8 || Math.abs(c.s) === 8) {
    tip++;
    if (B.neighbors(c).length !== 2) tipBad++;
  }
}
ok(tip === 6, '6 个尖端，实得 ' + tip);
ok(tipBad === 0, '尖端都是 2 邻居');

// 营区质心
function campCentroid(i) { let q = 0, r = 0; for (const c of B.CAMPS[i]) { q += c.q; r += c.r; } return { q: q / 10, r: r / 10 }; }
function campAngle(i) {
  const m = campCentroid(i);
  const p = B.pixel({ q: m.q, r: m.r, s: -m.q - m.r }, 1);
  return Math.atan2(p.y, p.x);
}

// 正对营区质心关于原点对称
let oppOk = true;
for (let i = 0; i < 3; i++) {
  const a = campCentroid(i), b = campCentroid(i + 3);
  if (Math.abs(a.q + b.q) > 0.5 || Math.abs(a.r + b.r) > 0.5) oppOk = false;
}
ok(oppOk, '正对营区质心关于原点对称');

// 6 营区环形等距（相邻夹角约 60°）
const angles = [];
for (let i = 0; i < 6; i++) angles.push(campAngle(i));
let angOk = true;
for (let i = 0; i < 6; i++) {
  let d = angles[(i + 1) % 6] - angles[i];
  if (d < 0) d += 2 * Math.PI;
  if (Math.abs(d - Math.PI / 3) > 0.01) angOk = false;
}
ok(angOk, '6 营区环形等距（各约 60°）');

console.log('test-board: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
