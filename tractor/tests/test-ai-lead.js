const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
function ok(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) process.exitCode = 1;
}

function mk(uid, suit, rank) { return { uid, suit, rank }; }
// 被测 AI 固定坐 1 号位（非庄家队），手动摆好手牌和主牌/级牌，直接调 aiLead 看它领出啥
function seatSetup(trumpSuit, levelRank, dealerTeam, hand) {
  const g = new Game();
  g.trumpSuit = trumpSuit;
  g.levelRank = levelRank;
  g.dealerSeat = dealerTeam === 0 ? 0 : 1;
  g.dealerTeam = dealerTeam;
  g.hands = [[], [], [], []];
  g.hands[1] = hand;
  g.playedCards = [];
  g.currentTrick = [];
  // 固定名字，让 seat1 = 下家 → balanced（longTrumpMin=12），消除 new Game() 随机抽名的波动
  g.names = ['你', '下家', '对家', '上家'];
  return g;
}

// —— 1) 手里有副牌单张 A，领出该打 A，而不是出小破牌 ——
{
  const g = seatSetup(3, 2, 0, [
    mk(1, 1, 14), mk(2, 1, 3), mk(3, 0, 4), mk(4, 2, 5),
  ]);
  const out = g.aiLead(1);
  ok('有副牌A时领出A', out.length === 1 && out[0].suit === 1 && out[0].rank === 14);
}

// —— 2) 手里有对大王，领出该出对王（抢牌权；「甩主」才禁止，出对子没问题）——
{
  const g = seatSetup(0, 2, 0, [
    mk(1, 4, 17), mk(2, 4, 17), mk(3, 1, 3), mk(4, 2, 4),
  ]);
  const out = g.aiLead(1);
  ok('有对大王时领出对王', out.length === 2 && out.every(c => c.rank === 17));
}

// —— 3) 手里有副牌对 A，领出该出对 A（回归锁定）——
{
  const g = seatSetup(3, 2, 0, [
    mk(1, 1, 14), mk(2, 1, 14), mk(3, 0, 4),
  ]);
  const out = g.aiLead(1);
  ok('有副牌对A时领出对A', out.length === 2 && out.every(c => c.suit === 1 && c.rank === 14));
}

// —— 4) 副牌对 A 和对王同时在手，按「先副牌大牌、再打主」该先出副牌对 A ——
{
  const g = seatSetup(3, 2, 0, [
    mk(1, 1, 14), mk(2, 1, 14), mk(3, 4, 17), mk(4, 4, 17), mk(5, 0, 4),
  ]);
  const out = g.aiLead(1);
  ok('副牌对A和对王都在手，先出副牌对A', out.length === 2 && out.every(c => c.suit === 1 && c.rank === 14));
}

// —— 5) 副牌单 A 和对王同时在手，先出副牌单 A ——
{
  const g = seatSetup(3, 2, 0, [
    mk(1, 1, 14), mk(2, 1, 3), mk(3, 4, 17), mk(4, 4, 17), mk(5, 0, 4),
  ]);
  const out = g.aiLead(1);
  ok('副牌单A和对王都在手，先出副牌单A', out.length === 1 && out[0].suit === 1 && out[0].rank === 14);
}

// —— 6) 主特别长（≥12 张，无对子）→ 吊最大主牌钓光：出大王 ——
{
  const hand = [mk(1, 4, 17), mk(2, 4, 16)];  // 单大王 + 单小王
  for (let i = 0; i < 10; i++) hand.push(mk(100 + i, 3, 3 + i)); // 方块 3..12（主花色）
  const g = seatSetup(3, 2, 0, hand);
  const out = g.aiLead(1);
  ok('主特别长时吊大王钓光', out.length === 1 && out[0].rank === 17);
}

// —— 7) 副牌没大牌时喂对家：对家红桃有 A，出红桃低牌让对家接手 ——
{
  const g = seatSetup(3, 2, 0, [
    mk(1, 3, 3),      // 方块3（主）
    mk(2, 1, 4),      // 红桃4（副）
    mk(3, 0, 5),      // 黑桃5（副）
  ]);
  g.hands[3] = [mk(20, 1, 14)];  // 对家（seat 3）红桃 A
  const out = g.aiLead(1);
  ok('喂对家：出红桃低牌让对家红桃A接手', out.length === 1 && out[0].suit === 1 && out[0].rank === 4);
}

// —— 8) 副牌没大牌时喂对家（主）：对家有大主，吊小主让对家接手 ——
{
  const g = seatSetup(3, 2, 0, [
    mk(1, 3, 3),      // 方块3（主，小主）
    mk(2, 1, 4),      // 红桃4（副）
    mk(3, 0, 5),      // 黑桃5（副）
  ]);
  g.hands[3] = [mk(21, 4, 17)];  // 对家（seat 3）大王
  const out = g.aiLead(1);
  ok('喂对家（主）：吊小主让对家大王接手', out.length === 1 && out[0].suit === 3 && out[0].rank === 3);
}
`;

eval(src + test);
