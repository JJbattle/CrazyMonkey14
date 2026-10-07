'use strict';
// 量化验证：改过的 AI 跟「改动前」的自己打，看是不是真的变强。
// 对照组不是新手 AI（那已经到天花板测不出差异），而是旧逻辑的 AI。
// 跑法：在 tractor 目录下 `node tests\test-strength-self.js`
const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
// 旧版 unseenStronger（半信息：只统计自己手牌 + 已出牌，把对手手牌当「没见」）
function oldUnseenStronger(card, cat, seat) {
  const known = {};
  const mark = c => { const k = c.suit + '-' + c.rank; known[k] = (known[k] || 0) + 1; };
  for (const c of this.hands[seat]) mark(c);
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

  // 旧座位用旧 unseenStronger（半信息），新座位用当前实现（完美信息版）
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
console.log('新 AI(完美信息 unseenStronger, 0/2号位) 赢 ' + newWins + ' 轮');
console.log('旧 AI(半信息 unseenStronger, 1/3号位) 赢 ' + oldWins + ' 轮');
console.log('新 AI 胜率 = ' + pct + '%  (两队轮流先坐庄)');
console.log('判定：' + (played > 900 && failed === 0 && newWins / played > 0.55 ? '新 AI 明显更强 ✅' : '无明显提升（该改动无效，需另找方向）⚠️'));
`;

eval(src + test);
