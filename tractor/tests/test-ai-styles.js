const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
function ok(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) process.exitCode = 1;
}
function mk(uid, suit, rank) { return { uid, suit, rank }; }

// 摆一个「手里红桃对 K + 黑桃 4」的局面，把 seat 1 的名字设成给定值，看它领出啥
function gameWithName(name) {
  const g = new Game();
  g.trumpSuit = 3; g.levelRank = 2;   // 方块主 → 红桃是副牌
  g.dealerSeat = 0; g.dealerTeam = 0; // seat 1 非庄家
  g.hands = [[], [], [], []];
  g.hands[1] = [mk(1, 1, 13), mk(2, 1, 13), mk(3, 0, 4)];
  g.playedCards = [];
  g.currentTrick = [];
  g.names = ['', '', '', ''];
  g.names[1] = name;
  return g;
}

// —— 1) 墩布（对家）用最稳最强的 steady ——
{
  const g = new Game();
  g.names = ['你', '下家', '墩布', '上家'];
  ok('对家墩布 = steady 打法', g.profileOf(2) === AI_PROFILES.steady);
}

// —— 2) 陪玩名字对号入座 ——
{
  const g = new Game();
  g.names = ['', '尹天乱', '', ''];
  ok('尹天乱 = sharp', g.profileOf(1) === AI_PROFILES.sharp);
  g.names = ['', '张文霞', '', ''];
  ok('张文霞 = cautious', g.profileOf(1) === AI_PROFILES.cautious);
  g.names = ['', '李淑静', '', ''];
  ok('李淑静 = balanced', g.profileOf(1) === AI_PROFILES.balanced);
  g.names = ['', '某个没登记的名字', '', ''];
  ok('没登记的名字回落 balanced', g.profileOf(1) === AI_PROFILES.balanced);
}

// —— 3) 风格差异真的影响出牌：手里对 K（外面对 A 还没出），
//       稳的（steady）敢出对 K，保守的（cautious）不敢、改出小牌 ——
{
  const gSteady = gameWithName('墩布');
  const outSteady = gSteady.aiLead(1);
  ok('墩布敢出对K', outSteady.length === 2 && outSteady.every(c => c.rank === 13));

  const gCautious = gameWithName('张文霞');
  const outCautious = gCautious.aiLead(1);
  ok('保守打法不敢出对K（改出小牌）',
     !(outCautious.length === 2 && outCautious.every(c => c.rank === 13)));
}
`;

eval(src + test);
