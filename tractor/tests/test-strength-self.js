'use strict';
// 自对弈：修复版 unseenStronger vs bug 版 unseenStronger（只换这一个变量，其余代码共享）。
// 注意：bug 版把「对手手里的更大牌」错误算成 0，AI 会盲目激进地抢牌权；在 AI vs AI 里
// 这种「抢牌权+消耗对手」意外不弱，所以本测试只要求「修复版不显著落后」（>45%）。
// 「修复后是否真的变强」以 test-strength.js（vs 新手 AI）为准：基线 79.7% → 修复后 82%。
// 跑法：在 tractor 目录下 `node tests\test-strength-self.js`
const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
// 旧版 unseenStronger（bug 版：完美信息把 4 家手牌 + 已出牌全 mark，
// 用 2 - known 反推「没见过的更大牌」，结果只剩底牌里的牌——底牌永不打出，
// 于是「稳大」判断全反了：领出以为稳大就甩 A 被压、跟牌以为稳赢就出中牌被反压）
function oldUnseenStronger(card, cat, seat) {
  const known = {};
  const mark = c => { const k = c.suit + '-' + c.rank; known[k] = (known[k] || 0) + 1; };
  for (const s of [0, 1, 2, 3]) for (const c of (this.hands[s] || [])) mark(c);
  for (const c of this.playedCards) mark(c);
  const ts = this.trumpSuit, lr = this.levelRank;
  let n = 0;
  for (const c of UNIQUE_DECK) {
    if (catOf(c, ts, lr) !== cat) continue;
    if (power(c, ts, lr) > power(card, ts, lr)) n += 2 - (known[c.suit + '-' + c.rank] || 0);
  }
  return n;
}

const ROUNDS = 1000;
let newWins = 0, oldWins = 0, played = 0, failed = 0;
const oldSeats = new Set([1, 3]);   // 旧 AI 坐 1/3，新 AI 坐 0/2，两队轮流先坐庄

for (let n = 0; n < ROUNDS; n++) {
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  g.firstRound = false;
  g.dealerSeat = (n % 2 === 0) ? 0 : 1;
  g.dealerTeam = g.dealerSeat % 2;
  g.startRound();

  // 旧座位用旧 unseenStronger（bug 版：反推只剩底牌），新座位用当前修复版
  g.unseenStronger = function (card, cat, seat) {
    if (oldSeats.has(seat)) return oldUnseenStronger.call(this, card, cat, seat);
    return Game.prototype.unseenStronger.call(this, card, cat, seat);
  };

  let guard = 0;
  while (guard++ < 30000) {
    if (g.phase === 'dealing') { let dg = 0; while (g.phase === 'dealing' && dg++ < 400) g.dealNext(); }
    else if (g.phase === 'roundEnd') {
      if (g.result.winnerTeam === 0) newWins++; else oldWins++;
      played++;
      break;
    }
    else if (g.phase === 'discard' || g.phase === 'playing') { if (!g.aiStep()) { failed++; break; } }
    else { failed++; break; }
  }
}

const pct = (newWins / played * 100).toFixed(1);
console.log('对局轮数 = ' + played + '  异常中断 = ' + failed);
console.log('新 AI(修复版 unseenStronger, 0/2号位) 赢 ' + newWins + ' 轮');
console.log('旧 AI(bug 版 unseenStronger, 1/3号位) 赢 ' + oldWins + ' 轮');
console.log('新 AI 胜率 = ' + pct + '%  (两队轮流先坐庄)');
console.log('判定：' + (played > 900 && failed === 0 && newWins / played > 0.45 ? '修复版不落后于 bug 版 ✅' : '修复版明显变弱，需复核 ⚠️'));
`;

eval(src + test);
