const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
function ok(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) process.exitCode = 1;
}

// ===== 语义化造牌 factory =====
// 每张牌显式声明类别，杜绝「rank 撞 levelRank 悄悄变主」的坑（上次测试就是把 rank2
// 当普通副牌，结果 levelRank=2 时它其实是级牌）：
//   off(suit, rank)  → 普通副牌（花色≠主花色、rank≠级牌、非王）
//   trump(rank)      → 主花色牌（非级牌、非王）
//   lvl(suit)        → 级牌（任意花色都是主）
//   lvlTrump()       → 主级牌（主花色的级牌，980）
//   small() / big()  → 小王 / 大王
function factory(trumpSuit, levelRank) {
  let uid = 1000;
  const mk = (suit, rank) => ({ uid: uid++, suit, rank });
  return {
    ts: trumpSuit, lr: levelRank,
    off: (suit, rank) => {
      if (suit === trumpSuit || rank === levelRank || rank >= 16)
        throw new Error('off() 撞主：suit=' + suit + ' rank=' + rank + '（trumpSuit=' + trumpSuit + ' levelRank=' + levelRank + '）');
      return mk(suit, rank);
    },
    trump: (rank) => {
      if (rank === levelRank || rank >= 16) throw new Error('trump() 非法：rank=' + rank);
      return mk(trumpSuit, rank);
    },
    lvl: (suit) => mk(suit, levelRank),
    lvlTrump: () => mk(trumpSuit, levelRank),
    small: () => mk(4, 16),
    big: () => mk(4, 17),
  };
}

// 领出局面：AI 固定坐 1 号位；others 形如 {0:[..], 2:[..], 3:[..]} 覆盖其它座位手牌
function leadGame(trumpSuit, levelRank, hand, others) {
  const g = new Game();
  g.trumpSuit = trumpSuit; g.levelRank = levelRank;
  g.dealerSeat = 0; g.dealerTeam = 0;
  g.hands = [[], [], [], []];
  g.hands[1] = hand;
  for (const s in (others || {})) g.hands[Number(s)] = others[s];
  g.playedCards = []; g.currentTrick = [];
  g.names = ['你', '下家', '对家', '上家'];
  return g;
}

// 跟牌局面：摆好当前圈 + 4 家手牌；opts.roundPoints / opts.dealerTeam 可选
function trickGame(trumpSuit, levelRank, plays, hands, opts) {
  const g = new Game();
  g.trumpSuit = trumpSuit; g.levelRank = levelRank;
  g.dealerSeat = (opts && opts.dealerTeam) === 1 ? 1 : 0;
  g.dealerTeam = (opts && opts.dealerTeam) || 0;
  g.hands = hands;
  g.playedCards = [];
  g.currentTrick = plays.map(p => ({ seat: p.seat, cards: p.cards }));
  g.roundPoints = (opts && opts.roundPoints) || 0;
  g.names = ['你', '下家', '对家', '上家'];
  return g;
}

// 扣底局面：摆好 4 家手牌，调 aiDiscard(0)（seat0 坐庄）
function discardGame(trumpSuit, levelRank, hands) {
  const g = new Game();
  g.trumpSuit = trumpSuit; g.levelRank = levelRank;
  g.dealerSeat = 0; g.dealerTeam = 0;
  g.hands = hands;
  g.playedCards = []; g.currentTrick = [];
  g.names = ['你', '下家', '对家', '上家'];
  return g;
}

// ===== P0-B-1 短门分牌领出：非分低牌造空门优先，分牌只在确定安全时才领 =====

// —— 1) K+3：对手有 ♠A，♠K 不安全 → 领 ♠3 造空门，不领 ♠K 送分 ——
{
  const f = factory(3, 2);
  const g = leadGame(3, 2, [f.off(0, 13), f.off(0, 3)], { 0: [f.off(0, 14)] });
  const out = g.aiLead(1);
  ok('K+3：领 ♠3 造空门，不领 ♠K 送分', out.length === 1 && out[0].suit === 0 && out[0].rank === 3);
}

// —— 2) 10+3：对手有 ♠J，♠10 不安全 → 领 ♠3 ——
{
  const f = factory(3, 2);
  const g = leadGame(3, 2, [f.off(0, 10), f.off(0, 3)], { 0: [f.off(0, 11)] });
  const out = g.aiLead(1);
  ok('10+3：领 ♠3，不领 ♠10 送分', out.length === 1 && out[0].rank === 3);
}

// —— 3) 5+3：对手有 ♠10，♠5 不安全 → 领 ♠3 ——
{
  const f = factory(3, 2);
  const g = leadGame(3, 2, [f.off(0, 5), f.off(0, 3)], { 0: [f.off(0, 10)] });
  const out = g.aiLead(1);
  ok('5+3：领 ♠3，不领 ♠5 送分', out.length === 1 && out[0].rank === 3);
}

// —— 4) 分牌确定安全（没人能压、没人能毙）→ 仍领分牌 ——
{
  const f = factory(3, 2);
  const g = leadGame(3, 2, [f.off(0, 10)], { 0: [f.off(1, 4)] });
  const out = g.aiLead(1);
  ok('分牌确定安全：领 ♠10', out.length === 1 && out[0].suit === 0 && out[0].rank === 10);
}

// —— 5) 对家有顶牌但会被将吃：不喂对家，兜底领非分红桃4造空门（不送黑桃5） ——
{
  const f = factory(3, 2);
  const g = leadGame(3, 2, [f.off(1, 4), f.off(0, 5)], { 0: [f.trump(5)], 3: [f.off(1, 14)] });
  const out = g.aiLead(1);
  ok('对家有顶牌但会被将吃：领非分红桃4造空门，不送黑桃5', out.length === 1 && out[0].suit === 1 && out[0].rank === 4);
}

// ===== P0-B-2 关键节点允许拆结构（庄家方守节点，拆对王拦分） =====

// —— 5) 75 分 + 当前 5 分：庄家拆对王用大王拦，否则闲家过 80 ——
{
  const f = factory(3, 2);
  const g = trickGame(3, 2,
    [{ seat: 0, cards: [f.off(0, 5)] }],           // 闲家领 ♠5（5 分）
    [
      [],                                          // seat0 已出
      [f.trump(12), f.big(), f.big()],             // seat1 庄家：♦Q + 对大王（空门黑桃）
      [f.trump(13)],                               // seat2 闲家：♦K（能盖过 ♦Q 的将吃）
      [],
    ],
    { roundPoints: 75, dealerTeam: 1 });
  const out = g.aiPlay(1);
  ok('75+5 分节点：庄家拆对王用大王拦', out.length === 1 && out[0].rank === 17);
}

// —— 6) 115 分节点：同样拆对王拦，否则闲家过 120 ——
{
  const f = factory(3, 2);
  const g = trickGame(3, 2,
    [{ seat: 0, cards: [f.off(0, 5)] }],
    [
      [],
      [f.trump(12), f.big(), f.big()],
      [f.trump(13)],
      [],
    ],
    { roundPoints: 115, dealerTeam: 1 });
  const out = g.aiPlay(1);
  ok('115 分节点：庄家拆对王用大王拦', out.length === 1 && out[0].rank === 17);
}

// —— 7) 非节点普通墩：不拆对王，照常出最低能赢的 ♦Q ——
{
  const f = factory(3, 2);
  const g = trickGame(3, 2,
    [{ seat: 0, cards: [f.off(0, 5)] }],
    [
      [],
      [f.trump(12), f.big(), f.big()],
      [f.trump(13)],
      [],
    ],
    { roundPoints: 30, dealerTeam: 1 });
  const out = g.aiPlay(1);
  ok('非节点普通墩：不拆对王，出 ♦Q', out.length === 1 && out[0].suit === 3 && out[0].rank === 12);
}

// ===== P0-B-3 扣底保底风险（strong 埋分造缺 / weak 非分优先） =====

// —— 8) 强保底：主牌碾压 → 短门分牌 ♠K 照埋（积极埋分造缺） ——
{
  const f = factory(3, 2);
  const hand0 = [
    f.big(), f.big(), f.small(), f.small(), f.lvlTrump(), f.lvlTrump(), // 6 张大主
    f.off(0, 13), f.off(0, 3),                                          // ♠K ♠3（短门）
    f.off(1, 4), f.off(1, 6), f.off(1, 7), f.off(1, 8),                 // 红桃非分
    f.off(2, 4), f.off(2, 6), f.off(2, 7), f.off(2, 8),                 // 梅花非分
  ];
  const g = discardGame(3, 2, [hand0, [f.off(1, 3)], [], [f.off(2, 3)]]);
  const out = g.aiDiscard(0);
  ok('强保底：短门分牌 ♠K 照埋', out.some(c => c.suit === 0 && c.rank === 13));
}

// —— 9) 弱保底：闲家主牌碾压 → 不再埋 ♠K，非分优先 ——
{
  const f = factory(3, 2);
  const hand0 = [
    f.off(0, 13), f.off(0, 3),                                          // ♠K ♠3（短门）
    f.off(1, 3), f.off(1, 4), f.off(1, 6), f.off(1, 7), f.off(1, 8),    // 红桃非分 ×5
    f.off(2, 3), f.off(2, 4), f.off(2, 6), f.off(2, 7), f.off(2, 8),    // 梅花非分 ×5
  ];
  const g = discardGame(3, 2, [
    hand0,
    [f.big(), f.big(), f.small(), f.small(), f.lvlTrump(), f.lvlTrump()], // 闲家 seat1 大主
    [],
    [f.off(1, 9)],
  ]);
  const out = g.aiDiscard(0);
  ok('弱保底：不再埋 ♠K（非分优先）', !out.some(c => c.suit === 0 && c.rank === 13));
}

// ===== P0-B-4 残局末墩控制（对王留到最后一墩） =====

// —— 10) 残局（3 张）：对大王留最后一墩，先领 ♠3 ——
{
  const f = factory(3, 2);
  const g = leadGame(3, 2, [f.big(), f.big(), f.off(0, 3)]);
  const out = g.aiLead(1);
  ok('残局：对大王留最后一墩，先领 ♠3', out.length === 1 && out[0].suit === 0 && out[0].rank === 3);
}

// —— 11) 非残局（4 张）：照常领对大王抢牌权 ——
{
  const f = factory(3, 2);
  const g = leadGame(3, 2, [f.big(), f.big(), f.off(0, 3), f.off(1, 4)]);
  const out = g.aiLead(1);
  ok('非残局：照常领对大王', out.length === 2 && out.every(c => c.rank === 17));
}
`;

eval(src + test);
