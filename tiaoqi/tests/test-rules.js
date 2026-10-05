// test-rules.js —— 校验走法：单步、跳、连跳、胜负
const B = require('../js/board.js');
const R = require('../js/rules.js');

function c(q, r) { return B.cell(q, r); }
function mkBoard(list) { const m = new Map(); for (const [cell, p] of list) m.set(B.keyOf(cell), p); return m; }
function has(arr, cell) { return arr.some(x => x.q === cell.q && x.r === cell.r && x.s === cell.s); }

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

// 1. 空棋盘：中央位 6 个单步落点、无跳
{
  const board = mkBoard([]);
  const mid = c(0, 0);
  const steps = R.stepTargets(board, mid);
  ok(steps.length === 6, '空棋盘中央 6 个单步落点，实得 ' + steps.length);
  ok(R.jumpTargets(board, mid).length === 0, '空棋盘无跳');
}

// 2. 单跳：跳过相邻棋子落到其后方空位
{
  const board = mkBoard([[c(1, 0), 1]]);
  const jumps = R.jumpTargets(board, c(0, 0));
  ok(has(jumps, c(2, 0)), '能跳过 (1,0) 落到 (2,0)');
}

// 3. 连跳两格
{
  const board = mkBoard([[c(1, 0), 1], [c(3, 0), 1]]);
  const r = R.reachableJumps(board, c(0, 0));
  ok(r.has(B.keyOf(c(2, 0))), '连跳可达 (2,0)');
  ok(r.has(B.keyOf(c(4, 0))), '连跳可达 (4,0)');
  const path4 = r.get(B.keyOf(c(4, 0)));
  ok(path4 && path4.length === 3 && path4[0].q === 0 && path4[2].q === 4, '到(4,0)路径长度 3');
}

// 4. 不允许落回起点（防止来回跳死循环）
{
  const board = mkBoard([[c(1, 0), 1]]);
  const r = R.reachableJumps(board, c(0, 0));
  ok(!r.has(B.keyOf(c(0, 0))), '不允许落回起点');
}

// 5. 后方被占不能跳
{
  const board = mkBoard([[c(1, 0), 1], [c(2, 0), 1]]);
  const jumps = R.jumpTargets(board, c(0, 0));
  ok(!has(jumps, c(2, 0)), '后方被占不能跳');
}

// 6. 跳不能吃子：被跳过的棋子仍在原处
{
  const board = mkBoard([[c(1, 0), 1]]);
  R.jumpTargets(board, c(0, 0));
  ok(board.get(B.keyOf(c(1, 0))) === 1, '被跳过的棋子原地不动');
}

// 7. getLegalMoves：单步 + 连跳都算，跳数正确
{
  const board = mkBoard([[c(1, 0), 1], [c(3, 0), 1]]);
  const moves = R.getLegalMoves(board, c(0, 0));
  const jump = moves.find(m => m.kind === 'jump' && m.path[m.path.length - 1].q === 4);
  ok(jump && jump.jumps === 2, '连跳 Move 的 jumps=2');
  const step = moves.find(m => m.kind === 'step');
  ok(!!step, '有单步 Move');
}

// 8. 胜负判定
{
  const target = 0;
  const pieces = B.CAMPS[target].slice(); // 10 子全在目标营
  ok(R.allInCamp(pieces, target) === true, '全在目标营 = 胜');
  const pieces2 = pieces.slice(0, 9).concat([c(0, 0)]);
  ok(R.allInCamp(pieces2, target) === false, '有子不在目标营 = 未胜');
}

console.log('test-rules: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
