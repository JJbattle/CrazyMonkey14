const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
// 旧版"新手"AI：只会跟最低牌、领最低单张，不认队友、不记牌
function naiveLead(g, seat) {
  const hand = g.hands[seat], ts = g.trumpSuit, lr = g.levelRank;
  const nonTrump = hand.filter(c => !isTrump(c, ts, lr) && pointValue(c) === 0);
  const pool = nonTrump.length ? nonTrump : hand;
  return [g.lowestCard(pool, ts, lr)];
}
function naivePlay(g, seat) {
  const hand = g.hands[seat], ts = g.trumpSuit, lr = g.levelRank;
  if (g.currentTrick.length === 0) return naiveLead(g, seat);
  const lead = classifyLead(g.currentTrick[0].cards, ts, lr);
  const leadCat = lead.isTrump ? 'trump' : 'suit:' + lead.suit;
  const need = needOf(lead);
  const cat = hand.filter(c => catOf(c, ts, lr) === leadCat);
  if (cat.length === 0) {
    // 旧版行为：只有圈里有分才尝试将吃
    if (g.trickPoints() > 0) {
      const wins = g.winningFollows(seat, hand.filter(c => isTrump(c, ts, lr)), lead);
      if (wins.length) return wins[0];
    }
    return g.lowJunkFill(hand, need);
  }
  // 旧版行为：能管住就用最低的管住，管不住垫最低
  const wins = g.winningFollows(seat, cat, lead);
  if (wins.length) return wins[0];
  return g.legalFollow(hand, cat, lead, need);
}

const ROUNDS = 600;
let strongWins = 0, naiveWins = 0, played = 0;
let failed = 0;

for (let n = 0; n < ROUNDS; n++) {
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  // 之后各局坐庄由上一局轮转决定（不再由首亮者定庄）。
  // 两队轮流先坐庄（偶数局强队坐、奇数局弱队坐），免得固定一方坐庄带偏向。
  g.firstRound = false;
  g.dealerSeat = (n % 2 === 0) ? 0 : 1;
  g.dealerTeam = g.dealerSeat % 2;
  g.startRound();

  const protoPlay = Game.prototype.aiPlay, protoLead = Game.prototype.aiLead;
  g.aiPlay = function (seat) { return (seat === 1 || seat === 3) ? naivePlay(this, seat) : protoPlay.call(this, seat); };
  g.aiLead = function (seat) { return (seat === 1 || seat === 3) ? naiveLead(this, seat) : protoLead.call(this, seat); };

  let guard = 0;
  while (guard++ < 30000) {
    if (g.phase === 'dealing') { let dg = 0; while (g.phase === 'dealing' && dg++ < 400) g.dealNext(); }
    else if (g.phase === 'roundEnd') {
      const w = g.result.winnerTeam;
      if (w === 0) strongWins++; else naiveWins++;
      played++;
      break;
    }
    else if (g.phase === 'discard' || g.phase === 'playing') { if (!g.aiStep()) { failed++; break; } }
    else { failed++; break; }
  }
}

const pct = (strongWins / played * 100).toFixed(1);
console.log('对局轮数 = ' + played + '  异常中断 = ' + failed);
console.log('强 AI(0/2号位) 赢 ' + strongWins + ' 轮  新手 AI(1/3号位) 赢 ' + naiveWins + ' 轮');
console.log('强 AI 胜率 = ' + pct + '%  (两队轮流先坐庄)');
console.log('判定：' + (played > 500 && failed === 0 && strongWins / played > 0.55 ? '强 AI 明显更强 ✅' : '需复核 ⚠️'));
`;

eval(src + test);
