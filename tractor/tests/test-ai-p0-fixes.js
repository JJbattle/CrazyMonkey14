const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
function ok(name, cond) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
  if (!cond) process.exitCode = 1;
}
function mk(uid, suit, rank) { return { uid, suit, rank }; }

// 摆好手牌/主牌，直接调某个 AI 判断函数看结果（plays 可选，用于跟牌场景）
function gWith(trumpSuit, levelRank, hands, plays) {
  const g = new Game();
  g.trumpSuit = trumpSuit;
  g.levelRank = levelRank;
  g.dealerSeat = 0;
  g.dealerTeam = 0;
  g.hands = hands;
  g.playedCards = [];
  g.currentTrick = (plays || []).map(p => ({ seat: p.seat, cards: p.cards }));
  g.names = ['你', '下家', '对家', '上家'];
  return g;
}

// ===== P0-1 组合级稳大：对子/拖拉机按「更大的同型组合」算，不再数散牌 =====

// —— 1) 对 K 撞对 A：1 个威胁（对子），不是 2 张散牌 ——
{
  const g = gWith(3, 2, [
    [mk(1, 1, 14), mk(2, 1, 14)],            // 对手0：红桃对A
    [mk(3, 1, 13), mk(4, 1, 13)],            // 我1：红桃对K
    [], [],
  ]);
  ok('对K撞对A → 1 个威胁（对子）', g.unseenStrongerCombo(g.hands[1].slice(0, 2), 'suit:1', 1) === 1);
  ok('旧单张口径会是 2（对照出 bug 的差距）', g.unseenStronger(g.hands[1][0], 'suit:1', 1) === 2);
}

// —— 2) 对手只有一张散 A（凑不成对）→ 对 K 是 0 威胁 ——
{
  const g = gWith(3, 2, [
    [mk(1, 1, 14), mk(2, 0, 3)],             // 对手0：红桃A(单) + 黑桃3
    [mk(3, 1, 13), mk(4, 1, 13)],            // 我1：红桃对K
    [], [],
  ]);
  ok('对手只有散A → 对K 0 威胁', g.unseenStrongerCombo(g.hands[1].slice(0, 2), 'suit:1', 1) === 0);
}

// —— 3) 单张仍走组合口径：更大的单张算 1 ——
{
  const g = gWith(3, 2, [
    [mk(1, 1, 14)],                          // 对手0：红桃A
    [mk(3, 1, 13)],                          // 我1：红桃K
    [], [],
  ]);
  ok('单张K撞A → 1 威胁', g.unseenStrongerCombo([g.hands[1][0]], 'suit:1', 1) === 1);
}

// —— 4) 拖拉机：9-8 撞 A-K（同长）→ 1 个威胁 ——
{
  const g = gWith(3, 2, [
    [mk(1, 0, 14), mk(2, 0, 14), mk(3, 0, 13), mk(4, 0, 13)],  // 对手0：黑桃A-K 拖拉机
    [mk(5, 0, 9), mk(6, 0, 9), mk(7, 0, 8), mk(8, 0, 8)],      // 我1：黑桃9-8 拖拉机
    [], [],
  ]);
  ok('拖拉机9-8撞A-K → 1 威胁', g.unseenStrongerCombo(g.hands[1], 'suit:0', 1) === 1);
}

// ===== P0-2 顶牌取消 A 限制 =====

// —— 5) A 在对家手里时，K 就是有效顶牌，领 K ——
{
  const g = gWith(3, 2, [
    [mk(1, 1, 12)],                          // 对手0：红桃Q（压不住K）
    [mk(3, 1, 13), mk(4, 0, 4)],             // 我1：红桃K + 黑桃4
    [mk(5, 1, 12)],                          // 对手2：红桃Q
    [mk(6, 1, 14)],                          // 对家3：红桃A
  ]);
  const out = g.aiLead(1);
  ok('A在对家 → K 领出（不再只认A）', out.length === 1 && out[0].suit === 1 && out[0].rank === 13);
}

// ===== P0-3 稳大/跟牌加入将吃威胁 =====

// —— 6) A 虽顶大，但对手空门有主能毙 → 不领这张 A ——
{
  const g = gWith(3, 2, [
    [mk(1, 3, 5)],                           // 对手0：空门红桃，有方块5(主)能毙
    [mk(3, 1, 14), mk(4, 0, 4)],             // 我1：红桃A + 黑桃4
    [mk(5, 1, 3)],                           // 对手2：红桃3
    [mk(6, 1, 13)],                          // 对家3：红桃K
  ]);
  const out = g.leadTopSingle(1, g.hands[1]);
  ok('A会被将吃 → leadTopSingle 不领 A', out === null);
}

// —— 7) 跟牌稳赢判断躲将吃：后面对手空门能毙 → 改垫小牌保 A ——
{
  const g = gWith(3, 2,
    [[], [], [mk(20, 0, 14), mk(21, 0, 3)], [mk(30, 3, 6)]],  // 我2：黑桃A+3；对手3：空门黑桃有方块6
    [{ seat: 0, cards: [mk(1, 0, 3)] }, { seat: 1, cards: [mk(2, 0, 4)] }]);
  const out = g.aiPlay(2);
  ok('后面对手能毙黑桃A → 改垫黑桃3保A', out.length === 1 && out[0].rank === 3);
}

// ===== P0-4 喂对家也检查将吃 =====

// —— 8) 对家有顶牌，但对手空门能毙 → 不喂这门，改走别的 ——
{
  const g = gWith(3, 2, [
    [mk(1, 3, 5)],                           // 对手0：空门红桃，有方块5(主)能毙
    [mk(3, 1, 4), mk(4, 0, 5)],              // 我1：红桃4 + 黑桃5（无大牌）
    [],                                      // 对手2：空
    [mk(6, 1, 14)],                          // 对家3：红桃A（顶牌）
  ]);
  const out = g.aiLead(1);
  ok('喂对家会被将吃 → 不领红桃4喂对家', !(out.length === 1 && out[0].suit === 1 && out[0].rank === 4));
}
`;

eval(src + test);
