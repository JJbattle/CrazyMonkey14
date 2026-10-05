// ai-vs-ai.js —— AI v2 对 AI v1 自对弈测试
//
// 验证 V2（新 evaluate/search）确实强于 V1（旧贪心+2层 negamax）。
// 两人局里先入满目标营者胜（winnerOrder[0]），轮流互换颜色消除先手/后手偏差。
//
// 用法：node tests/ai-vs-ai.js [--games 100]
//   默认 100 局；达标线：V2 胜率 > 60%。

const Game = require('../js/game.js');
const V2 = require('../js/ai.js');
const V1 = require('../js/ai_v1.js');

let games = 100;
let level = 'hard';
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--games' && argv[i + 1]) games = parseInt(argv[i + 1], 10);
  if (argv[i] === '--level' && argv[i + 1]) level = argv[i + 1];
}

let v2Wins = 0, v1Wins = 0, draws = 0;
let completed = 0, totalMoves = 0, totalNodes = 0, maxTime = 0, maxNodes = 0;

for (let g = 0; g < games; g++) {
  const v2Idx = g % 2;        // 交替颜色
  const v1Idx = 1 - v2Idx;
  const game = Game.createGame({ playerCount: 2 });
  let moves = 0, stalled = false;

  // 2 人局：先入满目标营者即胜（winnerOrder[0]），无需等另一方也入满。
  // 因此循环只进行到「有人入满」为止，避免获胜后另一方卡死被误判成和棋。
  while (game.winnerOrder.length === 0 && moves < 1000) {
    if (game.stalemate()) { stalled = true; break; }
    const idx = game.current;
    const ai = (idx === v2Idx) ? V2 : V1;
    const m = ai.chooseMove(game, idx, level);
    if (!m) break;
    if (idx === v2Idx) {
      totalNodes += m.nodes || 0;
      maxTime = Math.max(maxTime, m.timeMs || 0);
      maxNodes = Math.max(maxNodes, m.nodes || 0);
    }
    game.applyMove(m.pieceIdx, m.move);
    moves++;
  }

  if (game.winnerOrder.length >= 1) {
    completed++;
    totalMoves += moves;
    if (game.winnerOrder[0] === v2Idx) v2Wins++;
    else v1Wins++;
  } else {
    draws++;
  }
}

console.log('V2 vs V1 自对弈：' + games + ' 局');
console.log('  V2 胜 ' + v2Wins + '（' + (v2Wins / games * 100).toFixed(1) + '%）');
console.log('  V1 胜 ' + v1Wins);
console.log('  和棋/未完 ' + draws);
if (completed) {
  console.log('  平均回合 ' + (totalMoves / completed).toFixed(1));
  console.log('  V2 平均节点/步 ' + (totalNodes / Math.max(1, totalMoves)).toFixed(0) +
    '，单步峰值 ' + maxNodes + '，最长思考 ' + maxTime + 'ms');
}

const rate = v2Wins / games;
const pass = rate > 0.60;
console.log(pass ? 'PASS' : 'FAIL' + '：V2 胜率 ' + (rate * 100).toFixed(1) + '%（需 > 60%）');
process.exit(pass ? 0 : 1);
