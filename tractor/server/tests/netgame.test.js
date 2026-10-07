'use strict';
// 服务器端测试：验证「多真人（对家）引擎能跑完整局」+「快照信息隐藏」+「座位分配」。
// 跑法：在 tractor/server 目录下 `node tests\netgame.test.js`
const { Game } = require('../engine');
const { buildSnapshot } = require('../snapshot');
const { Room } = require('../room');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name); }
}

// 替真人（0/2）出牌：用 AI 策略算一步，模拟真人点了「出牌」
function playAs(game, seat) {
  let cards = game.aiPlay(seat);
  if (!game.playCards(seat, cards)) {
    cards = game.fallbackPlay(seat);
    if (!game.playCards(seat, cards)) return false;
  }
  return true;
}

// ===== 测试 1：两个真人当对家，引擎能跑完整局 =====
function testMultiHumanFullRound() {
  console.log('测试 1：多真人整局');
  const g = new Game();
  g.humanSeats = new Set([0, 2]);
  g.humanNames = { 0: '妈妈', 2: '阿姨' };
  g.assignNames();
  ok('两个真人名字正确', g.names[0] === '妈妈' && g.names[2] === '阿姨');
  ok('对家不是墩布（联网）', g.names[2] !== '墩布' && g.names[1] !== '墩布');

  g.newGame();
  // 发牌：一次性发完（真人发牌中不亮主，AI 会自动亮）
  let guard = 0;
  while (g.phase === 'dealing' && guard++ < 1000) g.dealNext();
  ok('发牌后进入扣底阶段', g.phase === 'discard');

  // 跑完整局
  guard = 0;
  while (g.phase !== 'roundEnd' && guard++ < 10000) {
    if (g.phase === 'discard') {
      const d = g.dealerSeat;
      if (g.isHuman(d)) g.doDiscard(d, g.aiDiscard(d));
      else g.aiStep();
    } else if (g.phase === 'playing') {
      const seat = g.currentSeat();
      if (g.isHuman(seat)) playAs(g, seat);
      else g.aiStep();
    }
  }
  ok('一整局跑完进入 roundEnd', g.phase === 'roundEnd');
  ok('有结算结果', !!g.result && typeof g.result.summary === 'string');
  ok('没有死循环（guard 没打满）', guard < 10000);
}

// ===== 测试 2：快照信息隐藏 =====
function testSnapshotPrivacy() {
  console.log('测试 2：快照信息隐藏');
  const g = new Game();
  g.humanSeats = new Set([0, 2]);
  g.humanNames = { 0: '妈妈', 2: '阿姨' };
  g.assignNames();
  g.newGame();
  let guard = 0;
  while (g.phase === 'dealing' && guard++ < 1000) g.dealNext();

  const s0 = buildSnapshot(g, 0, { seq: 1 });
  const s2 = buildSnapshot(g, 2, { seq: 2 });

  ok('座位 0 快照 hand 恰是 0 号手牌', JSON.stringify(s0.hand) === JSON.stringify(g.hands[0]));
  ok('座位 2 快照 hand 恰是 2 号手牌', JSON.stringify(s2.hand) === JSON.stringify(g.hands[2]));

  // 强断言：0 号快照里不得出现 2 号/AI 手牌的完整牌内容（只能有张数 handCounts）
  const s0json = JSON.stringify(s0);
  const leak1 = g.hands[1].some(c => s0json.includes(JSON.stringify(c)));
  const leak3 = g.hands[3].some(c => s0json.includes(JSON.stringify(c)));
  const leak2 = g.hands[2].some(c => s0json.includes(JSON.stringify(c)));
  ok('0 号快照不含 AI 手牌内容', !leak1 && !leak3);
  ok('0 号快照不含对家（2 号）手牌内容', !leak2);

  ok('快照里有 handCounts（各家张数）', Array.isArray(s0.handCounts) && s0.handCounts.length === 4);
  ok('快照里有 leadSeat', typeof s0.leadSeat === 'number' || s0.leadSeat === null);
}

// ===== 测试 3：Room 座位分配 + 消息路由 =====
function makeFakeWs(sink) {
  return {
    readyState: 1,
    seat: undefined,
    name: undefined,
    send(str) { sink.push(JSON.parse(str)); },
    close() { this.readyState = 3; },
  };
}

function testRoomSeat() {
  console.log('测试 3：座位分配 + 消息路由');
  const room = new Room();
  const m0 = [], m1 = [];
  const ws0 = makeFakeWs(m0), ws1 = makeFakeWs(m1);
  room.onMessage(ws0, { type: 'join', name: '妈妈' });
  room.onMessage(ws1, { type: 'join', name: '阿姨' });
  room.stop();

  ok('先连的是 0 号', ws0.seat === 0);
  ok('后连的是 2 号', ws1.seat === 2);
  ok('0 号收到 welcome', m0.some(m => m.type === 'welcome' && m.seat === 0));
  ok('2 号收到 welcome', m1.some(m => m.type === 'welcome' && m.seat === 2));

  // 都收到 state 快照，且手牌隔离
  const st0 = m0.filter(m => m.type === 'state');
  const st1 = m1.filter(m => m.type === 'state');
  ok('两人都收到 state', st0.length > 0 && st1.length > 0);
  if (st0.length && st1.length) {
    const last0 = st0[st0.length - 1], last1 = st1[st1.length - 1];
    ok('state 手牌隔离（0 与 2 不同）', JSON.stringify(last0.hand) !== JSON.stringify(last1.hand));
    ok('state 手牌与权威一致', JSON.stringify(last0.hand) === JSON.stringify(room.game.hands[0]));
  }

  // 第三个连接被拒
  const m2 = [];
  const ws2 = makeFakeWs(m2);
  room.onMessage(ws2, { type: 'join', name: '路人' });
  ok('第三个连接收到房间已满', m2.some(m => m.type === 'error'));

  // 同名重连还原座位（旧连接已断开后）
  const m3 = [];
  const ws3 = makeFakeWs(m3);
  ws0.close();   // 模拟妈妈掉线，旧连接断开
  room.onMessage(ws3, { type: 'join', name: '妈妈' });
  ok('同名重连还原到 0 号', ws3.seat === 0);
}

// ===== 测试 3b：两个不同的人撞名（都叫「你」），不互相顶 =====
function testSameNameNoClash() {
  console.log('测试 3b：两个真人撞名不互顶');
  const room = new Room();
  const m0 = [], m2 = [];
  const ws0 = makeFakeWs(m0), ws2 = makeFakeWs(m2);
  room.onMessage(ws0, { type: 'join', name: '你' });
  ok('先连的坐 0 号', ws0.seat === 0);
  // 第二个手机也叫「你」，但第一个连接还活着 → 不顶替，坐 2 号
  room.onMessage(ws2, { type: 'join', name: '你' });
  ok('撞名且旧连接活着：第二个坐 2 号不顶替', ws0.seat === 0 && ws2.seat === 2);
  ok('0 号连接没被顶掉', room.conns[0] === ws0);
  ok('2 号连接正常', room.conns[2] === ws2);
  room.stop();
}

// ===== 测试 4：重新开局需两人都同意 =====
function testRestart() {
  console.log('测试 4：重新开局需两人同意');
  const room = new Room();
  const m0 = [], m2 = [];
  const ws0 = makeFakeWs(m0), ws2 = makeFakeWs(m2);
  room.onMessage(ws0, { type: 'join', name: '妈妈' });
  room.onMessage(ws2, { type: 'join', name: '阿姨' });

  const s0 = m0.filter(m => m.type === 'state').length;
  room.onMessage(ws0, { type: 'restart' });       // 妈妈一个人点
  const s1 = m0.filter(m => m.type === 'state').length;
  ok('一人点重开：不推新局', s1 === s0);
  ok('一人点重开：提示对方等同意', m2.some(m => m.type === 'toast'));

  room.onMessage(ws2, { type: 'restart' });       // 阿姨也点
  const s2 = m0.filter(m => m.type === 'state').length;
  ok('两人都点：推新局 state', s2 > s1);
  room.stop();
}

testMultiHumanFullRound();
testSnapshotPrivacy();
testRoomSeat();
testSameNameNoClash();
testRestart();

console.log('\n服务器测试：通过 ' + pass + ' / 失败 ' + fail);
process.exitCode = fail ? 1 : 0;
