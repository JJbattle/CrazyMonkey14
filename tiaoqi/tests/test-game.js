// test-game.js —— 校验回合状态机、2~6 人布局、悔棋、存档
const Game = require('../js/game.js');
const B = require('../js/board.js');
const AI = require('../js/ai.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

// 1. 2 人默认布局
{
  const g = Game.createGame({ playerCount: 2 });
  ok(g.players.length === 2, '2 名玩家');
  ok(g.players[0].type === 'human', '玩家0 真人');
  ok(g.players[1].type === 'ai', '玩家1 电脑');
  ok(g.players[0].startCamp === 4 && g.players[0].targetCamp === 1, '玩家0 正下(4) 目标正上(1)');
  ok(g.players[1].startCamp === 1 && g.players[1].targetCamp === 4, '玩家1 正上(1) 目标正下(4)');
  ok(g.players[0].pieces.length === 10 && g.players[1].pieces.length === 10, '各 10 子');
  ok(g.board.size === 20, '棋盘 20 子');
  let inCamp = true;
  for (const c of g.players[0].pieces) if (B.campOf(c) !== 4) inCamp = false;
  ok(inCamp, '玩家0 棋子都在营区 4');
}

// 2. 走子流程：选子 -> 单步 -> 轮到电脑
{
  const g = Game.createGame({ playerCount: 2 });
  ok(g.turnState === 'waiting', '初始 waiting');
  const piece = g.players[0].pieces[0];
  const sel = g.select(piece);
  ok(sel.ok === true, '能选中自己的子');
  ok(g.turnState === 'selected', '选中后 selected');
  const t = g.targets();
  ok(t.steps.length > 0, '有单步落点');
  const res = g.doStep(t.steps[0]);
  ok(res.ok === true, '单步成功');
  ok(g.turnState === 'ai' && g.current === 1, '轮到电脑');
}

// 3. AI 走子
{
  const g = Game.createGame({ playerCount: 2 });
  // 让玩家0先走一步，轮到电脑
  const piece = g.players[0].pieces[0];
  g.select(piece);
  g.doStep(g.targets().steps[0]);
  ok(g.current === 1 && g.turnState === 'ai', '轮到电脑');
  const m = AI.chooseMove(g, 1, 'normal');
  ok(m && m.move && m.move.path.length >= 2, 'AI 能算出走法');
  const res = g.applyMove(m.pieceIdx, m.move);
  ok(res.ok === true, 'AI 走法应用成功');
  ok(g.current === 0, 'AI 走完轮到玩家0');
}

// 4. 悔棋：撤销自己刚走的一步
{
  const g = Game.createGame({ playerCount: 2 });
  const piece = g.players[0].pieces[0];
  g.select(piece);
  const to = g.targets().steps[0];
  g.doStep(to);
  ok(g.current === 1, '走完轮到电脑');
  g.undo();
  ok(g.current === 0, '悔棋后回到玩家0');
  ok(g.turnState === 'waiting', '悔棋后 waiting');
  ok(g.players[0].pieces[0].q === piece.q && g.players[0].pieces[0].r === piece.r, '悔棋后棋子回原位');
}

// 5. 存档往返
{
  const g = Game.createGame({ playerCount: 3 });
  const data = g.serialize();
  const g2 = Game.createGame({ playerCount: 3 });
  g2.deserialize(data);
  ok(g2.players[0].pieces.length === 10, '反序列化后仍 10 子');
  ok(g2.board.size === 30, '反序列化后 30 子');
  ok(JSON.stringify(g2.players[0].pieces) === JSON.stringify(g.players[0].pieces), '存档棋子一致');
}

// 6. 6 人布局：6 个营区全用
{
  const g = Game.createGame({ playerCount: 6 });
  ok(g.board.size === 60, '6 人 60 子');
  const camps = g.players.map(p => p.startCamp);
  ok(new Set(camps).size === 6, '6 个不同营区');
}

// 7. 连跳：跳一步进 chain，再跳一步自动结束，正确记录 jumps
{
  const g = Game.createGame({ playerCount: 2 });
  // 摆一个能连跳的局面：玩家0 一子挪到中央 (0,0)，敌子挡在 (1,0) 和 (3,0)
  const from = B.cell(0, 0);
  const old = g.players[0].pieces[0];
  g.board.delete(B.keyOf(old));
  g.board.set(B.keyOf(from), 0);
  g.players[0].pieces[0] = from;
  g.board.set(B.keyOf(B.cell(1, 0)), 1);
  g.board.set(B.keyOf(B.cell(3, 0)), 1);
  const sel = g.select(from);
  ok(sel.ok === true, '连跳：选中');
  const j2 = sel.jumps.find(x => x.q === 2 && x.r === 0);
  ok(!!j2, '连跳：能跳 (2,0)');
  const r1 = g.doJump(j2);
  ok(r1.ok === true && r1.done === false && g.turnState === 'chain', '跳一步进 chain');
  const r2 = g.doJump(B.cell(4, 0));
  ok(r2.ok === true && r2.done === true, '再跳一步自动结束');
  ok(r2.move.jumps === 2, '连跳 2 步记录 jumps=2');
  ok(g.turnState === 'ai' && g.current === 1, '连跳结束轮到电脑');
}

console.log('test-game: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
