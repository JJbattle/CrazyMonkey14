const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('✗ ' + name + (extra ? '  ' + extra : '')); } }

// ================= 1) 首亮者坐庄，反主不改庄 =================
{
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  // 清掉发牌过程中 AI 已经产生的叫牌，从零开始测
  g.bid = null; g.firstBidSeat = null;
  const fakeCard = (suit, rank) => ({ uid: Math.random(), suit, rank });

  // 3 号位先亮黑桃
  g.hands[3].push(fakeCard(0, g.levelRank));
  g.placeBid(3, { seat: 3, suit: 0, kind: 'single' });
  ok('首亮者被记录', g.firstBidSeat === 3, 'firstBidSeat=' + g.firstBidSeat);

  // 1 号位用一对级牌反主
  g.hands[1].push(fakeCard(1, g.levelRank), fakeCard(1, g.levelRank));
  g.placeBid(1, { seat: 1, suit: 1, kind: 'pair' });
  ok('反主后坐庄者仍是首亮者', g.firstBidSeat === 3, 'firstBidSeat=' + g.firstBidSeat);

  g.dealPos = 100;
  g.finishDeal();
  ok('坐庄座位 = 首亮者(3号位)', g.dealerSeat === 3, 'dealerSeat=' + g.dealerSeat);
  ok('主牌取反主后的花色(红桃)', g.trumpSuit === 1, 'trumpSuit=' + g.trumpSuit);
  ok('庄家队伍 = 首亮者所在队', g.dealerTeam === g.teamOf(3));
}

// ================= 2) 5/10/K 必打，不能跳级 =================
function makeGameWithLevel(team, lvl) {
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  g.levels = [2, 2];
  g.levels[team] = lvl;
  return g;
}
{
  // 队0 在 4 级，大光升 3 级 → 只能到 5（必打），不能到 7
  const g = makeGameWithLevel(0, 4);
  g.mustPlayHurdles = true;
  g.dealerTeam = 0; g.dealerSeat = 0;
  g.levels = [4, 2];
  // 直接调用结算：让庄家守庄、闲家 0 分（大光 +3）
  g.roundPoints = 0; g.bottomCards = []; g.leadSeat = 0;
  g.phase = 'playing';
  g.finishRound();
  ok('4级 大光 只能升到 5（必打）', g.levels[0] === 5, 'levels[0]=' + g.levels[0]);

  // 关掉必打 → 应该到 7
  const g2 = makeGameWithLevel(0, 4);
  g2.mustPlayHurdles = false;
  g2.dealerTeam = 0; g2.dealerSeat = 0;
  g2.levels = [4, 2];
  g2.roundPoints = 0; g2.bottomCards = []; g2.leadSeat = 0;
  g2.phase = 'playing';
  g2.finishRound();
  ok('关必打后 4级大光 可升到 7', g2.levels[0] === 7, 'levels[0]=' + g2.levels[0]);

  // 9 级 大光 +3 → 只能到 10
  const g3 = makeGameWithLevel(0, 9);
  g3.mustPlayHurdles = true;
  g3.dealerTeam = 0; g3.dealerSeat = 0;
  g3.levels = [9, 2];
  g3.roundPoints = 0; g3.bottomCards = []; g3.leadSeat = 0;
  g3.phase = 'playing';
  g3.finishRound();
  ok('9级 大光 只能升到 10（必打）', g3.levels[0] === 10, 'levels[0]=' + g3.levels[0]);

  // 12 级 小光 +2 → 只能到 13(K)
  const g4 = makeGameWithLevel(0, 12);
  g4.mustPlayHurdles = true;
  g4.dealerTeam = 0; g4.dealerSeat = 0;
  g4.levels = [12, 2];
  g4.roundPoints = 20; g4.bottomCards = []; g4.leadSeat = 0;
  g4.phase = 'playing';
  g4.finishRound();
  ok('12级 小光 只能升到 K(13)', g4.levels[0] === 13, 'levels[0]=' + g4.levels[0]);

  // 4 级 守庄 +1 → 5 级，正常（不跨坎）
  const g5 = makeGameWithLevel(0, 4);
  g5.mustPlayHurdles = true;
  g5.dealerTeam = 0; g5.dealerSeat = 0;
  g5.levels = [4, 2];
  g5.roundPoints = 60; g5.bottomCards = []; g5.leadSeat = 0;
  g5.phase = 'playing';
  g5.finishRound();
  ok('4级 守庄 +1 正常到 5', g5.levels[0] === 5, 'levels[0]=' + g5.levels[0]);
}

// ================= 3) 无限循环：连打 30 轮都不会卡住 =================
// （现在没有终局了，打到玩家不想玩为止，所以只验证「一直能继续打」）
{
  let rounds = 0, err = null;
  try {
    for (let n = 0; n < 30; n++) {
      const g = new Game();
      g.humanSeat = -1;
      g.newGame();
      let guard = 0;
      while (g.phase !== 'roundEnd' && guard++ < 40000) {
        if (g.phase === 'dealing') { let d = 0; while (g.phase === 'dealing' && d++ < 400) g.dealNext(); }
        else if (g.phase === 'discard' || g.phase === 'playing') { if (!g.aiStep()) break; }
        else break;
      }
      if (g.phase === 'roundEnd') rounds++;
    }
  } catch (e) { err = e; }
  ok('30 轮全部正常打完（含必打规则）', rounds === 30 && !err,
     rounds + '/30' + (err ? ' ' + err.message : ''));
}

// ================= 4) 必打规则下每队都会经过 5、10、K =================
{
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  let guard = 0, jumped = 0, prev = [2, 2], rounds = 0;
  while (rounds < 120 && guard++ < 60000) {
    if (g.phase === 'dealing') { let d = 0; while (g.phase === 'dealing' && d++ < 400) g.dealNext(); }
    else if (g.phase === 'roundEnd') {
      for (const t of [0, 1]) {
        const p = prev[t], c = g.levels[t];
        if (!(p === 15 && c === 2)) {            // 绕完一圈回到 2 是正常的，不算跨坎
          for (const h of [5, 10, 13]) if (p < h && c > h) jumped++;
        }
      }
      prev = g.levels.slice();
      rounds++;
      g.nextRound();
    }
    else if (g.phase === 'discard' || g.phase === 'playing') { if (!g.aiStep()) break; }
    else break;
  }
  ok('120 轮里全程没有跨过 5/10/K', jumped === 0, '跨坎次数=' + jumped + ' 轮数=' + rounds);
}

console.log('规则测试（二）：通过 ' + pass + ' / 失败 ' + fail);
`;

eval(src + test);
