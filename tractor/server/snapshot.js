'use strict';
const { SEAT_CN } = require('./engine');

// 构造「单个手机」的视野快照。硬规则：只含该 seat 自己的手牌，
// 其他家只有张数；AI 和其他真人的手牌内容绝不外泄。
function buildSnapshot(game, seat, extra) {
  const e = extra || {};
  const snap = {
    type: 'state',
    seq: e.seq || 0,
    you: { seat, name: (game.names && game.names[seat]) || SEAT_CN[seat] || ('座位' + seat) },
    names: game.names ? game.names.slice() : [],
    phase: game.phase,
    levelRank: game.levelRank,
    levels: game.levels ? game.levels.slice() : [2, 2],
    trumpSuit: game.trumpSuit,
    dealerSeat: game.dealerSeat,
    dealerTeam: game.dealerTeam,
    bidDecidesDealer: game.bidDecidesDealer,
    firstBidSeat: game.firstBidSeat,
    mustPlayHurdles: game.mustPlayHurdles,
    bid: game.bid,
    leadSeat: game.leadSeat,
    hand: game.hands[seat].slice(),          // ★ 只此一家手牌（拷贝，脱离后续 splice）
    handCounts: game.hands.map(h => h.length),
    currentTrick: game.currentTrick.map(p => ({ seat: p.seat, cards: p.cards.slice() })),
    lastTrick: game.lastTrick
      ? { plays: game.lastTrick.plays.map(p => ({ seat: p.seat, cards: p.cards.slice() })), winner: game.lastTrick.winner, points: game.lastTrick.points }
      : null,
    roundPoints: game.roundPoints,
    result: game.result,
    cycleDone: game.cycleDone,
    taunts: game.taunts,
    lastThrowFail: game.lastThrowFail,
    logTail: game.log.slice(-30),
  };
  if (e.bidOptions) snap.bidOptions = e.bidOptions;
  if (e.yourTurn !== undefined) snap.yourTurn = e.yourTurn;
  if (e.waitingFor !== undefined) snap.waitingFor = e.waitingFor;
  return snap;
}

module.exports = { buildSnapshot };
