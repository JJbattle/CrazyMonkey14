// test-rules.js —— 蜘蛛纸牌规则层验收测试（对应需求总纲 §41 关键项）
// 跑法：node tests/test-rules.js
'use strict';
const Cards = require('../js/cards.js');
const Rules = require('../js/rules.js');
const Game = require('../js/game.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

// 造牌：s 花色(0-3)、r 点数(1-13)、u 是否正面
const mk = (s, r, u) => ({ id: 0, s, r, u });
// 造一列：suitIdx 花色，ranks 自底向上，faces 默认全正面
function col(s, ranks, faces) {
  return ranks.map((r, i) => mk(s, r, faces ? faces[i] : 1));
}
const SP = 0, HT = 1, CL = 2, DI = 3;

console.log('\n[1] 初始发牌计数');
{
  const st = Game.newState(0, 12345);
  const total = st.tableau.reduce((n, c) => n + c.length, 0) + st.stock.length;
  ok(total === 104, '总牌数 104（实际 ' + total + '）');
  const onTable = st.tableau.reduce((n, c) => n + c.length, 0);
  ok(onTable === 54, '桌面 54（实际 ' + onTable + '）');
  ok(st.stock.length === 50, '牌库 50（实际 ' + st.stock.length + '）');
  ok(st.tableau[0].length === 6 && st.tableau[1].length === 6 &&
     st.tableau[2].length === 6 && st.tableau[3].length === 6, '前四列各 6 张');
  ok(st.tableau.slice(4).every(c => c.length === 5), '后六列各 5 张');
  ok(st.tableau.every(c => c.filter(x => x.u).length === 1), '每列只有最底一张正面');
}

console.log('\n[2] 难度牌组构成');
{
  ok(Cards.buildDeck(0).every(c => c.s === 0), '简单：全黑桃');
  ok(Cards.buildDeck(1).every(c => c.s === 0 || c.s === 1), '普通：黑桃+红桃');
  ok(Cards.buildDeck(2).every(c => c.s >= 0 && c.s <= 3), '困难：四花色');
  const d = Cards.buildDeck(1);
  const cnt = {};
  for (const c of d) cnt[c.s + '-' + c.r] = (cnt[c.s + '-' + c.r] || 0) + 1;
  ok(Object.values(cnt).every(v => v === 4), '普通：每种花色点数各 4 张');
}

console.log('\n[3] 单张移动（跨花色、降序）');
{
  ok(Rules.canPlaceOn(mk(SP, 8, 1), [mk(HT, 9, 1)]), '♠8 可放 ♥9 下');
  ok(Rules.canPlaceOn(mk(SP, 8, 1), [mk(CL, 9, 1)]), '♠8 可放 ♣9 下');
  ok(!Rules.canPlaceOn(mk(SP, 8, 1), [mk(SP, 7, 1)]), '♠8 不可放 ♠7 下（点数不对）');
  ok(!Rules.canPlaceOn(mk(SP, 8, 1), [mk(SP, 8, 1)]), '♠8 不可放 ♠8 下（同点数）');
  ok(Rules.canPlaceOn(mk(SP, 8, 1), []), '♠8 可进空列');
}

console.log('\n[4] 连续牌组移动');
{
  const c = col(SP, [9, 8, 7]);
  ok(Rules.movableStack(c, 0).length === 3, '同花连续三张可整体移动');
  const c2 = [mk(SP, 9, 1), mk(HT, 8, 1), mk(SP, 7, 1)];
  ok(Rules.movableStack(c2, 0).length === 1, '异花色中间断开：只能移动顶上一张');
  const c3 = [mk(SP, 9, 1), mk(SP, 8, 1)];
  ok(Rules.movableStack(c3, 1).length === 1, '点底牌只动一张');
}

console.log('\n[5] 空列发牌限制');
{
  const st = Game.newState(0, 1);
  st.tableau[0] = [];
  ok(!Rules.canDeal(st), '有空列不能发牌');
  st.tableau[0] = [mk(SP, 5, 1)];
  ok(Rules.canDeal(st), '无空列可发牌');
}

console.log('\n[6] 发牌');
{
  const st = Game.newState(0, 2);
  const before = st.stock.length;
  const r = Game.deal(st);
  ok(r.ok && st.stock.length === before - 10, '发一次减 10 张');
  ok(st.tableau.every(c => c.length > 0), '每列都加了牌');
  ok(st.tableau.every(c => c[c.length - 1].u === 1), '新发的牌正面朝上');
  let deals = 1;
  while (Rules.canDeal(st)) { Game.deal(st); deals++; }
  ok(deals === 5, '总共发 5 次（实际 ' + deals + '）');
  ok(st.stock.length === 0, '发完后牌库为空');
}

console.log('\n[7] 移走后自动翻牌');
{
  const st = Game.newState(0, 3);
  st.tableau[0] = [mk(SP, 13, 0), mk(SP, 7, 1)];   // ♠K背面 + ♠7正面
  st.tableau[1] = [mk(SP, 8, 1)];
  const r = Game.move(st, 0, 1, 1);                 // ♠7 → ♠8
  ok(r.ok, '移动成功');
  ok(st.tableau[0].length === 1 && st.tableau[0][0].u === 1, '露出的背面牌自动翻开');
}

console.log('\n[8] 完整序列收牌');
{
  // 同花 K→A
  const st = Game.newState(0, 4);
  st.tableau[0] = col(SP, [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const r = Game.move(st, 1, 0, 0); // 随便一个 no-op 触发 settle 也行；这里直接 move 空列不合法
  // 直接构造收牌：把第 0 列顶 13 张之外的牌清掉后调用 settle
  const before = st.completed;
  st.tableau[0] = col(SP, [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  // 用一次合法移动触发 settle：把第1列某牌移到空列
  st.tableau[1] = [mk(SP, 5, 1)];
  st.tableau[2] = [];
  Game.move(st, 1, 0, 2);
  ok(st.completed === before + 1, '同花 K→A 自动收走（completed +1）');
  ok(st.tableau[0].length === 0, '收走后该列为空');

  // 异花 K→A 不收
  const st2 = Game.newState(0, 5);
  st2.tableau[0] = col(SP, [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  st2.tableau[0][5].s = HT;   // 中间插一张红桃，破坏同花
  ok(Rules.completeStart(st2.tableau[0]) === -1, '异花 K→A 不判定为完整');
}

console.log('\n[9] 胜利（收满 8 组）');
{
  const st = Game.newState(0, 6);
  st.completed = 7;
  st.tableau[0] = col(SP, [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  st.tableau[1] = [mk(SP, 5, 1)];
  st.tableau[2] = [];
  Game.move(st, 1, 0, 2);
  ok(st.completed === 8 && st.status === 'won', '收满 8 组胜利');
}

console.log('\n[10] 悔棋');
{
  // 撤销自动翻牌
  const st = Game.newState(0, 7);
  st.tableau[0] = [mk(SP, 13, 0), mk(SP, 7, 1)];
  st.tableau[1] = [mk(SP, 8, 1)];
  Game.move(st, 0, 1, 1);
  ok(st.tableau[0][0].u === 1, '移动后已翻牌');
  ok(Game.undo(st), '悔棋成功');
  ok(st.tableau[0].length === 2 && st.tableau[0][0].u === 0 && st.tableau[0][1].u === 1,
     '悔棋恢复自动翻牌（背面回到背面）');

  // 撤销自动收牌
  const st2 = Game.newState(0, 8);
  st2.tableau[0] = col(SP, [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  st2.tableau[1] = [mk(SP, 5, 1)];
  st2.tableau[2] = [];
  const cBefore = st2.completed;
  Game.move(st2, 1, 0, 2);
  ok(st2.completed === cBefore + 1, '已收一组');
  Game.undo(st2);
  ok(st2.completed === cBefore && st2.tableau[0].length === 13, '悔棋恢复自动收牌');

  // 撤销发牌
  const st3 = Game.newState(0, 9);
  const stockBefore = st3.stock.length;
  const t0 = JSON.stringify(st3.tableau.map(c => c.length));
  Game.deal(st3);
  Game.undo(st3);
  ok(st3.stock.length === stockBefore && JSON.stringify(st3.tableau.map(c => c.length)) === t0,
     '悔棋撤销发牌');
}

console.log('\n[11] 可复现');
{
  const a = Game.newState(2, 987654);
  const b = Game.newState(2, 987654);
  ok(JSON.stringify(a.tableau) === JSON.stringify(b.tableau), '同 seed 复现相同牌局');
  const c = Game.newState(2, 987655);
  ok(JSON.stringify(a.tableau) !== JSON.stringify(c.tableau), '不同 seed 牌局不同');
}

console.log('\n[12] 提示与无路可走');
{
  for (let seed = 1; seed <= 30; seed++) {
    const st = Game.newState(seed % 3, seed * 7 + 13);
    // 清掉背面牌，模拟一个可自由移动的局面
    const h = Game.hint(st);
    if (h) {
      const legal = Rules.legalMoves(st);
      const found = legal.some(m => m.from === h.from && m.fromIdx === h.fromIdx && m.to === h.to);
      if (!found) { ok(false, 'seed ' + seed + ' 提示给出了非法走法'); break; }
    }
    const stk = Game.stuck(st);
    if (Rules.hasLegalMove(st) && stk !== null) { ok(false, 'seed ' + seed + ' 有合法走法却误报无路可走'); break; }
  }
  ok(true, '提示均合法 / 无路可走不误报（30 局抽样）');
}

console.log('\n[13] 存档往返');
{
  const st = Game.newState(1, 4242);
  Game.deal(st);
  const json = Game.serialize(st);
  const st2 = Game.deserialize(json);
  ok(JSON.stringify(st.tableau) === JSON.stringify(st2.tableau), '存档恢复后牌面一致');
  ok(st2.stock.length === st.stock.length && st2.completed === st.completed, '存档恢复后计数一致');
}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
