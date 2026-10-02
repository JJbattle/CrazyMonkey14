// 固定组队对打：每个打法两人组一队，对阵 balanced 基准队（轮流首庄），
// 队友/对手都固定，干净地比较各打法的相对强弱。不写断言，只打印结果。
const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
const REPS = { steady: '墩布', sharp: '尹天乱', balanced: '李淑静', cautious: '张文霞' };
const PROFILES = ['steady', 'sharp', 'balanced', 'cautious'];
let failed = 0;

// 队 A（打法 a，坐 0/2） vs 队 B（打法 b，坐 1/3），各 rounds 场，轮流首庄
function duel(a, b, rounds) {
  const na = REPS[a], nb = REPS[b];
  let aWin = 0;
  for (let n = 0; n < rounds; n++) {
    const g = new Game();
    g.humanSeat = -1;
    g.newGame();
    g.names = [na, nb, na, nb];
    g.firstRound = false;
    g.dealerSeat = (n % 2 === 0) ? 0 : 1;
    g.dealerTeam = g.dealerSeat % 2;
    g.startRound();
    let guard = 0;
    while (guard++ < 30000) {
      if (g.phase === 'dealing') { let dg = 0; while (g.phase === 'dealing' && dg++ < 400) g.dealNext(); }
      else if (g.phase === 'roundEnd') { if (g.result.winnerTeam === 0) aWin++; break; }
      else if (g.phase === 'discard' || g.phase === 'playing') { if (!g.aiStep()) { failed++; break; } }
      else { failed++; break; }
    }
  }
  return aWin / rounds;
}

const ROUNDS = 1200;
console.log('固定组队对打：每个打法 vs balanced 基准，各 ' + ROUNDS + ' 场（轮流首庄），异常中断 = ' + failed);
console.log('');
console.log('打法(代表玩家)        vs balanced  胜率');
for (const p of PROFILES) {
  const r = duel(p, 'balanced', ROUNDS);
  console.log(p.padEnd(14) + ' (' + REPS[p] + ')    ' + (r * 100).toFixed(1) + '%');
}
console.log('');
console.log('玩家 → 打法：墩布=steady，尹天乱=sharp，李淑静/卢志鸿=balanced，张文霞/蒋学清=cautious');
`;

eval(src + test);
