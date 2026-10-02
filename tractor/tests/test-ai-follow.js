const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
function ok(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) process.exitCode = 1;
}

function mk(uid, suit, rank) { return { uid, suit, rank }; }

// 摆好一圈（领出 + 已跟的牌），直接调 aiPlay(seat) 看它跟什么
function trickSetup(trumpSuit, levelRank, plays, hands) {
  const g = new Game();
  g.trumpSuit = trumpSuit;
  g.levelRank = levelRank;
  g.dealerSeat = 0;
  g.dealerTeam = 0;
  g.hands = hands;
  g.playedCards = [];
  g.currentTrick = plays.map(p => ({ seat: p.seat, cards: p.cards }));
  g.names = ['你', '下家', '对家', '上家'];
  return g;
}

// —— 1) 跟主接不住时，垫非分大牌（方块J），别垫小主/分主送分 ——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 3, 14)] },              // 方块A（主，最大）
  ], [
    [],                                              // seat0
    [mk(10, 3, 13), mk(11, 3, 11), mk(12, 3, 5)],    // 方块K(分)、方块J(非分)、方块5(分)
    [], [],
  ]);
  const out = g.aiPlay(1);
  ok('跟主接不住垫非分大牌', out.length === 1 && out[0].rank === 11);
}

// —— 2) 第三名：没有稳赢牌就垫小牌，别拿中牌6去赌（会被第四名10压）——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 0, 3)] },               // 黑桃3（领出）
    { seat: 1, cards: [mk(2, 0, 4)] },               // 黑桃4（当前最大，对手）
  ], [
    [],
    [],
    [mk(20, 0, 3), mk(21, 0, 6)],                    // AI：黑桃3(垫) + 黑桃6(能赢但会被压)
    [mk(30, 0, 10)],                                 // 第四名手里黑桃10
  ]);
  const out = g.aiPlay(2);
  ok('第三名垫小牌不赌中牌', out.length === 1 && out[0].rank === 3);
}

// —— 3) 第三名有稳赢的A，就出A（压过第四名），不垫 ——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 0, 3)] },
    { seat: 1, cards: [mk(2, 0, 4)] },
  ], [
    [],
    [],
    [mk(20, 0, 3), mk(21, 0, 14)],                   // AI：黑桃3 + 黑桃A（稳赢）
    [mk(30, 0, 10)],
  ]);
  const out = g.aiPlay(2);
  ok('第三名有稳赢A就出A', out.length === 1 && out[0].rank === 14);
}
`;

eval(src + test);
