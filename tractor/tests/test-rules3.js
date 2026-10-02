const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('✗ ' + name + (extra ? '  ' + extra : '')); } }

let UID = 0;
const C = (suit, rank) => ({ uid: 'u' + (UID++), suit, rank });

// ================= 1) 等级打到「王」再回到 2 =================
{
  ok('等级名称：14=A', levelName(14) === 'A');
  ok('等级名称：15=王', levelName(15) === '王');
  ok('打过王回到 2', nextLevel(15) === 2);
  ok('王之下正常 +1', nextLevel(14) === 15);

  // A 级守庄成功 → 升到「王」，还没赢
  const g = new Game();
  g.humanSeat = -1; g.newGame();
  g.dealerTeam = 0; g.dealerSeat = 0; g.levels = [14, 2];
  g.roundPoints = 60; g.bottomCards = []; g.leadSeat = 0; g.lastTrick = null;
  g.phase = 'playing';
  g.finishRound();
  ok('A 级守庄 → 升到王（不是立刻获胜）', g.levels[0] === 15 && g.phase === 'roundEnd',
     'levels[0]=' + g.levels[0] + ' phase=' + g.phase);

  // 王 级守庄成功 → 绕完一整圈（不是终局），等级回到 2，并给出表扬
  const g2 = new Game();
  g2.humanSeat = -1; g2.newGame();
  g2.dealerTeam = 0; g2.dealerSeat = 0; g2.levels = [15, 2];
  g2.roundPoints = 60; g2.bottomCards = []; g2.leadSeat = 0; g2.lastTrick = null;
  g2.phase = 'playing';
  g2.finishRound();
  ok('王 级守庄成功 → 游戏继续（无限循环，没有终局）',
     g2.phase === 'roundEnd' && !g2.winner, 'phase=' + g2.phase + ' winner=' + g2.winner);
  ok('绕完一整圈后等级回到 2', g2.levels[0] === 2, 'levels[0]=' + g2.levels[0]);
  ok('绕完一圈会记下是哪一队（好弹表扬）', g2.cycleDone === 0, 'cycleDone=' + g2.cycleDone);
  ok('表扬里有夸奖的话', /厉害|不错|好/.test(g2.result.summary), g2.result.summary);
}

// ================= 1b) 甩牌的失败判定把「自己手里同门剩下的牌」也算进去 =================
{
  // 玩家原话例子：红桃剩 A Q Q 7 6 5 5 4 2 2，A 持有 A Q Q 7 4 2 2，其他人有 6 和 5 5
  // → A 可以一把甩 A Q Q 7（剩下的 4、2 2 会被压，甩不出去）
  const g = new Game();
  g.humanSeat = -1; g.newGame();
  g.trumpSuit = 0; g.levelRank = 9;        // 主黑桃、打 9 → 红桃是副牌，2 不是级牌
  g.hands[0] = [C(1, 14), C(1, 12), C(1, 12), C(1, 7), C(1, 4), C(1, 2), C(1, 2)];
  g.hands[1] = [C(1, 6)];
  g.hands[2] = [C(1, 5), C(1, 5)];
  g.hands[3] = [];

  const all = g.hands[0].slice(0, 7);
  const info = classifyThrow(all, 0, 9);
  ok('A Q Q 7 4 2 2 能拆成多组（是甩牌牌型）', !!info && info.comps.length >= 4,
     info ? '组数=' + info.comps.length : 'null');
  const bad = g.throwFailReason(0, info);
  ok('整门全甩 → 会被压住（4 被 6 压、2 2 被 5 5 压）', !!bad, bad ? bad.why : '没压住');

  const safe = g.safeThrowSubset(0, all);
  const key = c => c.suit + '-' + c.rank;
  ok('能甩出去的稳牌正好是 ♥A ♥Q ♥Q ♥7', !!safe && safe.length === 4 &&
     safe.map(key).sort().join(',') === ['1-14', '1-12', '1-12', '1-7'].sort().join(','),
     safe ? safe.map(cardText).join(' ') : 'null');

  const info2 = classifyThrow(safe, 0, 9);
  ok('只甩 A Q Q 7 → 不被压，甩牌成功', info2 && g.throwFailReason(0, info2) === null);
}

// ================= 2) 抠底：(最后一圈张数 + 1) 倍 =================
function bottomGame() {
  const g = new Game();
  g.humanSeat = -1; g.newGame();
  g.dealerTeam = 0; g.dealerSeat = 0; g.levels = [2, 2];
  g.roundPoints = 0;
  g.bottomCards = [C(2, 5), C(2, 5), C(3, 9), C(3, 8), C(3, 7), C(3, 6), C(3, 4), C(3, 3)]; // 底牌 10 分
  g.phase = 'playing';
  return g;
}
{
  // 例：最后一圈「双 K」抠底 —— 圈内 20(双K) + 5(别人) = 25，底牌 10 分 × 3
  const g = bottomGame();
  g.roundPoints = 25;
  g.leadSeat = 1;                                  // 闲家(队1)赢了最后一圈 → 抠底
  g.lastTrick = {
    winner: 1,
    plays: [
      { seat: 1, cards: [C(0, 13), C(0, 13)] },    // 双 K = 20 分
      { seat: 2, cards: [C(2, 5), C(3, 9)] },      // 5 分
      { seat: 3, cards: [C(2, 9), C(3, 8)] },
      { seat: 0, cards: [C(2, 8), C(3, 7)] },
    ],
    points: 25,
  };
  g.finishRound();
  ok('双 K 抠底：底分 × 3', g.result.bottomMult === 3, '倍数=' + g.result.bottomMult);
  ok('双 K 抠底总分 = 25 + 10×3 = 55', g.result.attackerPts === 55, 'attackerPts=' + g.result.attackerPts);

  // 单张抠底 → ×2
  const g2 = bottomGame();
  g2.roundPoints = 20;
  g2.leadSeat = 1;
  g2.lastTrick = { winner: 1, plays: [{ seat: 1, cards: [C(0, 13)] }], points: 20 };
  g2.finishRound();
  ok('单张抠底：底分 × 2', g2.result.bottomMult === 2 && g2.result.attackerPts === 20 + 20,
     '倍=' + g2.result.bottomMult + ' 分=' + g2.result.attackerPts);

  // 拖拉机抠底（4 张）→ ×5
  const g3 = bottomGame();
  g3.roundPoints = 0;
  g3.leadSeat = 1;
  g3.lastTrick = { winner: 1, plays: [{ seat: 1, cards: [C(0, 13), C(0, 13), C(0, 12), C(0, 12)] }], points: 0 };
  g3.finishRound();
  ok('拖拉机抠底：底分 × 5', g3.result.bottomMult === 5, '倍数=' + g3.result.bottomMult);

  // 庄家自己赢了最后一圈 → 不抠底，底分不加给闲家
  const g4 = bottomGame();
  g4.roundPoints = 20;
  g4.leadSeat = 0;                                 // 庄家(队0)赢最后一圈
  g4.lastTrick = { winner: 0, plays: [{ seat: 0, cards: [C(0, 13), C(0, 13)] }], points: 20 };
  g4.finishRound();
  ok('庄家赢最后一圈 → 闲家不加底分', g4.result.attackerPts === 20, 'attackerPts=' + g4.result.attackerPts);
}

// ================= 3) 无人亮主 → 玩家坐庄打无主 =================
{
  const g = new Game();
  g.humanSeat = 0; g.newGame();
  g.bid = null; g.firstBidSeat = null;
  g.dealPos = 100;
  g.finishDeal();
  ok('无人亮主 → 玩家坐庄', g.dealerSeat === 0, 'dealerSeat=' + g.dealerSeat);
  ok('无人亮主 → 打无主', g.trumpSuit === -1, 'trumpSuit=' + g.trumpSuit);
  ok('无人亮主 → 直接进入扣底', g.phase === 'discard', 'phase=' + g.phase);

  // 无主时：主牌只有「4 张王 + 级牌」
  g.levelRank = 2; g.trumpSuit = -1;
  ok('无主：王是主', isTrump(C(4, 17), -1, 2) && isTrump(C(4, 16), -1, 2));
  ok('无主：四门 2 都是主', [0, 1, 2, 3].every(s => isTrump(C(s, 2), -1, 2)));
  ok('无主：3、A 都不是主', [0, 1, 2, 3].every(s => !isTrump(C(s, 3), -1, 2) && !isTrump(C(s, 14), -1, 2)));
  ok('无主：大王压小王压级牌', power(C(4, 17), -1, 2) > power(C(4, 16), -1, 2)
     && power(C(4, 16), -1, 2) > power(C(0, 2), -1, 2));
}

// ================= 4) 每局结束有对家/对手的话 =================
{
  const g = new Game();
  g.humanSeat = 0; g.newGame();
  g.dealerTeam = 0; g.dealerSeat = 0; g.levels = [2, 2];
  g.roundPoints = 60; g.bottomCards = []; g.leadSeat = 0; g.lastTrick = null;
  g.phase = 'playing';
  g.finishRound();
  ok('对家(2号位)有话说', !!g.taunts[2], JSON.stringify(g.taunts));
  ok('两个对手(1/3号位)都有话说', !!g.taunts[1] && !!g.taunts[3], JSON.stringify(g.taunts));

  // 换一局，玩家那队赢 → 对家应该夸、对手应该酸
  const said = new Set();
  for (let i = 0; i < 40; i++) {
    const g2 = new Game();
    g2.humanSeat = 0; g2.newGame();
    g2.dealerTeam = 0; g2.dealerSeat = 0; g2.levels = [2, 2];
    g2.roundPoints = 60; g2.bottomCards = []; g2.leadSeat = 0; g2.lastTrick = null;
    g2.phase = 'playing';
    g2.finishRound();             // 队0 守庄成功 → 玩家这队赢
    said.add(g2.taunts[2]);
    for (const s of [1, 3]) said.add(g2.taunts[s]);
  }
  ok('嘴炮是随机多句（不是固定一句）', said.size >= 4, '不同句子数=' + said.size);
}

// ================= 5) 坐庄在胜利者之间轮转 =================
// 玩家原话：东家坐庄，赢了以后西家坐；如果输了则是北家坐。
// 0=东, 1=北, 2=西, 3=南（对家是搭档，隔 2 个座位）
function dealAfter(dealerSeat, dealerWins, rp) {
  const g = new Game();
  g.humanSeat = -1; g.newGame();
  g.dealerTeam = dealerSeat % 2;
  g.dealerSeat = dealerSeat;
  g.levels = [2, 2];
  g.roundPoints = rp;              // 60 → 庄家守庄；100 → 闲家上台
  g.bottomCards = []; g.leadSeat = dealerSeat; g.lastTrick = null;
  g.phase = 'playing';
  g.finishRound();
  return { seat: g.dealerSeat, team: g.dealerTeam, won: g.result.winnerTeam === g.result.dealerTeam };
}
{
  const a = dealAfter(0, true, 60);
  ok('东家(0)守庄成功 → 换搭档西家(2)坐庄', a.seat === 2 && a.team === 0,
     'seat=' + a.seat + ' team=' + a.team);
  const b = dealAfter(0, false, 100);
  ok('东家(0)被打下来 → 换北家(1)坐庄', b.seat === 1 && b.team === 1,
     'seat=' + b.seat + ' team=' + b.team);
  const c = dealAfter(2, true, 60);
  ok('西家(2)守庄成功 → 换东家(0)坐庄', c.seat === 0, 'seat=' + c.seat);
  const d = dealAfter(2, false, 100);
  ok('西家(2)被打下来 → 换南家(3)坐庄', d.seat === 3 && d.team === 1,
     'seat=' + d.seat + ' team=' + d.team);

  // 长跑：坐庄位永远属于赢的那一队，而且两队各自的**两个座位都轮得到**
  const g = new Game();
  g.humanSeat = -1; g.newGame();
  const byTeam = [{ 0: new Set(), 1: new Set() }, { 0: new Set(), 1: new Set() }];
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    byTeam[g.teamOf(g.dealerSeat)][g.dealerSeat % 2 === 0 ? 0 : 1].add(g.dealerSeat);
    if (g.teamOf(g.dealerSeat) !== g.dealerTeam) bad++;
    g.roundPoints = (i % 3 === 0) ? 100 : 60;
    g.bottomCards = []; g.leadSeat = g.dealerSeat; g.lastTrick = null;
    g.phase = 'playing';
    g.finishRound();
    g.phase = 'playing';
  }
  ok('坐庄位永远属于坐庄的那一队', bad === 0, '错位次数=' + bad);
  ok('每队的两个座位轮得到坐庄（不会永远同一人）',
     byTeam[0][0].size + byTeam[0][1].size >= 2 && byTeam[1][0].size + byTeam[1][1].size >= 2,
     '队0见到 ' + (byTeam[0][0].size + byTeam[0][1].size) + ' 个座位，队1见到 ' +
     (byTeam[1][0].size + byTeam[1][1].size) + ' 个座位');
}

// ================= 5b) 第二局起：坐庄只由轮转决定，亮主只定主牌 =================
// 玩家原话：除了第一局靠亮牌定庄，之后亮牌只决定主牌花色，不决定谁坐庄。
{
  // 第一局东家(0)守庄成功 → 轮转后西家(2)坐庄
  const g = new Game();
  g.humanSeat = -1; g.newGame();
  g.dealerTeam = 0; g.dealerSeat = 0; g.levels = [2, 2];
  g.roundPoints = 60; g.bottomCards = []; g.leadSeat = 0; g.lastTrick = null;
  g.phase = 'playing';
  g.finishRound();                     // → 西家(2)坐庄
  ok('第一局东家守庄 → 西家(2)坐庄', g.dealerSeat === 2 && g.dealerTeam === 0,
     'seat=' + g.dealerSeat);

  g.startRound();                      // 第二局：轮转已定庄，不再是「亮主定庄」
  ok('第二局不再由亮主定庄', g.bidDecidesDealer === false);

  // 南家(3，对方队)先亮黑桃主
  g.hands[3].push({ uid: Math.random(), suit: 0, rank: g.levelRank });
  g.placeBid(3, { seat: 3, suit: 0, kind: 'single' });
  ok('南家先亮主被记下', g.firstBidSeat === 3, 'firstBidSeat=' + g.firstBidSeat);
  g.dealPos = 100;
  g.finishDeal();
  ok('亮主不换庄：仍是西家(2)坐庄', g.dealerSeat === 2 && g.dealerTeam === 0,
     'dealerSeat=' + g.dealerSeat + ' firstBidSeat=' + g.firstBidSeat);
  ok('主牌仍取亮主的花色(黑桃)', g.trumpSuit === 0, 'trumpSuit=' + g.trumpSuit);

  // 反过来：东家第一局被打下来 → 北家(1)坐庄；第二局别人亮主也换不动
  const g2 = new Game();
  g2.humanSeat = -1; g2.newGame();
  g2.dealerTeam = 0; g2.dealerSeat = 0; g2.levels = [2, 2];
  g2.roundPoints = 100; g2.bottomCards = []; g2.leadSeat = 0; g2.lastTrick = null;
  g2.phase = 'playing';
  g2.finishRound();                    // → 北家(1)坐庄
  g2.startRound();
  g2.hands[0].push({ uid: Math.random(), suit: 1, rank: g2.levelRank });
  g2.placeBid(0, { seat: 0, suit: 1, kind: 'single' });
  g2.dealPos = 100;
  g2.finishDeal();
  ok('被打下来后亮主也不换庄：仍是北家(1)坐庄', g2.dealerSeat === 1 && g2.dealerTeam === 1,
     'dealerSeat=' + g2.dealerSeat + ' firstBidSeat=' + g2.firstBidSeat);
}

// ================= 6) 随机玩家 &「墩布」只会喵喵叫 =================
{
  let catWrong = 0, dup = 0, notMeow = 0, gentleBad = 0, mama = 0, meNotFixed = 0;
  const combos = new Set();
  for (let i = 0; i < 200; i++) {
    const g = new Game();
    g.humanSeat = 0; g.newGame();
    if (g.pname(2) !== CAT_NAME) catWrong++;
    // 真人座位永远是你自己，绝不参加随机；只有 1、3 号位是陪玩
    if (g.pname(g.humanSeat) !== HUMAN_NAME) meNotFixed++;
    const others = [g.pname(1), g.pname(3)];
    if (others.indexOf(CAT_NAME) >= 0) catWrong++;
    if (others.indexOf(HUMAN_NAME) >= 0) dup++;
    if (new Set(others).size !== 2) dup++;
    for (const n of others) if (PLAYER_POOL.indexOf(n) < 0) dup++;
    combos.add(others.slice().sort().join(','));

    g.dealerTeam = 0; g.dealerSeat = 0; g.levels = [2, 2];
    g.roundPoints = (i % 2) ? 100 : 60;      // 一半赢一半输，两种台词都要覆盖
    g.bottomCards = []; g.leadSeat = 0; g.lastTrick = null;
    g.phase = 'playing';
    g.finishRound();

    const t2 = g.taunts[2];
    if (t2 === CAT_MAMA) mama++;
    else if (CAT_LINES.indexOf(t2) < 0) notMeow++;
    for (const s of [1, 3]) {
      const t = g.taunts[s];
      if (GENTLE_WIN.indexOf(t) < 0 && GENTLE_LOSE.indexOf(t) < 0) gentleBad++;
    }
  }
  ok('墩布永远坐对家（2 号位），别的座位不会是它', catWrong === 0, '错位 ' + catWrong);
  ok('真人座位永远是自己，不掺和随机取名', meNotFixed === 0, '被改了 ' + meNotFixed + ' 次');
  ok('两个陪玩名字互不重复，且都来自陪玩名册', dup === 0, '不合格 ' + dup);
  ok('每次开局两个陪玩是随机组合', combos.size >= 5, '不同组合 ' + combos.size);
  ok('墩布只会喵喵叫（偶尔喊妈妈）', notMeow === 0, '说了别的 ' + notMeow + ' 次');
  ok('其他人一律温和鼓励，不嘲讽', gentleBad === 0, '不合规 ' + gentleBad + ' 次');
  ok('墩布有小概率喊妈妈（0 < 次数 < 全部）', mama > 0 && mama < 200, '喊妈妈 ' + mama + '/200');
}

console.log('规则测试（三）：通过 ' + pass + ' / 失败 ' + fail);
`;

eval(src + test);
