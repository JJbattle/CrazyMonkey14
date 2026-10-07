const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
function ok(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) process.exitCode = 1;
}
function mk(uid, suit, rank) { return { uid, suit, rank }; }

// 摆好一圈，直接调 aiPlay(seat) 看它出啥（hands 是各家「当前手牌」，不含已出的牌）
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

// ===== 跟牌喂队友：对手当前赢着、我抢不稳，队友（还没出）有对手压不住的顶牌 =====

// —— 1) 队友有黑桃A（顶牌），我出小分黑桃5 喂队友 ——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 0, 10)] },   // 0号领黑桃10（分牌，当前最大，对手）
  ], [
    [],
    [mk(10, 0, 3), mk(11, 0, 5)],        // AI(1号)：黑桃3 + 黑桃5（小分）
    [mk(20, 0, 7)],                      // 对手2号：黑桃7（压不住黑桃A）
    [mk(30, 0, 14)],                     // 队友3号：黑桃A（顶牌，对手压不住）
  ]);
  const out = g.aiPlay(1);
  ok('对手赢着队友有顶牌 → 出小分喂队友', out.length === 1 && out[0].rank === 5);
}

// —— 2) 我没分牌 → 出小破牌黑桃3 喂队友 ——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 0, 10)] },
  ], [
    [],
    [mk(10, 0, 3), mk(11, 0, 6)],        // AI：黑桃3 + 黑桃6（都非分）
    [mk(20, 0, 7)],
    [mk(30, 0, 14)],
  ]);
  const out = g.aiPlay(1);
  ok('对手赢着队友有顶牌、我没分 → 出小破牌喂队友', out.length === 1 && out[0].rank === 3);
}

// —— 3) 对手压得住队友顶牌 → 不喂，照常垫小牌 ——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 0, 10)] },
  ], [
    [],
    [mk(10, 0, 3), mk(11, 0, 5)],
    [mk(20, 0, 14)],                     // 对手2号：黑桃A（压得住队友的黑桃K）
    [mk(30, 0, 13)],                     // 队友3号：黑桃K（顶牌，但被黑桃A压）
  ]);
  const out = g.aiPlay(1);
  ok('对手压得住队友顶牌 → 不喂（垫小牌）', out.length === 1 && out[0].rank === 3);
}

// ===== 将吃优先用分牌、不拆对/拖拉机 =====

// —— 4) 无红桃，用主牌将吃，优先出分牌方块5 ——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 1, 13)] },   // 0号领红桃K（分牌，副牌）
  ], [
    [],
    [mk(10, 3, 3), mk(11, 3, 5), mk(12, 3, 10)],  // AI：方块3 + 方块5(分) + 方块10(分)
    [], [],
  ]);
  const out = g.aiPlay(1);
  ok('将吃优先出分牌（方块5）', out.length === 1 && out[0].rank === 5);
}

// —— 5) 将吃不拆对：方块5 是对子，跳过，出方块10 ——
{
  const g = trickSetup(3, 2, [
    { seat: 0, cards: [mk(1, 1, 13)] },
  ], [
    [],
    [mk(10, 3, 3), mk(11, 3, 5), mk(12, 3, 5), mk(13, 3, 10)],  // 方块5 对子
    [], [],
  ]);
  const out = g.aiPlay(1);
  ok('将吃不拆对（跳过方块5对子，出方块10）', out.length === 1 && out[0].rank === 10);
}
`;

eval(src + test);
