'use strict';
const { Game } = require('./engine');
const { buildSnapshot } = require('./snapshot');

const DEAL_GAP = 150;     // 发牌每张间隔（ms）
const BID_GAP = 1500;     // 真人可亮主时，发牌暂停给个等待（ms）
const AI_GAP = 1200;      // AI 每步间隔（ms）
const TRICK_SHOW = 2000;  // 一圈打完展示（ms）
const ROUND_SHOW = 9000;  // 一局结算展示（ms）

const HUMAN_SEATS = [0, 2];   // 两个真人固定坐对家（同队），AI 坐 1、3

class Room {
  constructor() {
    this.game = new Game();
    this.game.humanSeats = new Set(HUMAN_SEATS);
    this.game.humanNames = {};
    this.game.assignNames();
    this.conns = { 0: null, 2: null };
    this.seatByName = {};
    this.seq = 0;
    this.timer = null;
    this.bidSkipped = new Set();  // 已经给过亮主机会、暂不重复提醒的真人
    this.started = false;
    this.stopping = false;
  }

  isFull() { return !!(this.conns[0] && this.conns[2]); }

  // 分配座位：先 0 后 2；同名视为重连，还原原座位；满了返回 -1
  assignSeat(name) {
    if (name && this.seatByName[name] !== undefined) return this.seatByName[name];
    if (!this.conns[0]) return 0;
    if (!this.conns[2]) return 2;
    return -1;
  }

  // ===== 消息入口 =====
  onMessage(ws, msg) {
    switch (msg.type) {
      case 'join': this.onJoin(ws, msg.name || ''); break;
      case 'placeBid': this.onPlaceBid(ws, msg); break;
      case 'passBid': this.onPassBid(ws); break;
      case 'doDiscard': this.onDiscard(ws, msg); break;
      case 'playCards': this.onPlay(ws, msg); break;
    }
  }

  onJoin(ws, name) {
    const seat = this.assignSeat(name);
    if (seat < 0) {
      this.send(ws, { type: 'error', msg: '房间已满（已有一桌在玩）' });
      setTimeout(() => { try { ws.close(); } catch (e) {} }, 100);
      return;
    }
    this.seatByName[name] = seat;
    this.game.humanNames[seat] = name;
    this.game.assignNames();
    if (this.conns[seat]) { try { this.conns[seat].close(); } catch (e) {} } // 同名重连：顶替旧连接
    this.conns[seat] = ws;
    ws.seat = seat;
    ws.name = name;
    this.send(ws, { type: 'welcome', seat, name });
    this.broadcastPlayers();
    if (this.isFull() && !this.started) this.startGame();
    else if (this.started) this.sendState(seat); // 重连补发当前状态
  }

  onLeave(ws) {
    if (ws.seat === undefined) return;
    if (this.conns[ws.seat] === ws) {
      this.conns[ws.seat] = null;
      this.broadcastPlayers();
      if (this.started) this.broadcastWait(this.game.pname(ws.seat) + ' 掉线了，等待重连…');
    }
  }

  // ===== 开局 / 发牌 =====
  startGame() {
    this.started = true;
    this.bidSkipped.clear();
    this.game.newGame();   // 洗牌，phase='dealing'
    this.broadcastState();
    this.dealLoop();
  }

  dealLoop() {
    if (this.stopping) return;
    const g = this.game;
    if (g.phase !== 'dealing') { this.afterDeal(); return; }
    const prevBid = g.bid;
    const last = g.dealNext();   // 发一张；AI 座位会顺手自动亮主
    if (g.bid !== prevBid) this.bidSkipped.clear();  // 有人亮主 → 重新开放所有人反主
    if (last && last.seat !== undefined && this.bidSkipped.has(last.seat)) this.bidSkipped.delete(last.seat); // 拿到新牌 → 重新给机会
    this.broadcastState();
    if (last && last.done) { this.afterDeal(); return; }
    const bidder = this.currentBidder();
    if (bidder !== null) {
      this.bidSkipped.add(bidder);   // 给过机会了，接下来 1.5s 内不重复提醒
      this.timer = setTimeout(() => this.dealLoop(), BID_GAP);
      return;
    }
    this.timer = setTimeout(() => this.dealLoop(), DEAL_GAP);
  }

  currentBidder() {
    for (const s of HUMAN_SEATS) {
      if (!this.conns[s]) continue;
      if (this.bidSkipped.has(s)) continue;
      if (this.game.allBids(s).some(b => this.game.bidBeats(this.game.bid, b))) return s;
    }
    return null;
  }

  afterDeal() {
    this.broadcastState();  // finishDeal 已把 phase 切到 discard
    this.advance();
  }

  // ===== 真人行动 =====
  onPlaceBid(ws, msg) {
    const seat = ws.seat;
    if (this.game.placeBid(seat, msg.bid)) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.bidSkipped.clear();
      this.broadcastState();
      if (this.game.phase === 'dealing') this.dealLoop();
    } else {
      this.send(ws, { type: 'error', msg: '这手亮不了' });
    }
  }

  onPassBid(ws) {
    this.bidSkipped.add(ws.seat);
    if (this.game.phase === 'dealing' && this.timer) {
      clearTimeout(this.timer); this.timer = null;
      this.dealLoop();
    }
  }

  onDiscard(ws, msg) {
    const seat = ws.seat;
    if (this.game.doDiscard(seat, msg.cards)) {
      this.broadcastState();
      this.advance();
    } else {
      this.send(ws, { type: 'error', msg: '扣底不合法' });
    }
  }

  onPlay(ws, msg) {
    const seat = ws.seat;
    if (this.game.playCards(seat, msg.cards)) {
      this.broadcastState();
      this.afterPlay();
    } else {
      this.send(ws, { type: 'error', msg: this.game.lastPlayFail || '这么出不行' });
    }
  }

  // ===== 推进（AI 泵 + 节奏） =====
  advance() {
    if (this.stopping) return;
    const g = this.game;
    if (g.phase === 'discard') {
      if (g.isHuman(g.dealerSeat)) { this.broadcastState(); return; }  // 等真人扣底
      this.timer = setTimeout(() => { g.aiStep(); this.broadcastState(); this.advance(); }, AI_GAP);
      return;
    }
    if (g.phase === 'playing') {
      const seat = g.currentSeat();
      if (g.isHuman(seat)) {
        if (!this.conns[seat]) { this.broadcastWait(g.pname(seat) + ' 掉线了，等待重连…'); return; }
        this.broadcastState();  // 等真人出牌
        return;
      }
      this.timer = setTimeout(() => { g.aiStep(); this.broadcastState(); this.afterPlay(); }, AI_GAP);
      return;
    }
    if (g.phase === 'roundEnd') {
      this.timer = setTimeout(() => this.nextRound(), ROUND_SHOW);
      return;
    }
  }

  afterPlay() {
    const g = this.game;
    if (g.phase === 'playing' && g.currentTrick.length === 0 && g.lastTrick) {
      this.timer = setTimeout(() => this.advance(), TRICK_SHOW);  // 一圈打完，展示 2s
    } else if (g.phase === 'roundEnd') {
      this.timer = setTimeout(() => this.nextRound(), ROUND_SHOW);  // 结算展示 9s
    } else {
      this.advance();
    }
  }

  nextRound() {
    if (this.stopping) return;
    this.game.nextRound();  // → startRound → phase='dealing'
    this.bidSkipped.clear();
    this.broadcastState();
    this.dealLoop();
  }

  // ===== 下发 =====
  send(ws, obj) {
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {}
  }

  sendState(seat, extra) {
    const ws = this.conns[seat];
    if (!ws) return;
    const g = this.game;
    const e = Object.assign({}, extra || {});
    // 亮主窗口：发牌中该真人能亮主且没跳过 → 附上可选叫牌
    if (g.phase === 'dealing' && !this.bidSkipped.has(seat)) {
      const opts = g.allBids(seat).filter(b => g.bidBeats(g.bid, b));
      if (opts.length) { e.bidOptions = opts; e.yourTurn = true; }
    }
    // 轮到该真人行动
    if (g.phase === 'discard' && g.isHuman(g.dealerSeat) && g.dealerSeat === seat) e.yourTurn = true;
    if (g.phase === 'playing' && g.isHuman(g.currentSeat()) && g.currentSeat() === seat) e.yourTurn = true;
    this.send(ws, buildSnapshot(g, seat, Object.assign({ seq: ++this.seq }, e)));
  }

  broadcastState(extra) {
    this.sendState(0, extra);
    this.sendState(2, extra);
  }

  broadcastPlayers() {
    const joined = HUMAN_SEATS.filter(s => this.conns[s]).map(s => ({ seat: s, name: this.game.humanNames[s] }));
    const payload = { type: 'players', joined, waitingFor: 2 - joined.length };
    for (const s of HUMAN_SEATS) if (this.conns[s]) this.send(this.conns[s], payload);
  }

  broadcastWait(text) {
    for (const s of HUMAN_SEATS) if (this.conns[s]) this.send(this.conns[s], { type: 'toast', text });
  }

  stop() {
    this.stopping = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}

module.exports = { Room };
