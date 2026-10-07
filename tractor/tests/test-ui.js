// 无浏览器环境下的界面冒烟测试：用假 DOM + 假计时器把 ui.js 整局跑通
const fs = require('fs');
const base = __dirname + '/../js/';

// ---------- 假 DOM ----------
// className 和 classList 在这套装置里是同一份数据（真浏览器里也是），
// 两边随便动哪个，另一个立刻跟着变。
function makeEl(tag) {
  const el = {
    tagName: tag || 'div', children: [], disabled: false, title: '',
    dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, scrollTop: 0, scrollHeight: 0,
    _text: '', _html: '', _cn: '',
    appendChild(c) { this.children.push(c); return c; },
    // 把监听收下来，测试里就能 `el._click()` 真的把按钮按一下
    addEventListener(ev, fn) { (this._on = this._on || {})[ev] = fn; },
    _click() { if (this._on && this._on.click) return this._on.click(); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
  };
  const sync = () => { el._cn = Array.from(el.classList._s).join(' '); };
  el.classList = {
    _s: new Set(),
    add(...cs) { for (const c of cs) this._s.add(c); sync(); },
    remove(...cs) { for (const c of cs) this._s.delete(c); sync(); },
    contains(c) { return this._s.has(c); },
    toggle(c, v) { if (v === undefined) v = !this._s.has(c); v ? this._s.add(c) : this._s.delete(c); sync(); },
  };
  Object.defineProperty(el, 'className', {
    get() { return el._cn; },
    set(v) { el._cn = String(v); el.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  return el;
}

const els = {};
global.document = {
  getElementById(id) { return (els[id] = els[id] || makeEl('div')); },
  createElement(tag) { return makeEl(tag); },
};

// ---------- 假计时器 ----------
let vnow = 0, tid = 0, timers = [];
global.setTimeout = (fn, ms) => { const t = { id: ++tid, at: vnow + (ms || 0), fn, rep: 0 }; timers.push(t); return t.id; };
global.setInterval = (fn, ms) => { const t = { id: ++tid, at: vnow + (ms || 1), fn, rep: ms || 1 }; timers.push(t); return t.id; };
global.clearTimeout = id => { timers = timers.filter(t => t.id !== id); };
global.clearInterval = global.clearTimeout;
function pumpOne() {
  if (!timers.length) return false;
  timers.sort((a, b) => a.at - b.at || a.id - b.id);
  const t = timers[0];
  vnow = t.at;
  if (t.rep) t.at = vnow + t.rep; else timers.splice(0, 1);
  t.fn();
  return true;
}

const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n'
          + fs.readFileSync(base + 'game.js', 'utf8') + '\n'
          + fs.readFileSync(base + 'ui.js', 'utf8');

const test = `
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('✗ ' + name + (extra ? '  ' + extra : '')); } }

let UID = 0;
const C = (suit, rank) => ({ uid: 'u' + (UID++), suit, rank });

// ui.js 载入后只显示菜单，不再自动开局——测试里显式选单机模式
startSolo();

// ---------- 1) 三家只摆一叠卡背 ----------
{
  let dg = 0;
  while (game.phase === 'dealing' && dg++ < 500) dealStep();
  ok('发牌能走完', game.phase !== 'dealing', 'phase=' + game.phase);
  const top = els['cards-top'];
  ok('对家座位渲染出来了', top.children.length >= 1);
  const stack = top.children.find(c => c.className === 'card-stack');
  ok('对家是一叠卡背（3 张叠在一起，不是一整列）', !!stack && stack.children.length === 3,
     stack ? String(stack.children.length) : 'no stack');
  if (game.phase === 'discard' && game.dealerSeat === game.humanSeat) {
    ok('轮到自己扣底时按钮区有按钮', els['actions'].children.length > 0);
  }
}

// ---------- 2) 无限循环：连打 25 轮都不卡（玩家动作也走界面函数） ----------
{
  const WANT = 25;
  let guard = 0, rounds = 0, err = null, pauses = 0, bubbles = 0, resumes = 0;
  const origHold = holdTrick;
  holdTrick = function () { pauses++; return origHold(); };
  try {
    while (guard++ < 600000) {
      if (rounds >= WANT) break;
      // 一圈打完会停在这儿等玩家点「下一轮」——测试里就替他点
      if (waitingNext) { nextTrick(); continue; }
      if (!pumpOne()) {
        if (game.phase === 'dealing') {
          // 发牌停下来了＝在等玩家决定亮不亮主 / 要不要加保 —— 测试里替他点「继续发牌」
          resumes++;
          resumeDealing();
        } else if (game.phase === 'discard' && game.dealerSeat === game.humanSeat) {
          selected = new Set(game.aiDiscard(game.humanSeat).map(c => c.uid));
          doDiscard();
        } else if (game.phase === 'playing' && game.currentSeat() === game.humanSeat) {
          selected = new Set(game.aiPlay(game.humanSeat).map(c => c.uid));
          doPlay();
        } else if (game.phase === 'roundEnd') {
          rounds++;
          if (game.taunts && Object.keys(game.taunts).length) bubbles++;
          game.nextRound();
          beginRound();
        } else {
          break; // 卡住了
        }
      }
    }
  } catch (e) { err = e; }
  holdTrick = origHold;

  ok('界面逻辑连打 25 轮无异常', !err && rounds >= WANT, (err ? err.message + '\\n' + err.stack : '轮数=' + rounds));
  ok('游戏不会结束（无限循环，没有终局）', game.phase !== 'gameEnd', 'phase=' + game.phase);
  ok('每圈打完都会停下来等玩家点「下一轮」', pauses >= rounds, '停牌次数=' + pauses + ' / 局数 ' + rounds);
  ok('每局结束都有人说话', bubbles === rounds, '有台词的局=' + bubbles + '/' + rounds);
  ok('发牌中途会停下来问玩家叫不叫主（不是一路发到底）',
     resumes >= Math.floor(rounds * 0.5), '停发次数=' + resumes + ' / 局数 ' + rounds);
}

// ---------- 3) 布局：牌堆区中间的得分牌 / 手牌占下方 40% ----------
{
  render();
  const trick = els['trick'];
  const pile = trick.children.find(c => c.className === 'pile-info');
  ok('出牌区中间有「本局得分」牌堆信息', !!pile, 'trick 子元素=' + trick.children.length);
  if (pile) {
    const big = pile.children.find(c => c.className === 'big');
    ok('得分牌上写着闲家得分', !!big && /闲家\\s*\\d+\\s*\\/\\s*80/.test(big.textContent),
       big ? big.textContent : 'null');
  }
  ok('对家气泡元素存在', !!els['bubble-2']);

  // 头像框 + 名字
  const av2 = els['avatar-2'];
  ok('对家头像框里是猫照（墩布配了 AVATARS）',
     av2.children.length === 1 && String(av2.children[0].src).indexOf('cat') >= 0,
     av2.children.length ? String(av2.children[0].src) : '无内容');
  ok('对家座位上写着「墩布」', els['name-2'].textContent === '墩布', els['name-2'].textContent);
  // 真人座位就是自己的名字，不参与随机取名
  ok('自己座位上写着「你」', els['name-0'].textContent === '你', els['name-0'].textContent);
  ok('陪玩的名字都来自名册，没人叫什么「你」',
     PLAYER_POOL.indexOf(els['name-1'].textContent) >= 0 &&
     PLAYER_POOL.indexOf(els['name-3'].textContent) >= 0,
     els['name-1'].textContent + ' / ' + els['name-3'].textContent);
  ok('没配头像的人用名字第一个字', els['avatar-1'].textContent.length === 1 ||
     els['avatar-1'].children.length === 1, els['avatar-1'].textContent);
  ok('战报栏有 side-now', typeof els['side-now'].textContent === 'string');
  ok('日志里有内容', els['log'].children.length > 0, String(els['log'].children.length));
  ok('有表扬横幅元素', !!els['banner']);
}

// ---------- 4) 绕完一整圈（打到王）→ 弹表扬，游戏继续 ----------
{
  const g2 = new Game();
  g2.humanSeat = 0; g2.newGame();
  g2.dealerTeam = 0; g2.dealerSeat = 0; g2.levels = [15, 3];
  g2.roundPoints = 60; g2.bottomCards = [];
  g2.leadSeat = 0; g2.lastTrick = null;
  g2.phase = 'playing';
  g2.finishRound();
  ok('打到王之后游戏不结束', g2.phase === 'roundEnd' && !g2.winner, 'phase=' + g2.phase);
  ok('表扬里有夸奖', /厉害|不错|好/.test(g2.result.summary), g2.result.summary);
  ok('等级回到 2 重新绕', g2.levels[0] === 2, 'levels[0]=' + g2.levels[0]);
}

// ---------- 5) 手牌布局：所有的牌都要同时看得见，不滚动 ----------
// 独立算一遍行数，用来验证 planHandLayout 的结果确实塞得下
function rowsOf(groups, cardW, ov, W) {
  let rows = 1, cur = 0;
  for (const g of groups) {
    const gw = cardW + (g.n - 1) * (cardW + ov);
    if (cur > 0 && cur + HAND_GAP + gw > W) { rows++; cur = gw; }
    else cur += (cur > 0 ? HAND_GAP : 0) + gw;
  }
  return rows;
}

// 检查一次布局：塞得下、露脸够宽、而且是「刚好够用」不用叠得更狠
function checkPlan(groups, aw, ah, tag) {
  const p = planHandLayout(groups, aw, ah);
  const W = aw - HAND_PAD, H = ah - HAND_PAD;
  const maxRows = Math.max(1, Math.floor((H + HAND_ROW_GAP) / (p.cardH + HAND_ROW_GAP)));
  const rows = rowsOf(groups, p.cardW, p.ov, W);
  ok(tag + '：行数没超出手牌区高度', rows <= maxRows, rows + ' 行 > 上限 ' + maxRows);
  ok(tag + '：返回的行数跟实际摆出来的一致', p.rows === rows, p.rows + ' vs ' + rows);
  ok(tag + '：最紧时也留得下看得清的点数', p.cardW + p.ov >= HAND_MIN_FACE,
     '只露 ' + (p.cardW + p.ov) + 'px');
  if (p.ov < 0) {
    ok(tag + '：不会白白叠得更紧（松一点就放不下了）',
       rowsOf(groups, p.cardW, p.ov + 1, W) > maxRows, 'ov=' + p.ov);
  }
  ok(tag + '：牌面大小跟 CSS 基准一致', p.cardW <= HAND_CARD_W && p.cardH <= HAND_CARD_H);
  return p;
}

{
  const full = [{ n: 8 }, { n: 6 }, { n: 6 }, { n: 5 }];   // 25 张，主 + 三门副牌

  // 横屏手机：手牌区大约 900 宽、130 高（横跨整个屏幕宽度）
  const p = checkPlan(full, 900, 130, '25 张 / 900x130');
  ok('25 张在手机上一行就摆得下（不用滚动）', p.rows === 1 && p.fits,
     p.rows + ' 行 fits=' + p.fits);
  ok('25 张不需要缩牌', p.scale === 1, 'scale=' + p.scale);

  // 牌少的时候不该叠
  const few = checkPlan([{ n: 4 }, { n: 3 }, { n: 2 }], 900, 130, '9 张 / 900x130');
  ok('牌少的时候完全不叠', few.ov === 0, 'ov=' + few.ov);

  // 手牌区又矮又窄：允许换行或缩牌，但必须 fits
  for (const [w, h] of [[900, 130], [900, 200], [640, 160], [480, 150], [900, 90]]) {
    const r = planHandLayout(full, w, h);
    const W = w - HAND_PAD, H = h - HAND_PAD;
    const maxRows = Math.max(1, Math.floor((H + HAND_ROW_GAP) / (r.cardH + HAND_ROW_GAP)));
    ok('25 张 / ' + w + 'x' + h + '：摆出来的行数不超上限',
       rowsOf(full, r.cardW, r.ov, W) <= maxRows,
       rowsOf(full, r.cardW, r.ov, W) + ' > ' + maxRows);
    ok('25 张 / ' + w + 'x' + h + '：牌面没超出基准', r.cardW <= HAND_CARD_W);
  }

  // 选中的牌**不再**在右边留缝、也不再占额外宽度：
  // 现在改成让它被右边那张压住（CSS 靠 z-index 0 统一层 + 文档顺序），
  // 所以布局上它跟没选中时一模一样，牌不会因为选一下就跳来跳去
  const sel = planHandLayout([{ n: 4 }, { n: 4 }], 900, 130);
  const noSel = planHandLayout([{ n: 4 }, { n: 4 }], 900, 130);
  ok('选中牌不再改变布局（不会把旁边的牌挤走）',
     sel.cardW === noSel.cardW && sel.ov === noSel.ov && sel.rows === noSel.rows,
     '选中 ' + sel.ov + ' vs 没选 ' + noSel.ov);

  // renderHand 要真的把尺寸写到 CSS 变量上
  // 先摆一手确定的手牌：主牌（红桃）8 张 + 黑桃 6 + 方片 6 + 梅花 5 = 25 张
  game.humanSeat = 0;
  game.trumpSuit = 'H'; game.levelRank = 2;
  const deal = [];
  for (let r = 3; r <= 10; r++) deal.push(C('H', r));
  for (let r = 3; r <= 8; r++) deal.push(C('S', r));
  for (let r = 3; r <= 8; r++) deal.push(C('D', r));
  for (let r = 3; r <= 7; r++) deal.push(C('C', r));
  game.hands[0] = deal;
  selected.clear();

  els['hand'].clientWidth = 900;
  els['hand'].clientHeight = 130;
  renderHand();
  ok('renderHand 把牌面大小写进了 --cw / --ch',
     els['hand'].style['--cw'] === p.cardW + 'px' && els['hand'].style['--ch'] === p.cardH + 'px',
     els['hand'].style['--cw'] + ' ' + els['hand'].style['--ch']);
  ok('renderHand 把重叠量写进了 --ov', els['hand'].style['--ov'] === p.ov + 'px',
     els['hand'].style['--ov']);
  ok('字号跟着牌面走，不会小到看不清',
     parseFloat(els['hand'].style['--cf']) >= 13 && parseFloat(els['hand'].style['--cs']) >= 12,
     els['hand'].style['--cf'] + ' / ' + els['hand'].style['--cs']);
  ok('手牌按花色分成 4 组（主牌在最前）', els['hand'].children.length === 4,
     '组数 ' + els['hand'].children.length);
  ok('每一组都是 suit-group，主牌那组另外标了 trump-group',
     els['hand'].children.every(g => String(g.className).indexOf('suit-group') >= 0) &&
     String(els['hand'].children[0].className).indexOf('trump-group') >= 0,
     String(els['hand'].children[0].className));
  ok('25 张全都摆出来了，一张没漏',
     els['hand'].children.reduce((a, g) => a + g.children.length, 0) === 25,
     '摆出 ' + els['hand'].children.reduce((a, g) => a + g.children.length, 0) + ' 张');
}

// ---------- 6) 出牌小动画：领出甩牌/拖拉机、或者把桌上的压过去 ----------
{
  game.trumpSuit = 'H'; game.levelRank = 2;    // 红桃是将牌（这套假牌用字母当花色）
  const one = (cards, seat) => [{ seat: seat == null ? 1 : seat, cards }];

  // 拖拉机：黑桃 3 3 4 4（非主，相邻两对）
  const tractor = [C('S', 3), C('S', 3), C('S', 4), C('S', 4)];
  const fxT = handFlourish(one(tractor), 0);
  ok('领出的拖拉机认得出来', !!fxT && /拖拉机/.test(fxT.label), fxT ? fxT.label : 'null');

  // 一次甩 6 张
  const throw6 = [C('S', 3), C('S', 5), C('S', 7), C('S', 9), C('S', 11), C('S', 13)];
  const fx6 = handFlourish(one(throw6), 0);
  ok('领出的甩牌报张数', !!fx6 && /甩 6 张/.test(fx6.label), fx6 ? fx6.label : 'null');

  // 领出单张：没什么好喊的
  ok('领出单张不亮招牌', handFlourish(one([C('S', 3)]), 0) === null);

  // ★ 跟牌的不许喊「甩牌」——这是原先的毛病：
  //   只看张数的话，一出甩牌四家全弹「甩 8 张！」，被迫凑数的那些看着莫名其妙
  const follow6 = [C('S', 4), C('S', 6), C('S', 8), C('S', 10), C('S', 12), C('S', 14)];
  const quad = [
    { seat: 0, cards: throw6 }, { seat: 1, cards: follow6 },
    { seat: 2, cards: follow6.map(c => ({ ...c, uid: c.uid + 900 })) },
    { seat: 3, cards: follow6.map(c => ({ ...c, uid: c.uid + 800 })) },
  ];
  ok('跟牌的那几家一个都不亮招牌',
     [1, 2, 3].every(i => handFlourish(quad, i) === null),
     [1, 2, 3].map(i => JSON.stringify(handFlourish(quad, i))).join(' '));
  ok('领出的那家照样喊「甩 6 张！」', /甩 6 张/.test(handFlourish(quad, 0).label));

  // 将吃甩牌：整手主牌、牌型对得上 → 喊「大过你！」
  const ruff6 = [C('H', 3), C('H', 5), C('H', 7), C('H', 9), C('H', 11), C('H', 13)];
  const throwU = [{ seat: 0, cards: throw6 }, { seat: 1, cards: ruff6 }];
  ok('用主牌同牌型毙掉甩牌 → 喊「大过你！」',
     handFlourish(throwU, 1) && handFlourish(throwU, 1).label === '大过你！',
     JSON.stringify(handFlourish(throwU, 1)));

  // ★ 同门压过**不喊**：领出 ♠K♠K，下家 ♠A♠A 压住。
  //   副牌之间你来我往是家常便饭，跟牌本来就该尽量管住，
  //   喊一句「大过你！」反倒像在咋呼
  //   （用户原话：「打个副牌红桃9和红桃10，俩人有啥可横的」）
  const pk = [C('S', 13), C('S', 13)];
  const pa = [C('S', 14), C('S', 14)];
  const beat = [{ seat: 0, cards: pk }, { seat: 1, cards: pa }];
  ok('同门更大的对子压过去 → 不亮招牌',
     handFlourish(beat, 1) === null,
     JSON.stringify(handFlourish(beat, 1)));

  // 单张同理：副牌 ♠9 被 ♠10 压过，一声不吭（用户举的「红桃9 和红桃10」就是这个情形）
  const s9 = [C('S', 9)], s10 = [C('S', 10)];
  const sBeat = [{ seat: 0, cards: s9 }, { seat: 1, cards: s10 }];
  ok('副牌单张同门压过 → 不亮招牌',
     handFlourish(sBeat, 1) === null,
     JSON.stringify(handFlourish(sBeat, 1)));

  // 同门但更小 → 也不喊
  const p3 = [C('S', 3), C('S', 3)];
  ok('同门但压不过 → 不亮招牌',
     handFlourish([{ seat: 0, cards: pk }, { seat: 1, cards: p3 }], 1) === null);

  // 拿主牌毙掉普通对子 → 「大过你！」
  const ph = [C('H', 3), C('H', 3)];
  ok('主牌毙掉普通对子 → 喊「大过你！」',
     handFlourish([{ seat: 0, cards: pk }, { seat: 1, cards: ph }], 1).label === '大过你！');

  // ★ 主牌压主牌**不喊**：你出 ♥5、下家 ♥K 压过。以前这种也弹「大过你！」，
  //   一巡能弹三下，满屏都是，而且主牌谁大谁赢本来就是常事
  const th5 = [C('H', 5)], thk = [C('H', 13)];
  ok('主牌领出、被更大的主牌压过 → 不亮招牌',
     handFlourish([{ seat: 0, cards: th5 }, { seat: 1, cards: thk }], 1) === null,
     JSON.stringify(handFlourish([{ seat: 0, cards: th5 }, { seat: 1, cards: thk }], 1)));

  // ★ 王盖过前面的人 → 「金墩布！」「银墩布！」（大小王画的就是家里那只猫）
  const bigJ = [C('X', 17)], smallJ = [C('X', 16)];
  ok('大王盖过领出的副牌 → 喊「金墩布！」',
     handFlourish([{ seat: 0, cards: [C('S', 5)] }, { seat: 1, cards: bigJ }], 1).label === '金墩布！');
  ok('小王盖过领出的副牌 → 喊「银墩布！」',
     handFlourish([{ seat: 0, cards: [C('S', 5)] }, { seat: 1, cards: smallJ }], 1).label === '银墩布！');
  ok('主牌领出被王压过照样喊（王不分主副，都是高光）',
     handFlourish([{ seat: 0, cards: th5 }, { seat: 1, cards: bigJ }], 1).label === '金墩布！');
  const jokers = [{ seat: 0, cards: th5 }, { seat: 1, cards: smallJ }, { seat: 2, cards: bigJ }];
  ok('小王先压过去喊银的', handFlourish(jokers, 1).label === '银墩布！');
  ok('大王再压过去喊金的', handFlourish(jokers, 2).label === '金墩布！');
  ok('王压不过人家（小王后面跟大王之后没赢）就不喊',
     handFlourish(jokers.concat([{ seat: 3, cards: [C('H', 4)] }]), 3) === null);

  // 真的画到出牌区上
  const box = document.createElement('div');
  renderTrickPlays(box, one(throw6), null, true);
  ok('甩牌那手被标了 flourish', box.children[0].classList.contains('flourish'));
  ok('角上弹出了提示', els['flourish'].textContent === fx6.label, els['flourish'].textContent);
  ok('提示动画真的开起来了', els['flourish'].classList.contains('on'));
  ok('牌是一张张蹦出来的（有错开的延迟）',
     box.children[0].children[0].children[0].style.animationDelay === '0ms' &&
     box.children[0].children[0].children[1].style.animationDelay === '70ms',
     String(box.children[0].children[0].children[1].style.animationDelay));

  // 整圈重画：金边要一直挂着（下一家一出牌就掉的话，等于白标了），
  // 但动画只弹一次，不重播
  els['flourish'].classList.remove('on');
  const box2 = document.createElement('div');
  renderTrickPlays(box2, one(throw6), null, true);
  ok('整圈重画时金边还在', box2.children[0].classList.contains('flourish'));
  ok('但提示动画不重播', !els['flourish'].classList.contains('on'));

  // 回看上一圈时不放动画
  const box3 = document.createElement('div');
  const t3 = [C('H', 3), C('H', 3), C('H', 4), C('H', 4)];
  renderTrickPlays(box3, [{ seat: 2, cards: t3 }], null, false);
  ok('回看上一圈时不放动画', !box3.children[0].classList.contains('flourish'));

  // 新的一局要重新开始算
  flourishShown.add('x');
  beginRound();
  ok('新一局会把动画记录清空', flourishShown.size === 0, '还剩 ' + flourishShown.size);
  const box4 = document.createElement('div');
  els['flourish'].classList.remove('on');
  renderTrickPlays(box4, one(throw6), null, true);
  ok('新一局里同样的牌能重新放动画', box4.children[0].classList.contains('flourish'));
}

// ---------- 7) 一圈打完停下来，等玩家自己点「下一轮」 ----------
{
  game.trumpSuit = 'H'; game.levelRank = 2;
  const hand = s => [C('S', 5 + s), C('S', 6 + s)];

  // 摆一个「四家都出完了」的局面
  game.phase = 'playing';
  game.currentTrick = [];
  game.lastTrick = {
    plays: [{ seat: 0, cards: hand(0) }, { seat: 1, cards: hand(1) },
            { seat: 2, cards: hand(2) }, { seat: 3, cards: hand(3) }],
    winner: 2, points: 15,
  };
  shownTrick = null; waitingNext = false; viewLast = false;

  ok('认得出「这一圈刚打完」', trickJustEnded());

  scheduleAi();
  ok('打完一圈后停下来等玩家', waitingNext === true);
  ok('停下时把这一圈摆在桌上给他看', viewLast === true);
  ok('记下了是哪一圈，不会再重复停', shownTrick === game.lastTrick);

  // 停住之后，怎么叫都不往下走
  const beforeTrick = game.currentTrick.length;
  const beforeSeat = game.currentSeat();
  scheduleAi(); scheduleAi(); scheduleAi();
  ok('玩家不点，牌桌就一直停着不动',
     waitingNext === true && game.currentTrick.length === beforeTrick &&
     game.currentSeat() === beforeSeat, 'phase=' + game.phase);

  // 这时只该给「下一轮」，绝不能再给「出牌」
  render();
  const btns = els['actions'].children;
  ok('等待时只给一个「下一轮」按钮',
     btns.filter(c => c.tagName === 'button').length === 1 &&
     btns[0].textContent === '下一轮 ▶', JSON.stringify(btns.map(c => c.textContent)));
  ok('等待时不会出现「出牌」按钮（防止误点）',
     !btns.some(c => c.textContent === '出牌'));
  const sum = btns.find(c => c.className === 'trick-summary');
  ok('旁边说明这一圈谁最大、拿了多少分',
     !!sum && sum.textContent.indexOf(game.pname(2)) >= 0 && sum.textContent.indexOf('15') >= 0,
     sum ? sum.textContent : 'null');
  ok('提示语说的是「打完了」，不是「轮到谁出牌」',
     els['status'].textContent.indexOf('打完了') >= 0 &&
     els['status'].textContent.indexOf('轮到') < 0, els['status'].textContent);

  // 点下去才继续
  nextTrick();
  ok('点了「下一轮」才继续', waitingNext === false && viewLast === false);
}

// ---------- 8) 桌上谁最大 ----------
{
  game.trumpSuit = 'H'; game.levelRank = 2;
  // 黑桃 A 压黑桃 3
  const t1 = [{ seat: 0, cards: [C('S', 14)] }, { seat: 1, cards: [C('S', 3)] }];
  ok('同花色比大小：A 压 3', trickLeader(t1) === 0, '算出来是 ' + trickLeader(t1));
  // 主牌（红桃）毙掉副牌黑桃
  const t2 = [{ seat: 0, cards: [C('S', 14)] }, { seat: 1, cards: [C('H', 3)] }];
  ok('主牌能毙掉副牌', trickLeader(t2) === 1, '算出来是 ' + trickLeader(t2));
  // 只有一手牌时，那就是最大
  ok('桌上只有一手牌时它就是最大', trickLeader([{ seat: 3, cards: [C('S', 3)] }]) === 3);
  ok('桌上没牌时没有最大', trickLeader([]) === null);

  // 画到界面上：「最大」牌子挂在正确的那一家
  const box = document.createElement('div');
  renderTrickPlays(box, t1, trickLeader(t1), false);
  const top = box.children.find(c => c.classList.contains('winner'));
  ok('最大那一手被标了出来', !!top && top.dataset.seat === 0);
  ok('它旁边挂着「最大」牌子',
     top.children[0].className === 'tag-top' && top.children[0].textContent === '最大',
     top.children[0].className + '/' + top.children[0].textContent);
  // 出的牌**不写名字**：谁出的看方位就够了（上=对家、左=上家、右=下家、下=自己），
  // 名字写在那儿只会把牌挤小
  ok('出的牌上不再写名字',
     !box.children.some(c => c.children.some(k => k.className === 'trick-seat')),
     '有 ' + box.children.length + ' 手牌');
  ok('只有「最大」那家带牌子，别人那儿只有牌',
     top.children.length === 2 &&
     box.children.find(c => c.dataset.seat === 1).children.length === 1,
     top.children.length + '/' + box.children.find(c => c.dataset.seat === 1).children.length);
  ok('不是最大的那家没有牌子',
     !box.children.find(c => c.dataset.seat === 1).classList.contains('winner'));

  // 桌上只有一手牌时不标（还没得比）
  const box1 = document.createElement('div');
  renderTrickPlays(box1, [t1[0]], trickLeader([t1[0]]), false);
  ok('只出了一手牌时不标「最大」', !box1.children[0].classList.contains('winner'));

  // 每一手普通出牌也要有蹦出动画
  const same = [C('S', 7), C('S', 8)];
  const box2 = document.createElement('div');
  renderTrickPlays(box2, [{ seat: 1, cards: same }], null, true);
  ok('普通出牌也逐张蹦出来', box2.children[0].classList.contains('pop'));
  const box3 = document.createElement('div');
  renderTrickPlays(box3, [{ seat: 1, cards: same }], null, true);
  ok('同一手重画不会再蹦一次（选牌时不会满屏乱蹦）',
     !box3.children[0].classList.contains('pop'));
}

// ---------- 8b) 出牌区的牌能摆多大 ----------
// 基准**跟手牌一样大**（52×74）。以前写死 30×43，比手牌小一大截，老人看不清。
// 一圈就一两张时该摆满，一甩十几张时得自己缩回去，不许挤出牌桌。
{
  // 牌桌给足地方：就该跟手牌一样大（52×74）
  const full = planTrickCards([1, 1, 1], 700, 230);
  ok('地方够时，出牌区的牌跟手牌一样大',
     full.cardW === 52 && full.cardH === 74, JSON.stringify(full));

  // 横屏手机上的真实尺寸（量过是 700×160）：高度只够三行各 52，
  // 但这也已经比过去写死的 30×43 大一圈了
  const real = planTrickCards([1, 1, 1], 700, 160);
  ok('横屏手机上缩到 36×52',
     real.cardW === 36 && real.cardH === 52, JSON.stringify(real));
  ok('缩出来的尺寸确实放得下（三行 + 行距）',
     real.cardH + Math.max(real.cardH, 50) + real.cardH + 1 <= 160,
     String(real.cardH * 3 + 51));

  // 三列都摊开、牌桌又不够宽：宽度这边也得管住，别顶出去
  const wide = planTrickCards([3, 3, 3], 500, 230);
  ok('三列都摊开时按宽度缩，不顶出牌桌',
     wide.cardW < 52 && 3 * (3 * wide.cardW + 2 * 3) + 2 * 6 + 40 <= 500,
     JSON.stringify(wide));

  // 牌桌矮的时候按高度缩：三行，中间那行还夹着得分牌
  const shallow = planTrickCards([1, 1, 1], 700, 130);
  ok('牌桌矮就按高度缩',
     shallow.cardH < 74 && shallow.cardH + 50 + shallow.cardH + 1 <= 130,
     JSON.stringify(shallow));

  // 再挤也得给个能看的尺寸，不能算出 0 或者负数
  const worst = planTrickCards([8, 8, 8], 300, 100);
  ok('挤到极点也给得出一个能看的尺寸',
     worst.cardW > 0 && worst.cardH > 0, JSON.stringify(worst));

  // 一圈还没出牌时不会调它，真调了也不能崩
  ok('桌上没牌时也返回一个尺寸',
     planTrickCards([0, 0, 0], 700, 160).cardH === 52);
  // 量不到大小时走兜底（测试环境、或者还没布局完）
  ok('量不到大小时用横屏手机的兜底尺寸',
     planTrickCards([1, 1, 1]).cardW === 36);
}

// ---------- 8c) 出牌区每一手归到哪一列 ----------
// 上家在左(0)、下家在右(2)、你和对家在中间(1)；
// 唯独对家（顶部那家）出的牌特别多（≥6 张）时算到「右」这一档(2)，
// 在 css 里从居中往右伸半截，别在中间列往左伸、挤着左上角的提示条和上家。
{
  const p = (seat, n) => ({ seat, cards: new Array(n).fill(null) });
  ok('上家（座位3）归左列', trickCol(p(3, 1)) === 0);
  ok('下家（座位1）归右列', trickCol(p(1, 1)) === 2);
  ok('你（座位0）归中间列', trickCol(p(0, 1)) === 1);
  ok('对家（座位2）几张牌归中间列', trickCol(p(2, 3)) === 1);
  ok('对家牌特别多（≥6）从居中往右伸', trickCol(p(2, 8)) === 2);
  ok('对家恰好 6 张也从居中往右伸', trickCol(p(2, 6)) === 2);
  ok('对家 5 张还在中间列', trickCol(p(2, 5)) === 1);
}

// ---------- 9) 战报栏默认收起，点开才挤牌桌 ----------
{
  ok('默认是收起的', sideFolded === true);
  applySideFold();
  ok('收起时挂上 folded', els['side'].classList.contains('folded'));
  ok('收起时按钮写着「战报 ▸」', els['side-toggle'].textContent === '战报 ▸',
     els['side-toggle'].textContent);
  ok('收起时按钮有说明（鼠标停上去能看懂）', !!els['side-toggle'].title);

  sideFolded = false;
  applySideFold();
  ok('展开后不再 folded', !els['side'].classList.contains('folded'));
  ok('展开后按钮改成「收起 ◂」', els['side-toggle'].textContent === '收起 ◂',
     els['side-toggle'].textContent);

  // render 里会跟着状态走
  sideFolded = true;
  render();
  ok('render 会自动同步收起状态',
     els['side'].classList.contains('folded') &&
     els['side-toggle'].textContent === '战报 ▸');
  sideFolded = false;
  applySideFold();
}

// ---------- 10) 扣底时压缩牌桌，33 张牌要摆得开 ----------
{
  // 真机横屏的逻辑尺寸大约 960 x 411
  const SCREEN_H = 411;
  const normalHand = SCREEN_H * 0.40 - 40;   // 正常：手牌区 40%，减掉下面那一条按钮
  const discardHand = SCREEN_H * 0.64 - 40;  // 扣底：手牌区 64%

  // 33 张牌（发的 25 张 + 8 张底牌），大致分成四门
  const g33 = [{ n: 9 }, { n: 8 }, { n: 8 }, { n: 8 }];
  const W = 950;   // 960 减去左右内边距

  const normal = planHandLayout(g33, W, normalHand);
  const discard = planHandLayout(g33, W, discardHand);

  ok('33 张牌在正常大小下摆不开（这就是你看到的问题）',
     !normal.fits || normal.scale < 1,
     '行数=' + normal.rows + ' 缩放=' + normal.scale + ' fits=' + normal.fits);

  ok('扣底时 33 张牌能排成两行', discard.rows === 2, '行数=' + discard.rows);
  ok('扣底时 33 张牌**一张都不用叠**，全都看得见', discard.ov === 0, 'ov=' + discard.ov);
  ok('扣底时牌面不用缩小', discard.scale === 1, 'scale=' + discard.scale);
  ok('扣底时确实塞得下', discard.fits === true);
  ok('扣底时比正常时省出了地方', discardHand > normalHand,
     normalHand.toFixed(0) + ' → ' + discardHand.toFixed(0) + ' 像素高');

  // 两行加起来的高度真的放得进扣底时的空间
  const need = discard.cardH * 2 + HAND_ROW_GAP + HAND_PAD;
  ok('两行牌的高度放得进扣底时的空间', need <= discardHand,
     '需要 ' + need + '，有 ' + discardHand.toFixed(0));
}

// ---------- 11) 扣底阶段给牌桌挂上标记 ----------
{
  const hadDealer = game.dealerSeat;
  game.humanSeat = 0;
  if (!game.hands[0]) game.hands[0] = [C('S', 3)];
  game.dealerSeat = 0;

  game.phase = 'playing';
  render();
  ok('正常出牌时牌桌不压缩', !els['body'].classList.contains('discarding'));

  game.phase = 'discard';
  render();
  ok('扣底时牌桌被压下去（手牌腾出地方）',
     els['body'].classList.contains('discarding'));
  ok('扣底时提示还是那句「请选 8 张」',
     els['status'].textContent.indexOf('扣底') >= 0, els['status'].textContent);

  game.phase = 'playing';
  render();
  ok('扣底结束后牌桌恢复原样', !els['body'].classList.contains('discarding'));

  game.dealerSeat = hadDealer;
}

// ---------- 12) 亮出去的主牌摆在牌桌正中 ----------
// 假 DOM 里 innerHTML 只是存字符串，不解析成子节点，
// 所以「读出这块牌面写了什么」要连 _html 一起看。
function findClass(el, cls) {
  if (!el) return null;
  if (el.classList && el.classList.contains(cls)) return el;
  for (const c of (el.children || [])) {
    const r = findClass(c, cls);
    if (r) return r;
  }
  return null;
}
function textOf(el) {
  if (!el) return '';
  let s = el._text || el._html || '';
  for (const c of (el.children || [])) s += textOf(c);
  return s;
}
{
  const g = game;
  const saved = { phase: g.phase, bid: g.bid, level: g.levelRank, seat: g.humanSeat };
  g.humanSeat = 0;
  g.phase = 'dealing';
  g.levelRank = 2;

  g.bid = null;
  render();
  ok('还没人亮主时，牌桌正中不摆主牌', !findClass(els['trick'], 'bid-badge'));

  g.bid = { seat: 1, suit: 0, kind: 'single' };
  render();
  const b1 = findClass(els['trick'], 'bid-badge');
  ok('有人亮主后，主牌摆到了牌桌正中', !!b1);
  ok('单张亮主就摆一张牌', b1 && findClass(b1, 'bid-cards').children.length === 1,
     b1 ? findClass(b1, 'bid-cards').children.length + ' 张' : 'null');
  ok('牌面就是那张级牌（黑桃）',
     textOf(findClass(b1, 'bid-cards')).indexOf('♠') >= 0, textOf(findClass(b1, 'bid-cards')));
  ok('写明是谁亮的主', textOf(b1).indexOf(g.pname(1)) >= 0, textOf(b1));

  g.bid = { seat: 1, suit: 0, kind: 'pair', own: true };
  render();
  const b2 = findClass(els['trick'], 'bid-badge');
  ok('加保之后摆两张牌', findClass(b2, 'bid-cards').children.length === 2);
  ok('自己加码的叫牌写「加保」', textOf(b2).indexOf('加保') >= 0, textOf(b2));

  g.bid = { seat: 2, suit: -1, kind: 'jokers', jrank: 17 };
  render();
  const b3 = findClass(els['trick'], 'bid-badge');
  ok('反无主摆两张大王', findClass(b3, 'bid-cards').children.length === 2);
  ok('反无主写得清清楚楚', textOf(b3).indexOf('反无主') >= 0, textOf(b3));

  g.phase = 'discard';
  render();
  ok('一开始扣底就把主牌收起来（腾地方给 33 张手牌）',
     !findClass(els['trick'], 'bid-badge'));

  g.phase = 'playing';
  render();
  ok('出牌阶段牌桌正中也不摆主牌', !findClass(els['trick'], 'bid-badge'));

  // 按钮上写什么字
  ok('第一次亮主写「亮主」',
     bidLabel({ kind: 'single', suit: 0 }, false) === '亮主·黑桃',
     bidLabel({ kind: 'single', suit: 0 }, false));
  ok('反别人的主写「反主」',
     bidLabel({ kind: 'pair', suit: 0 }, false) === '反主·两张黑桃',
     bidLabel({ kind: 'pair', suit: 0 }, false));
  ok('自己给自己加码写「加保」，不写「反主」',
     bidLabel({ kind: 'pair', suit: 0 }, true) === '加保·两张黑桃',
     bidLabel({ kind: 'pair', suit: 0 }, true));
  ok('自己凑齐双王加码也写「加保」',
     bidLabel({ kind: 'jokers', jrank: 17 }, true) === '加保·两张大王',
     bidLabel({ kind: 'jokers', jrank: 17 }, true));
  ok('反别人的无主写「反无主」',
     bidLabel({ kind: 'jokers', jrank: 17 }, false) === '反无主·两张大王',
     bidLabel({ kind: 'jokers', jrank: 17 }, false));

  g.phase = saved.phase; g.bid = saved.bid; g.levelRank = saved.level; g.humanSeat = saved.seat;
}

// ---------- 13) 抓到第二张能加保的牌，发牌要停下来让玩家拿主意 ----------
{
  const g = game;
  const saved = { phase: g.phase, bid: g.bid, level: g.levelRank, seat: g.humanSeat, hand: g.hands[0] };
  g.humanSeat = 0;
  g.phase = 'dealing';
  g.levelRank = 2;
  g.bid = null;

  g.hands[0] = [C(0, 2)];                       // 一张黑桃级牌
  ok('手里有级牌、还没人亮主 → 停下来问要不要亮主',
     humanBidSignature() === 'single', String(humanBidSignature()));

  g.bid = { seat: 0, suit: 0, kind: 'single' };  // 自己已经把黑桃亮了
  ok('自己刚亮完、手上没有更大的组合 → 不用停',
     humanBidSignature() === null, String(humanBidSignature()));

  g.hands[0] = [C(0, 2), C(0, 2)];
  ok('抓到第二张黑桃级牌 → 能加保，必须停下来问',
     humanBidSignature() === 'pair', String(humanBidSignature()));

  g.bid = { seat: 1, suit: 3, kind: 'pair' };    // 被别家一对梅花反了
  ok('被反了、自己反不动 → 不用停',
     humanBidSignature() === null, String(humanBidSignature()));

  g.hands[0] = [C(0, 2), C(0, 2), C(4, 16), C(4, 16)];
  ok('凑齐两张小王 → 能反无主，必须停下来问',
     humanBidSignature() === 'jokers', String(humanBidSignature()));
  ok('同一个档位只停一次（不然每次发牌都停，烦）',
     humanBidSignature() === 'jokers', String(humanBidSignature()));

  // 手上最长的花色换了不算「新情况」——档位没变就不该再停一次
  g.bid = null;
  g.hands[0] = [C(0, 2), C(2, 2), C(2, 5), C(2, 5)];   // 梅花长 → 会挑梅花亮
  ok('级牌有两门时挑最长的那门', g.bestBid(0).suit === 2, 'suit=' + g.bestBid(0).suit);
  const sigA = humanBidSignature();
  g.hands[0] = [C(0, 2), C(2, 2), C(0, 5), C(0, 5), C(0, 5)];  // 黑桃反超
  ok('挑的门换了，但档位没变 → 代号不变，不会重复停下来烦人',
     sigA === 'single' && humanBidSignature() === 'single' && g.bestBid(0).suit === 0,
     sigA + ' → ' + humanBidSignature() + '，suit=' + g.bestBid(0).suit);

  g.phase = saved.phase; g.bid = saved.bid; g.levelRank = saved.level;
  g.humanSeat = saved.seat; g.hands[0] = saved.hand;
}

// ---------- 14) 「重开」挪到顶栏，不再藏在战报栏里 ----------
{
  const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  const css = fs.readFileSync(__dirname + '/../style.css', 'utf8');
  const infoBar = html.slice(html.indexOf('id="info-bar"'), html.indexOf('id="body"'));
  const side = html.slice(html.indexOf('id="side"'), html.indexOf('id="seat-bottom"'));

  ok('「重开」按钮在顶栏里', infoBar.indexOf('id="restart"') >= 0);
  ok('「重开」不在战报栏里', side.indexOf('id="restart"') < 0);
  ok('收起战报时不会再顺手把「重开」一起藏掉',
     css.indexOf('#side.folded #restart') < 0);
}

// ---------- 15) 亮牌阶段摆一排「位置固定」的花色按钮 ----------
{
  const g = game;
  const saved = { phase: g.phase, bid: g.bid, level: g.levelRank, seat: g.humanSeat, hand: g.hands[0] };
  g.humanSeat = 0;
  g.phase = 'dealing';
  g.levelRank = 2;
  g.bid = null;
  stopDealing();                       // 走「发牌停下来等玩家拿主意」那条分支

  const labels = () => els['actions'].children.map(c => c.textContent);
  // 六个固定按钮挂在 .suit-btns 那个盒子里（它后面才是慢/中/快/继续发牌）
  const suitBox = () => els['actions'].children.find(c => c.classList.contains('suit-btns'));
  const sb = () => suitBox().children;
  const face = b => b.children[0].textContent;                 // 按钮上画的花色符号
  const tag = b => (b.children[1] ? b.children[1].textContent : '');  // 角上的「×2」
  const find = f => sb().filter(b => face(b) === f)[0];

  // 手上有：黑桃级牌 1 张、梅花级牌 1 对、大王 2 张
  g.hands[0] = [C(0, 2), C(2, 2), C(2, 2), C(4, 17), C(4, 17)];
  render();

  ok('一排固定六个按钮（四个花色 + 小王 + 大王）', sb().length === 6, sb().map(face).join(' '));
  ok('顺序按黑红花方排、王在最后，位置永远不动',
     sb().map(face).join(' ') === '♠ ♥ ♣ ♦ 小王 大王', sb().map(face).join(' '));
  ok('按钮上就是花色符号，不再是一长串文字',
     sb().every(b => face(b).length <= 2), sb().map(face).join(' '));

  ok('能亮的亮着：黑桃、梅花、大王', !find('♠').disabled && !find('♣').disabled && !find('大王').disabled);
  ok('点不动的灰着：红桃、方块、小王',
     find('♥').disabled && find('♦').disabled && find('小王').disabled);
  ok('两张的那一档角上挂「×2」（梅花级牌一对）', tag(find('♣')) === '×2', tag(find('♣')));
  ok('两张的那一档角上挂「×2」（大王一对）', tag(find('大王')) === '×2', tag(find('大王')));
  ok('单张的那一档不挂「×2」', tag(find('♠')) === '', tag(find('♠')));
  ok('灰按钮带说明（点上去能看到为什么点不动）',
     find('♥').title.indexOf('点不动') >= 0, find('♥').title);
  ok('亮的按钮带说明（写明这是亮主还是反主）',
     find('♠').title === '亮主·黑桃', find('♠').title);
  ok('发牌速度按钮还在', labels().indexOf('慢') >= 0 && labels().indexOf('快') >= 0);
  ok('发牌速度默认选中「中」',
     els['actions'].children.some(c => c.textContent === '中' && c.classList.contains('on')));
  ok('停下来了就给「继续发牌」', labels().indexOf('继续发牌') >= 0);

  // 点「快」→ 选中效果跟着挪到「快」上，而且真的把发牌速度改了
  els['actions'].children.find(c => c.textContent === '快')._click();
  ok('点了「快」后选中效果挪到「快」',
     els['actions'].children.some(c => c.textContent === '快' && c.classList.contains('on')));
  ok('「中」不再亮着', !els['actions'].children.some(c => c.textContent === '中' && c.classList.contains('on')));
  // 再点回「中」，恢复默认，别影响后面的测试
  els['actions'].children.find(c => c.textContent === '中')._click();

  // 按一下亮着的黑桃 → 真的亮出去
  find('♠')._click();
  ok('点亮的按钮真的会亮主', g.bid && g.bid.suit === 0 && g.bid.kind === 'single',
     JSON.stringify(g.bid && { s: g.bid.suit, k: g.bid.kind }));
  stopDealing();                       // 点完会把发牌重新跑起来，先按住

  // 「自保时再复亮一次」：玩家自己亮的黑桃单张，手上又摸到第二张黑桃级牌
  // → 同一个按钮再次亮起来，角上多个「×2」，点它就是加保
  g.bid = { seat: 0, suit: 0, kind: 'single' };
  g.hands[0] = [C(0, 2), C(0, 2), C(2, 2), C(2, 2)];
  render();
  ok('自保：手上凑齐两张黑桃级牌，黑桃按钮又亮了', !find('♠').disabled);
  ok('自保：角上挂出「×2」', tag(find('♠')) === '×2', tag(find('♠')));
  ok('自保：说明写「加保」不写「反主」', find('♠').title.indexOf('加保') === 0, find('♠').title);
  ok('换到别的花色的两张写「反主」，不跟着写成「加保」',
     find('♣').title.indexOf('反主') === 0, find('♣').title);
  // 只有「亮」这一个信号：不给任何按钮另套金圈/金边，
  // 不然灰按钮看着也像能点，把老年人绕晕
  ok('灰按钮不套任何金圈（亮就是亮，灰就是灰）',
     sb().every(b => !b.classList.contains('cur') && !b.classList.contains('hot')));
  find('♠')._click();
  ok('再点一次真的加保了（单张变两张）', g.bid.kind === 'pair' && g.bid.own === true,
     JSON.stringify({ k: g.bid.kind, own: g.bid.own }));
  stopDealing();

  // 手上没级牌：六个按钮全灰，但一个不少、位置照旧
  g.bid = null;
  g.hands[0] = [C(0, 5), C(1, 6), C(2, 7)];
  render();
  ok('没级牌时六个按钮全灰', sb().length === 6 && sb().every(b => b.disabled));
  ok('没级牌时位置也没变（不会因为全灰就少几个）',
     sb().map(face).join(' ') === '♠ ♥ ♣ ♦ 小王 大王', sb().map(face).join(' '));

  // playableBids 只留压得过桌上主牌的：手上一对方块级牌 + 一张黑桃级牌，
  // 桌上已经有人亮了梅花单张 → 只有那对反得动，单张跟人家同档，反不动
  g.hands[0] = [C(0, 2), C(3, 2), C(3, 2)];
  g.bid = { seat: 1, suit: 2, kind: 'single' };
  ok('playableBids 只给压得过桌上主牌的',
     playableBids().length === 1 && playableBids()[0].kind === 'pair' && playableBids()[0].suit === 3,
     JSON.stringify(playableBids().map(b => b.kind + b.suit)));
  render();
  ok('反主按钮只有方块亮着，黑桃灰着',
     !find('♦').disabled && tag(find('♦')) === '×2' && find('♠').disabled && find('♣').disabled);

  g.phase = saved.phase; g.bid = saved.bid; g.levelRank = saved.level;
  g.humanSeat = saved.seat; g.hands[0] = saved.hand;
}

// ---------- 16) 选中的牌被右边的牌压住，只看上半部分能点回来 ----------
{
  const css = fs.readFileSync(__dirname + '/../style.css', 'utf8');
  const selRule = css.slice(css.indexOf('#hand .card.selected {'), css.indexOf('}', css.indexOf('#hand .card.selected {')));
  const cardRule = css.slice(css.indexOf('#hand .card { cursor: pointer'), css.indexOf('}', css.indexOf('#hand .card { cursor: pointer')));

  const hlRule = css.slice(css.indexOf('#hand .card.highlight'),
                           css.indexOf('}', css.indexOf('#hand .card.highlight')));
  ok('选中的牌抬得比原来高（原来 -10px）',
     /-1[5-9]px|-2[0-9]px/.test(selRule), selRule.slice(0, 90));
  ok('选中的牌不再靠 margin-right 挤开右边的牌（那样反而把牌挤乱了）',
     selRule.indexOf('margin-right') < 0, selRule.slice(0, 90));
  ok('选中的牌不再抬到最上层（不然就盖住右边那张了）',
     selRule.indexOf('z-index') < 0, selRule.slice(0, 90));
  ok('所有手牌钉在同一层，谁压谁只看左右先后',
     cardRule.indexOf('z-index: 0') >= 0, cardRule.slice(0, 90));
  ok('高亮的牌也不抢层（否则它同样会盖住右边那张的点数）',
     hlRule.indexOf('z-index') < 0, hlRule.slice(0, 90));

  // 手牌区上边要留够地方，不然抬起来的牌会被 overflow:hidden 裁掉
  const handRule = css.slice(css.indexOf('#hand {'), css.indexOf('}', css.indexOf('#hand {')));
  const num = s => Number(String(s).replace(/[^0-9]/g, ''));
  const padTop = num((handRule.match(/padding: *[0-9]+px/) || [''])[0]);
  const raise = num((selRule.match(/-[0-9]+px/) || [''])[0]);
  ok('手牌区上边留白够抬起来的牌用（不会被裁掉）', padTop >= raise,
     'padding-top=' + padTop + 'px，抬 ' + raise + 'px');
  ok('JS 算高度时用的留白跟 CSS 对得上', HAND_PAD === padTop + 4,
     'HAND_PAD=' + HAND_PAD + '，CSS 上下留白=' + padTop + '+4');
}

// ---------- 17) 拖拉机动画 / 甩牌提示挪到牌桌右上角，不再挡出牌 ----------
{
  const css = fs.readFileSync(__dirname + '/../style.css', 'utf8');
  const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  const fx = css.slice(css.indexOf('#flourish {'), css.indexOf('}', css.indexOf('#flourish {')));
  const kfAt = css.indexOf('@keyframes flourish {');
  const kf = css.slice(kfAt, kfAt + 320);
  const corner = css.slice(css.indexOf('#corner {'), css.indexOf('}', css.indexOf('#corner {')));
  const banner = css.slice(css.indexOf('#banner {'), css.indexOf('}', css.indexOf('#banner {')));

  const atTable = html.indexOf('<div id="table">');
  const atCorner = html.indexOf('<div id="corner">');
  ok('角上那一块挂在牌桌里（这样才能贴着牌桌右上角摆）',
     atTable >= 0 && atCorner > atTable && atCorner < html.indexOf('id="seat-bottom"'),
     'table@' + atTable + ' corner@' + atCorner);
  ok('拖拉机招牌和甩牌提示都在这个角里（两个不会互相压）',
     html.indexOf('<div id="flourish"></div>') > atCorner
     && html.indexOf('<div id="banner"></div>') > atCorner);
  ok('框子按列往下排、靠右对齐，互不重叠',
     corner.indexOf('flex-direction: column') >= 0 && corner.indexOf('align-items: flex-end') >= 0,
     corner.slice(0, 140));
  ok('框子绝对定位贴着右上角',
     corner.indexOf('position: absolute') >= 0
     && /right: *[0-9]+px/.test(corner) && /top: *[0-9]+px/.test(corner), corner.slice(0, 140));
  ok('框子宽度封顶，伸不到牌桌中间去', /max-width: *[0-9]+%/.test(corner), corner.slice(0, 200));
  ok('这一块不吃点击，看见了也不挡操作（框里两个都跟着不受影响）',
     corner.indexOf('pointer-events: none') >= 0, corner.slice(0, 200));

  ok('招牌自己不再定位（位置交给那个角）', fx.indexOf('position:') < 0, fx.slice(0, 80));
  ok('不再用 translate(-50%) 拉到屏幕中间去', fx.indexOf('translate(-50%') < 0, fx.slice(0, 120));
  ok('缩放从右上角长出来（不会往牌桌中间压过去）',
     fx.indexOf('transform-origin: top right') >= 0, fx.slice(0, 200));
  ok('动画全程都在角上，不再用 -50% 那套居中换算',
     kf.length > 0 && kf.indexOf('translate(-50%') < 0, kf.slice(0, 160));

  // 甩牌失败的红条以前是 fixed 摆屏幕正中 top:20%，正好糊住牌
  ok('甩牌提示也不再 fixed 钉在屏幕正中', banner.indexOf('position: fixed') < 0, banner.slice(0, 90));
  ok('甩牌提示不再用 left: 50% 居中', banner.indexOf('left: 50%') < 0, banner.slice(0, 90));
  ok('甩牌提示也改成贴着右上角长出来', banner.indexOf('transform-origin: top right') >= 0);
  ok('甩牌提示限宽，往左伸不到牌桌中间', /max-width: *[0-9]+px/.test(banner), banner.slice(0, 160));

  // 表扬横幅照旧摆屏幕正中：回合结束时弹的，牌早结算完了，挡不着谁
  const praise = css.slice(css.indexOf('#banner.praise {'),
                           css.indexOf('}', css.indexOf('#banner.praise {')));
  ok('表扬横幅还是摆屏幕正中', praise.indexOf('position: fixed') >= 0
     && praise.indexOf('left: 50%') >= 0, praise.slice(0, 140));

  // 甩牌失败走 warn（右上角），表扬走 praise（正中）
  hideBanner();
  showBanner('甩牌失败：被 ♠K 压住', 100, true);
  ok('甩牌失败挂 warn，不挂 praise',
     els['banner'].classList.contains('warn') && !els['banner'].classList.contains('praise'));
  showBanner('真厉害！', 100, false);
  ok('绕圈表扬挂 praise，不挂 warn',
     els['banner'].classList.contains('praise') && !els['banner'].classList.contains('warn'));
  hideBanner();
  ok('收起来的时候两个标记都清掉',
     !els['banner'].classList.contains('warn') && !els['banner'].classList.contains('praise'));

  // 红条要挂 6.5 秒，招牌挂 1.5 秒——这局要是打得快，
  // 上一圈的红条/招牌能一路飘进下一局的发牌阶段（实机上见过）。
  // 新一局开头必须把它们连根拔掉，不能留着吓人。
  showBanner('甩牌失败：被 ♠K 压住', 6500, true);
  showFlourish('甩 8 张！');
  ok('红条先挂上了', els['banner'].classList.contains('on'));
  ok('招牌先挂上了', els['flourish'].classList.contains('on'));
  beginRound();
  ok('开新局时上一圈的红条被清掉', !els['banner'].classList.contains('on'),
     els['banner'].className);
  ok('开新局时上一圈的招牌也被清掉', !els['flourish'].classList.contains('on'),
     els['flourish'].className);
  ok('连 warn 标记也不留（不然下次弹出来还是红的）',
     !els['banner'].classList.contains('warn'));

  // 叫牌按钮那一排的样式
  const btns = css.slice(css.indexOf('.suit-btns {'), css.indexOf('}', css.indexOf('.suit-btns {')));
  const sbtn = css.slice(css.indexOf('#actions button.suit-btn {'),
                         css.indexOf('}', css.indexOf('#actions button.suit-btn {')));
  const dis = css.slice(css.indexOf('#actions button.suit-btn:disabled'),
                        css.indexOf('}', css.indexOf('#actions button.suit-btn:disabled')));
  ok('六个叫牌按钮排成一行，不许换行也不许被挤扁',
     btns.indexOf('display: flex') >= 0 && btns.indexOf('flex: none') >= 0, btns);
  ok('每个按钮宽度写死，位置才不会左右乱窜', /width: *[0-9]+px/.test(sbtn), sbtn);
  ok('点不动的那几门压暗，但仍然占着位置',
     dis.indexOf('background') >= 0 && dis.indexOf('display: none') < 0, dis);
  ok('红桃方块用红字，灰掉的时候要被压过去（规则顺序不能反）',
     css.indexOf('#actions button.suit-btn.red') < css.indexOf('#actions button.suit-btn:disabled'));
  ok('角上那个「×2」是个小角标', css.indexOf('.suit-btn .sb-tag') >= 0
     && css.indexOf('position: absolute', css.indexOf('.suit-btn .sb-tag')) >= 0);
}

// ---------- 18) 出的牌不合法时，得当场说清楚 ----------
// 有了「有对必对」这条，玩家更容易点出一个不合法的组合。
// 点了「出牌」没反应又不说话，只会以为游戏卡住了。
{
  game.phase = 'playing';
  game.trumpSuit = 'H'; game.levelRank = 2;      // 红桃主，黑桃副门
  game.humanSeat = 0;
  game.leadSeat = 3;                             // 上家领出，轮到你了
  const q1 = C('S', 12), q2 = C('S', 12), s7 = C('S', 7), s5 = C('S', 5), s3 = C('S', 3);
  game.hands[0] = [q1, q2, s7, s5, s3, C('H', 9)];
  game.currentTrick = [{ seat: 3, cards: [C('S', 14), C('S', 13), C('S', 9), C('S', 9)] }];  // ♠A ♠K ♠9♠9

  hideBanner();
  // 手里明明有 ♠Q♠Q 一对，却挑了四张单出去
  selected = new Set([q1.uid, s7.uid, s5.uid, s3.uid]);
  doPlay();
  ok('挑了个拆对子的组合 → 红条当场把原因说出来',
     /这么出不行/.test(els['banner'].textContent) && /有对子/.test(els['banner'].textContent),
     els['banner'].textContent);
  ok('这一手没真的出出去（牌还在手上）', game.hands[0].length === 6, '剩 ' + game.hands[0].length + ' 张');
  ok('红条走的是角上那个 warn 样式', els['banner'].classList.contains('warn'));

  // 老老实实把对子拿出来 → 出得掉，红条也收起来了
  hideBanner();
  selected = new Set([q1.uid, q2.uid, s7.uid, s5.uid]);
  doPlay();
  ok('按牌型跟上去就出得掉', game.hands[0].length === 2, '剩 ' + game.hands[0].length + ' 张');
  ok('出成了就不弹红条', !els['banner'].classList.contains('on'), els['banner'].className);
}

// ---------- 19) 手牌优先：屏幕矮时撑高手牌区、压牌桌，别裁掉最后一行 ----------
{
  // handNeedHeight：按整张大小（52×74）算出手牌需要多高（已含 HAND_PAD）
  const full = [{ n: 8 }, { n: 6 }, { n: 6 }, { n: 5 }];   // 25 张
  ok('25 张在横屏宽下只需要一行高（整张大小）',
     handNeedHeight(full, 900) === 74 + HAND_PAD, '=' + handNeedHeight(full, 900));
  // 窄屏一行塞不下，要换行，需要的高度自然更高
  ok('25 张在窄屏上需要的高度比宽屏高（会换行）',
     handNeedHeight(full, 320) > handNeedHeight(full, 900),
     handNeedHeight(full, 320) + ' vs ' + handNeedHeight(full, 900));

  // applyHandHeight：摆一手 25 张牌，模拟矮屏（body 高 300，横屏小手机那种）。
  // 40% 只有 120px，摆不下两行整张牌；手牌区必须被撑得比 40% 还高。
  compactMode = true;   // 这段测的是「压缩牌桌」模式下的撑高逻辑
  const g = game;
  const saved = { seat: g.humanSeat, hand: g.hands[0], trump: g.trumpSuit, level: g.levelRank };
  g.humanSeat = 0;
  g.trumpSuit = 'H'; g.levelRank = 2;
  const deal = [];
  for (let r = 3; r <= 10; r++) deal.push(C('H', r));
  for (let r = 3; r <= 8; r++) deal.push(C('S', r));
  for (let r = 3; r <= 8; r++) deal.push(C('D', r));
  for (let r = 3; r <= 7; r++) deal.push(C('C', r));
  g.hands[0] = deal;

  els['body'].clientHeight = 300;
  els['hand'].clientWidth = 640;
  $('hand-bar');   // 先让假 DOM 把它建出来，再补上高度
  els['hand-bar'].offsetHeight = 50;
  applyHandHeight();
  const minH = parseFloat(els['seat-bottom'].style.minHeight);
  ok('矮屏上手牌区被撑得比 40%（120px）还高，不再裁最后一行',
     minH > 120, 'min-height=' + minH);
  ok('牌桌还保得住最矮高度（没被压没）',
     300 - minH >= TABLE_FLOOR, '牌桌剩 ' + (300 - minH) + 'px');

  // 只剩一张牌时也要撑到够摆下整张大小，否则这张会被裁掉
  g.hands[0] = [C('S', 3)];
  applyHandHeight();
  const oneH = parseFloat(els['seat-bottom'].style.minHeight);
  ok('只剩一张牌时也撑得下整张大小（不被裁）',
     oneH >= 74 + HAND_PAD + 50 + SEAT_BOTTOM_PAD, 'min-height=' + oneH);

  // 一张不剩就不设 min-height，交给 CSS 的 40% 兜底
  g.hands[0] = [];
  applyHandHeight();
  ok('没牌时不设 min-height', !els['seat-bottom'].style.minHeight,
     'min-height=' + els['seat-bottom'].style.minHeight);

  g.humanSeat = saved.seat; g.hands[0] = saved.hand;
  g.trumpSuit = saved.trump; g.levelRank = saved.level;
  compactMode = false;
  els['body'].clientHeight = undefined;
  els['hand'].clientWidth = undefined;
  els['hand-bar'].offsetHeight = undefined;
}

console.log('界面冒烟测试：通过 ' + pass + ' / 失败 ' + fail);
`;

eval(src + test);

// 收尾：假计时器不会让进程卡住
process.exit(0);
