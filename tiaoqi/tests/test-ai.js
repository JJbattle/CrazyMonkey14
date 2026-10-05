// test-ai.js —— AI 集成测试：完整跑一局 AI 对战，验证不崩、能走完、走法合法
const Game = require('../js/game.js');
const AI = require('../js/ai.js');
const B = require('../js/board.js');
const R = require('../js/rules.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

// 1. 三档 AI 都能算出合法走法
{
  const g = Game.createGame({ playerCount: 2 });
  g.select(g.players[0].pieces[0]);
  g.doStep(g.targets().steps[0]); // 轮到电脑
  for (const lv of ['easy', 'normal', 'hard']) {
    const m = AI.chooseMove(g, 1, lv);
    ok(m && m.move && m.move.path.length >= 2, lv + ' AI 能算出走法');
    if (m) {
      const legal = R.getLegalMoves(g.board, m.move.path[0]);
      ok(legal.some(x => x.kind === m.move.kind && x.jumps === m.move.jumps &&
        x.path[x.path.length - 1].q === m.move.path[m.move.path.length - 1].q &&
        x.path[x.path.length - 1].r === m.move.path[m.move.path.length - 1].r),
        lv + ' AI 走法在合法集合内');
    }
  }
}

// 2. 普通 vs 普通完整跑一局
{
  const g = Game.createGame({ playerCount: 2, seats: [
    { type: 'ai', aiLevel: 'normal' }, { type: 'ai', aiLevel: 'normal' },
  ] });
  let moves = 0;
  const t0 = Date.now();
  while (!g.isGameOver() && moves < 1000) {
    const idx = g.current;
    const m = AI.chooseMove(g, idx);
    if (!m) { console.log('  AI 无路可走，卡死在第 ' + moves + ' 步'); break; }
    g.applyMove(m.pieceIdx, m.move);
    moves++;
  }
  const ms = Date.now() - t0;
  ok(g.isGameOver(), '普通 vs 普通能走完（' + moves + ' 步）');
  ok(g.winnerOrder.length === 2, '两名玩家都有名次');
  console.log('  普通 vs 普通：' + moves + ' 步，用时 ' + ms + 'ms（平均 ' + (ms / Math.max(1, moves)).toFixed(1) + 'ms/步）');
}

// 3. 简单 vs 简单：要么走完、要么触发僵局判和（简单 AI 有随机步，可能走出互相堵死的局面，
//    此时应被 stalemate 检测兜住，而不是无限挂机）
{
  const g = Game.createGame({ playerCount: 2, seats: [
    { type: 'ai', aiLevel: 'easy' }, { type: 'ai', aiLevel: 'easy' },
  ] });
  let moves = 0, stalled = false;
  while (!g.isGameOver() && moves < 1500) {
    if (g.stalemate()) { stalled = true; break; }
    const idx = g.current;
    const m = AI.chooseMove(g, idx);
    if (!m) break;
    g.applyMove(m.pieceIdx, m.move);
    moves++;
  }
  ok(g.isGameOver() || stalled, '简单 vs 简单走完或判和（' + moves + ' 步，和棋=' + stalled + '）');
}

console.log('test-ai: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
