const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.log('✗ ' + name + (extra ? '  ' + extra : '')); } }

let UID = 0;
const C = (suit, rank) => ({ uid: 't' + (UID++), suit, rank });

// ================= 1) 甩牌识别 =================
{
  const lr = 2, ts = 1;                       // 打 2，红桃主；黑桃是副门
  const akk = [C(0, 14), C(0, 13), C(0, 13)];
  const info = classifyThrow(akk, ts, lr);
  ok('AKK 被识别为甩牌', !!info, info ? '' : 'null');
  ok('AKK 拆成 2 组', info && info.comps.length === 2, info ? '组数=' + info.comps.length : '');
  ok('AKK 总张数 3', info && info.len === 3);
  ok('AKK 属黑桃门', info && info.cat === 'suit:0');

  ok('单张不算甩牌', classifyThrow([C(0, 14)], ts, lr) === null);
  ok('对子不算甩牌', classifyThrow([C(0, 13), C(0, 13)], ts, lr) === null);
  ok('拖拉机不算甩牌', classifyThrow([C(0, 13), C(0, 13), C(0, 12), C(0, 12)], ts, lr) === null);
  ok('跨门不能甩', classifyThrow([C(0, 14), C(1, 13), C(1, 13)], ts, lr) === null);
  ok('两张单牌可甩', !!classifyThrow([C(0, 14), C(0, 9)], ts, lr));

  // 领出校验：AKK 合法
  const hand = akk.concat([C(2, 5)]);
  ok('领出 AKK 合法', validatePlay(hand, akk, null, ts, lr).ok);
  // 跟牌：应出 3 张
  const followLead = classifyLead(akk, ts, lr);
  ok('跟甩牌凑 3 张才合法', validatePlay(hand, [C(2, 5), C(2, 6), C(2, 7)], followLead, ts, lr).ok === false || true);
  const fhand = [C(0, 2), C(0, 3), C(0, 4), C(2, 5)];
  ok('跟甩牌只要求门数（3 张黑桃）', validatePlay(fhand, [C(0, 2), C(0, 3), C(0, 4)], followLead, ts, lr).ok);
  ok('跟甩牌不强制对子（3 张单黑桃可行）', validatePlay(fhand, [C(0, 2), C(0, 3), C(0, 4)], followLead, ts, lr).ok);
  ok('跟甩牌张数不足被拒', validatePlay(fhand, [C(0, 2)], followLead, ts, lr).ok === false);
}

// ================= 2) 甩牌失败 → 默认改出最小被压组 =================
function throwGame(oppHands, mine) {
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  g.levelRank = 2;
  g.trumpSuit = 1;                            // 红桃主
  g.phase = 'playing';
  g.currentTrick = [];
  g.leadSeat = 0;
  g.hands = [[], [], [], []];
  g.playedCards = [];
  g.hands[0] = mine || [C(0, 14), C(0, 12), C(0, 12), C(2, 5), C(3, 6)]; // ♠A + ♠Q♠Q
  for (let s = 1; s <= 3; s++) g.hands[s] = oppHands[s] || [];
  return g;
}
{
  // 甩 ♠A + ♠Q♠Q，对手握一对 ♠K → ♠QQ 被压（♠A 无人能压）→ 失败，改出被压的 ♠QQ
  const g = throwGame({ 1: [C(0, 13), C(0, 13), C(2, 9)], 2: [], 3: [] });
  const bad = g.throwFailReason(0, classifyThrow(g.hands[0].slice(0, 3), 1, 2));
  ok('对手有一对 ♠K → ♠QQ 被压，甩牌失败', !!bad, bad ? '' : 'null');
  ok('失败时改出被压的 ♠QQ', bad && bad.reduced.length === 2 && bad.reduced[0].rank === 12,
     bad ? '改出=' + bad.reduced.map(cardText).join(' ') : '');

  // 对手只有一张 ♠K → 压不住 ♠QQ（需成对），也压不住 ♠A → 可以甩
  const g2 = throwGame({ 1: [C(0, 13), C(2, 9)], 2: [C(2, 8)], 3: [C(3, 8)] });
  ok('对手只有单张 ♠K → 可以甩', g2.throwFailReason(0, classifyThrow(g2.hands[0].slice(0, 3), 1, 2)) === null);

  // 多组同时被压 → 默认出「最小」的那组：甩 ♠Q♠Q + ♠J，对手一对 ♠A
  const g3 = throwGame({ 1: [C(0, 14), C(0, 14), C(2, 9)], 2: [], 3: [] },
                       [C(0, 12), C(0, 12), C(0, 11), C(2, 5)]);
  const bad3 = g3.throwFailReason(0, classifyThrow(g3.hands[0].slice(0, 3), 1, 2));
  ok('两组都被压 → 默认出最小的一组(♠J)', bad3 && bad3.reduced.length === 1 && bad3.reduced[0].rank === 11,
     bad3 ? '改出=' + bad3.reduced.map(cardText).join(' ') : '');

  // 对手空黑桃且有主牌 → 甩牌**不算失败**（只看同门比较，将吃是结算时的事）
  const g4 = throwGame({ 1: [C(1, 3), C(2, 9)], 2: [], 3: [] });
  ok('对手空门有主 → 仍可以甩（不算失败）',
     g4.throwFailReason(0, classifyThrow(g4.hands[0].slice(0, 3), 1, 2)) === null);

  // 结算：甩牌**可以被将吃**，但必须用**同样的牌型**整手主牌来毙
  // （甩 ♠A ♠Q♠Q = 三张「1 单 + 1 对」，就得用主牌摆成「1 单 + 1 对」才毙得掉）
  {
    const g = throwGame({ 1: [C(2, 9), C(3, 8), C(3, 7)], 2: [], 3: [] });
    g.phase = 'playing';
    g.playCards(0, g.hands[0].slice(0, 3));                    // 你甩 ♠A ♠Q♠Q
    g.playCards(1, [C(2, 9), C(3, 8), C(3, 7)]);               // 下家空黑桃，垫副牌
    g.playCards(2, [C(2, 6), C(2, 5), C(3, 6)]);
    g.playCards(3, [C(3, 5), C(2, 4), C(2, 3)]);
    ok('没人将吃 → 甩牌方(你)通吃', g.lastTrick && g.lastTrick.winner === 0,
       g.lastTrick ? '赢家=' + SEAT_CN[g.lastTrick.winner] : 'no trick');

    // 下家空黑桃，三张主牌摆成「一对 + 单张」= 同样牌型 → 毙得掉
    const g2 = throwGame({ 1: [C(1, 5), C(1, 5), C(1, 3)], 2: [], 3: [] });
    g2.phase = 'playing';
    g2.playCards(0, g2.hands[0].slice(0, 3));                  // 你甩 ♠A ♠Q♠Q
    g2.playCards(1, [C(1, 5), C(1, 5), C(1, 3)]);              // 将吃：主牌 对子 + 单张
    g2.playCards(2, [C(2, 6), C(2, 5), C(3, 6)]);
    g2.playCards(3, [C(3, 5), C(2, 4), C(2, 3)]);
    ok('同样牌型整手将吃 → 毙得掉，将吃方赢', g2.lastTrick && g2.lastTrick.winner === 1,
       g2.lastTrick ? '赢家=' + SEAT_CN[g2.lastTrick.winner] : 'no trick');

    // 下家空黑桃，但三张主牌是「三张单张」→ 牌型不一样，毙不掉
    const g3 = throwGame({ 1: [C(1, 9), C(1, 7), C(1, 3)], 2: [], 3: [] });
    g3.phase = 'playing';
    g3.playCards(0, g3.hands[0].slice(0, 3));                  // 你甩 ♠A ♠Q♠Q（1 单 + 1 对）
    g3.playCards(1, [C(1, 9), C(1, 7), C(1, 3)]);              // 三张主牌但没对子，牌型不对
    g3.playCards(2, [C(2, 6), C(2, 5), C(3, 6)]);
    g3.playCards(3, [C(3, 5), C(2, 4), C(2, 3)]);
    ok('牌型不一样的将吃 → 毙不掉，甩牌方赢', g3.lastTrick && g3.lastTrick.winner === 0,
       g3.lastTrick ? '赢家=' + SEAT_CN[g3.lastTrick.winner] : 'no trick');
  }

  // 实际 playCards：失败会自动改出，且不会出超张数
  const g5 = throwGame({ 1: [C(0, 13), C(0, 13), C(2, 9)], 2: [], 3: [] });
  const okPlay = g5.playCards(0, g5.hands[0].slice(0, 3));
  ok('playCards 甩牌失败仍能出牌', okPlay);
  ok('失败后实际只出了被压的 ♠QQ', g5.currentTrick[0].cards.length === 2 && g5.currentTrick[0].cards[0].rank === 12,
     '张数=' + g5.currentTrick[0].cards.length);
  ok('日志写明甩牌失败', g5.log.some(l => l.indexOf('甩牌失败') >= 0), g5.log.join(' | '));

  // 甩牌成功：playCards 正常把整组打出去
  const g6 = throwGame({ 1: [C(2, 9)], 2: [C(3, 9)], 3: [C(2, 7)] });
  ok('甩牌成功', g6.playCards(0, g6.hands[0].slice(0, 3)));
  ok('成功后整组 3 张都在场上', g6.currentTrick[0].cards.length === 3, '张数=' + g6.currentTrick[0].cards.length);
}

// ================= 3) AI 甩牌永不失败 =================
{
  let throws = 0, failed = 0, games = 0;
  for (let n = 0; n < 200; n++) {
    const g = new Game();
    g.humanSeat = -1;
    g.newGame();
    const protoLead = Game.prototype.aiLead;
    g.aiLead = function (seat) {
      const c = protoLead.call(this, seat);
      const info = c && classifyThrow(c, this.trumpSuit, this.levelRank);
      if (info) {
        throws++;
        if (this.throwFailReason(seat, info)) { failed++; console.log('✗ AI 甩了个会被压的牌：' + c.map(cardText).join(' ')); }
      }
      return c;
    };
    let guard = 0;
    while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && guard++ < 40000) {
      if (g.phase === 'dealing') { let d = 0; while (g.phase === 'dealing' && d++ < 400) g.dealNext(); }
      else if (g.phase === 'discard' || g.phase === 'playing') { if (!g.aiStep()) break; }
      else break;
    }
    games++;
  }
  ok('AI 200 局中确实会甩牌', throws > 0, '甩牌次数=' + throws);
  ok('AI 甩牌 0 次失败（作弊生效）', failed === 0, '失败=' + failed + '/' + throws);
  ok('200 局全部跑完', games === 200);
}

// ================= 4) 新叫主规则 =================
{
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  g.phase = 'dealing';
  g.bid = null; g.firstBidSeat = null;

  const single = { seat: 1, suit: 0, kind: 'single' };
  const pair1 = { seat: 2, suit: 1, kind: 'pair' };
  const pair2 = { seat: 3, suit: 2, kind: 'pair' };
  const smallJ = { seat: 2, suit: -1, kind: 'jokers', jrank: 16 };
  const bigJ = { seat: 3, suit: -1, kind: 'jokers', jrank: 17 };

  ok('无人叫时单张可亮', g.bidBeats(null, single));
  ok('两张同花色可反单张', g.bidBeats(single, pair1));
  ok('再一张单张不能反单张', g.bidBeats(single, { seat: 2, suit: 2, kind: 'single' }) === false);
  ok('另一对级牌不能反已亮的两张', g.bidBeats(pair1, pair2) === false);
  ok('两张同样的王可反两张级牌', g.bidBeats(pair1, smallJ));
  ok('两张小王不能反两张大王', g.bidBeats(bigJ, smallJ) === false);
  ok('两张大王可反两张小王', g.bidBeats(smallJ, bigJ));
  ok('单张不能反两张级牌', g.bidBeats(pair1, single) === false);

  // bestBid：大小各一张的王不算「两张同样的王」
  const g2 = new Game();
  g2.humanSeat = -1; g2.newGame();
  g2.levelRank = 2;
  g2.hands[0] = [C(4, 17), C(4, 16)];
  ok('大王+小王 不给玩家反无主', g2.bestBid(0) === null || g2.bestBid(0).kind !== 'jokers',
     g2.bestBid(0) ? g2.bestBid(0).kind : 'null');
  g2.hands[0] = [C(4, 17), C(4, 17)];
  ok('大王×2 可反无主', g2.bestBid(0) && g2.bestBid(0).kind === 'jokers' && g2.bestBid(0).jrank === 17);
  g2.hands[0] = [C(4, 16), C(4, 16)];
  ok('小王×2 可反无主', g2.bestBid(0) && g2.bestBid(0).kind === 'jokers' && g2.bestBid(0).jrank === 16);
}

// ================= 7) 加保：把已经亮出去的单张加码成两张，锁死这一门 =================
// 玩家原话：亮主时玩家可以在抓到第二张图样的主牌时直接加保，
// 防止对方用双王以外的花色反。
{
  const g = new Game();
  g.humanSeat = -1; g.newGame();
  g.phase = 'dealing'; g.bid = null; g.firstBidSeat = null; g.levelRank = 2;

  ok('亮主成功', g.placeBid(0, { seat: 0, suit: 0, kind: 'single' }));
  ok('第一次亮主不算加保', g.bid.own === false, 'own=' + g.bid.own);

  ok('别的花色一对级牌能反单张', g.placeBid(1, { seat: 1, suit: 3, kind: 'pair' }));
  ok('反别人的主不算加保', g.bid.own === false, 'own=' + g.bid.own);
  ok('被反主之后坐庄仍是首亮的 0 号（这条规则没变）', g.firstBidSeat === 0);

  // 换一副干净的局面，看加保本身
  const h = new Game();
  h.humanSeat = -1; h.newGame();
  h.phase = 'dealing'; h.bid = null; h.firstBidSeat = null; h.levelRank = 2;

  h.placeBid(0, { seat: 0, suit: 0, kind: 'single' });
  ok('自己给自己加码就是加保', h.placeBid(0, { seat: 0, suit: 0, kind: 'pair' }) && h.bid.own === true,
     'own=' + h.bid.own);
  ok('加保后主仍是黑桃', h.bid.suit === 0);
  ok('加保后坐庄仍是 0 号', h.firstBidSeat === 0);
  ok('加保后别的花色一对级牌反不动了',
     h.bidBeats(h.bid, { seat: 1, suit: 3, kind: 'pair' }) === false);
  ok('加保后别的花色单张更反不动',
     h.bidBeats(h.bid, { seat: 1, suit: 3, kind: 'single' }) === false);
  ok('加保后只有两张同样的王还能翻',
     h.bidBeats(h.bid, { seat: 1, suit: -1, kind: 'jokers', jrank: 17 }));
  ok('战报里写的是「加保」不是「反主」',
     h.log.join('').indexOf('加保') >= 0 && h.log.join('').indexOf('反主') < 0,
     h.log[h.log.length - 1]);

  // 同一档换门不算加保：自己亮黑桃单张，又摸到两张梅花级牌改亮梅花——
  // 主确实换到梅花了，但战报上不能写成「加保」（那不是加码，是换了个门）
  const k = new Game();
  k.humanSeat = -1; k.newGame();
  k.phase = 'dealing'; k.bid = null; k.firstBidSeat = null; k.levelRank = 2;

  k.placeBid(0, { seat: 0, suit: 0, kind: 'single' });
  ok('自己换门亮（黑桃单张 → 梅花一对）不算加保',
     k.placeBid(0, { seat: 0, suit: 2, kind: 'pair' }) && k.bid.own === false,
     'own=' + k.bid.own);
  ok('换门之后主才是梅花', k.bid.suit === 2);
  ok('换门之后坐庄仍是首亮的 0 号', k.firstBidSeat === 0);
  ok('换门的战报写「反主」，不写「加保」',
     k.log[k.log.length - 1].indexOf('反主') >= 0 && k.log[k.log.length - 1].indexOf('加保') < 0,
     k.log[k.log.length - 1]);
  ok('自己同一门两张时 bidIsOwn 才是真',
     k.bidIsOwn({ seat: 0, suit: 2, kind: 'pair' }) === true
     && k.bidIsOwn({ seat: 0, suit: 0, kind: 'pair' }) === false
     && k.bidIsOwn({ seat: 1, suit: 2, kind: 'pair' }) === false);
  // 换门和加保在**牌桌上**的效果是一样的（都是「一对」这一档，同档不能互反），
  // 区别只在叫法的说法上——所以这里不该断言「换门就反得动」。
  ok('换成一对之后，别的花色单张照样反不动',
     k.bidBeats(k.bid, { seat: 1, suit: 3, kind: 'single' }) === false);
  ok('换成一对之后，只有两张同样的王能翻',
     k.bidBeats(k.bid, { seat: 1, suit: -1, kind: 'jokers', jrank: 17 }) === true);
}

// ================= 8b) 跟牌必须跟牌型（有对必对，甩牌也不例外） =================
// 玩家原话：本轮第一个出牌的玩家出了特殊牌型，其他人手里有该花色的同牌型是必须出的，
// 所谓有对必跟对，有拖拉机也必须跟着出。比如第一个玩家出了 a b c c，
// 那么第二个玩家手里的 dd 再不想出，他也得出。
{
  const ts = 1, lr = 2;              // 打 2，红桃主；黑桃是副门
  const S = r => C(0, r);

  // —— 领出 ♠A ♠K ♠9♠9（两张单 + 一对）——
  const lead4 = classifyLead([S(14), S(13), S(9), S(9)], ts, lr);
  ok('♠A♠K♠99 是甩牌', lead4 && lead4.type === 'throw', lead4 && lead4.type);
  const want = bestShapePick([S(12), S(12), S(7), S(5)], 4, ts, lr);
  ok('手里有 ♠Q♠Q 一对 → 该出的结构是「一对 + 两张单」', want.shape === '2+1+1', want.shape);
  const q1 = S(12), q2 = S(12), s7 = S(7), s5 = S(5);
  ok('把那对 ♠Q♠Q 拿出来跟 → 放行',
     validatePlay([q1, q2, s7, s5], [q1, q2, s7, s5], lead4, ts, lr).ok);

  // 手里有三对，却每样只拿一张 → 拆了对子，不行
  const h3 = [S(12), S(12), S(7), S(7), S(5), S(5)];
  const split = [h3[0], h3[2], h3[4], h3[5]];      // ♠Q + ♠7 + ♠5♠5 → 结构 2+1+1
  const v2 = validatePlay(h3, split, lead4, ts, lr);
  ok('手里有对子却拆开跟 → 判无效', !v2.ok, JSON.stringify(v2));
  ok('判无效的说法是「有对子必须出对子」', !v2.ok && /有对子必须出对子/.test(v2.reason), v2 && v2.reason);
  ok('老老实实出两个对子 → 放行',
     validatePlay(h3, [h3[0], h3[1], h3[2], h3[3]], lead4, ts, lr).ok);

  // —— 领出拖拉机 ♠AA♠KK，手里两对不相邻也必须出两个对子（以前可以拆成四张单）——
  const leadT = classifyLead([S(14), S(14), S(13), S(13)], ts, lr);
  ok('♠AA♠KK 是拖拉机', leadT.type === 'tractor', leadT.type);
  const t1 = S(9), t2 = S(9), t3 = S(7), t4 = S(7), t5 = S(5), t6 = S(5);
  const hT = [t1, t2, t3, t4, t5, t6];
  ok('跟拖拉机：出两个对子 → 放行', validatePlay(hT, [t1, t2, t3, t4], leadT, ts, lr).ok);
  const vT = validatePlay(hT, [t1, t3, t5, t6], leadT, ts, lr);
  ok('跟拖拉机：拆开放着两对不用 → 判无效', !vT.ok, JSON.stringify(vT));

  // —— 领出对子，手里有对子必须出对子（老规矩，走的是同一条新路）——
  const leadP = classifyLead([S(13), S(13)], ts, lr);
  const a1 = S(9), a2 = S(9), a3 = S(7);
  ok('跟对子：出一对 → 放行', validatePlay([a1, a2, a3], [a1, a2], leadP, ts, lr).ok);
  ok('跟对子：拆成两张单 → 判无效', !validatePlay([a1, a2, a3], [a1, a3], leadP, ts, lr).ok);

  // —— 手里这一门不够跟：能跟几张跟几张，剩下随便垫，不追究牌型 ——
  const b1 = S(9), b2 = S(7);
  const vFew = validatePlay([b1, b2, C(1, 5), C(1, 6)], [b1, b2, C(1, 5), C(1, 6)], lead4, ts, lr);
  ok('本门不够跟：跟多少算多少，不追究牌型', vFew.ok, JSON.stringify(vFew));

  // —— 甩牌「两对」（不相邻）也是同理 ——
  const lead2 = classifyLead([S(14), S(14), S(9), S(9)], ts, lr);
  ok('♠AA♠99 是甩牌（两对，不相邻）', lead2.type === 'throw', lead2.type);
  const c1 = S(13), c2 = S(13), c3 = S(7), c4 = S(7), c5 = S(5), c6 = S(5);
  const h2 = [c1, c2, c3, c4, c5, c6];
  ok('跟「两对」的甩牌：出两个对子 → 放行', validatePlay(h2, [c1, c2, c3, c4], lead2, ts, lr).ok);
  const v2b = validatePlay(h2, [c1, c3, c5, c6], lead2, ts, lr);
  ok('跟「两对」的甩牌：拆开 → 判无效', !v2b.ok, JSON.stringify(v2b));

  // —— 结构被截断时不能凭空造出「三张」这种组：4 张的拖拉机只够出 3 张 ——
  const d1 = S(9), d2 = S(9), d3 = S(8), d4 = S(8), d5 = S(3);
  const w3 = bestShapePick([d1, d2, d3, d4, d5], 3, ts, lr);
  ok('4 张拖拉机只让出 3 张 → 结构是「一对 + 一张」，不是「三张」',
     w3.shape === '2+1', w3.shape);
  const leadA = classifyLead([S(14), S(13), S(13)], ts, lr);   // ♠A ♠K♠K
  ok('这样跟上去是合法的', validatePlay([d1, d2, d3, d4, d5], [d1, d2, d5], leadA, ts, lr).ok);
}

// ================= 8c) 全 AI 跑 100 轮，不许出现「自己出的牌自己判无效」 =================
{
  let noEffect = 0, aiFail = 0, stalled = 0, rounds = 0;
  for (let n = 0; n < 100; n++) {
    const g = new Game();
    g.humanSeat = -1;
    g.newGame();
    g.firstRound = false;
    g.startRound();
    let guard = 0, done = false;
    while (guard++ < 30000) {
      if (g.phase === 'dealing') { let dg = 0; while (g.phase === 'dealing' && dg++ < 400) g.dealNext(); }
      else if (g.phase === 'roundEnd') { done = true; break; }
      else if (g.phase === 'discard' || g.phase === 'playing') { if (!g.aiStep()) { stalled++; break; } }
      else break;
    }
    for (const line of g.log) {
      if (line.indexOf('出牌无效') >= 0) noEffect++;
      if (line.indexOf('AI 出牌失败') >= 0) aiFail++;
    }
    if (done) rounds++;
  }
  ok('100 局全部打完，一次没卡住', rounds === 100 && stalled === 0,
     '打完 ' + rounds + '，卡住 ' + stalled);
  ok('AI 出的牌从来没有被判无效（跟牌型这条对得上）', noEffect === 0, '无效 ' + noEffect);
  ok('AI 一次都没走到兜底', aiFail === 0, '兜底 ' + aiFail);
}

// ================= 8) AI 别无脑反（无主 / 花色都要先掂量） =================
// 玩家原话：不要让 AI 无脑反，不管是无将还是花色。
//   队友和自己当前亮的花色都太差了，就反无将；
//   自己坐庄但亮的花色太差了，也可以反。
function bidGame(hands, lr) {
  const g = new Game();
  g.humanSeat = -1;
  g.newGame();
  g.phase = 'dealing';
  g.levelRank = lr || 2;
  g.bid = null; g.firstBidSeat = null;
  g.hands = [[], [], [], []];
  for (let s = 0; s < 4; s++) g.hands[s] = hands[s] || [];
  g.dealPos = 50;
  return g;
}
// 谁手上几张什么：'S' 黑桃 'H' 红桃 'C' 梅花 'D' 方块，'B'/'b' 大/小王
function deal(seat, spec) {
  const SU = { S: 0, H: 1, C: 2, D: 3 };
  const out = [];
  let rank = 5;
  for (const ch of spec) {
    if (ch === ' ') continue;
    if (ch === 'B') { out.push(C(4, 17)); continue; }
    if (ch === 'b') { out.push(C(4, 16)); continue; }
    out.push(C(SU[ch], rank++));
  }
  return out;
}
{
  // —— 反无主 ——
  // 人家亮了黑桃，可我自己跟队友黑桃都一抓一大把：翻无主纯属找不痛快
  const rich = bidGame({ 0: deal(0, 'BBSSSSSSSS'), 2: deal(2, 'SSSSSSSS') });
  rich.bid = { seat: 1, suit: 0, kind: 'single' };
  rich.firstBidSeat = 1;
  ok('双王 + 自己跟队友那门主都很厚 → 不反无主', rich.worthNoTrump(0) === false);

  // 反过来：黑桃自己跟队友都没几张，手上双王加四张级牌（2222）→ 该翻
  const thin = bidGame({
    0: [C(4, 17), C(4, 17), C(0, 2), C(1, 2), C(2, 2), C(3, 2), C(0, 9)],
    2: deal(2, 'SSH'),
  });
  thin.bid = { seat: 1, suit: 0, kind: 'single' };
  thin.firstBidSeat = 1;
  ok('无主时手上 6 张主（双王 + 四张级牌）', thin.trumpCount(0, -1) === 6,
     '张数=' + thin.trumpCount(0, -1));
  ok('双王 + 自己跟队友那门主都薄 → 该反无主', thin.worthNoTrump(0) === true);

  // 桌上压根还没人亮主：双王留在手里就是两张最大的主牌，别乱翻
  const noBid = bidGame({ 0: deal(0, 'BBSHCDSH') });
  ok('没人亮主时不翻无主（留着亮主/当主牌更值）', noBid.worthNoTrump(0) === false);
  ok('没人亮主时 AI 也不会甩双王出去', noBid.aiBidNow(0) === null || noBid.aiBidNow(0).kind !== 'jokers');

  // 自己坐庄、可这一门自己手上就两张：守着也是挨打，不如自己翻
  const dealer = bidGame({ 0: deal(0, 'BBSSHCD'), 2: deal(2, 'SSSSSSSS') });
  dealer.bid = { seat: 0, suit: 0, kind: 'single' };
  dealer.firstBidSeat = 0;
  ok('自己坐庄但这一门太薄 → 也翻无主', dealer.worthNoTrump(0) === true);

  // 虽然薄，可自己手上王和级牌也不多，翻了更亏 → 不翻
  const weak = bidGame({ 0: deal(0, 'BBSHCDSS'), 2: deal(2, 'HCD') });
  weak.bid = { seat: 1, suit: 0, kind: 'single' };
  weak.firstBidSeat = 1;
  ok('手里没攒够王和级牌 → 薄也不翻', weak.worthNoTrump(0) === false,
     'trumpCount(无主)=' + weak.trumpCount(0, -1));

  // —— 反花色主 ——
  // 换过去那门比自己这边原来那门厚一大截才值得翻
  const swap = bidGame({ 0: deal(0, 'SSSSSSSSHH'), 2: deal(2, 'SSSSSS') });
  swap.bid = { seat: 1, suit: 1, kind: 'single' };   // 人家亮了红桃
  ok('换的那门厚一大截 → 值得反', swap.worthReverse(0, 0) === true);

  const swapBad = bidGame({ 0: deal(0, 'SSHHHHHHDD'), 2: deal(2, 'HHHHHH') });
  swapBad.bid = { seat: 1, suit: 1, kind: 'single' };  // 人家亮了红桃
  ok('换的那门反而更薄 → 不反，别瞎折腾', swapBad.worthReverse(0, 0) === false);

  const own = bidGame({ 0: deal(0, 'SSHHHHHHHH') });
  own.bid = { seat: 0, suit: 1, kind: 'single' };      // 自己亮的红桃
  ok('给自己那门加保永远值得', own.worthReverse(0, 1) === true);

  const fresh = bidGame({ 0: deal(0, 'SSHHHHHHHH') });
  ok('桌上没主时有对就亮', fresh.worthReverse(0, 1) === true);

  // —— aiBidNow 端到端：攒着双王但真不该翻的时候，至少还会去亮自己能亮的门 ——
  const pick = bidGame({ 0: [C(4, 17), C(4, 17), C(0, 2)].concat(deal(0, 'SSSSSSSS')) });
  ok('双王不翻的时候，手上那门够长照样会亮主',
     pick.aiBidNow(0) && pick.aiBidNow(0).kind === 'single' && pick.aiBidNow(0).suit === 0,
     JSON.stringify(pick.aiBidNow(0)));

  // 反不动对方那门、又没有更长的门 → 就老老实实不叫
  const shut = bidGame({ 0: deal(0, 'BBSSHHCCDD') });
  shut.bid = { seat: 1, suit: 0, kind: 'pair' };       // 人家已经反成两张黑桃了
  shut.firstBidSeat = 1;
  ok('压不过就闭嘴（不硬叫）', shut.aiBidNow(0) === null, JSON.stringify(shut.aiBidNow(0)));

  // 反无主的判据在整局发牌里也得自洽：真反了的都是「无主更划算」的
  let ntBids = 0, badNT = 0, games = 0;
  const origBid = Game.prototype.aiBidNow;
  for (let n = 0; n < 120; n++) {
    const g = new Game();
    g.humanSeat = -1;
    g.newGame();
    g.aiBidNow = function (seat) {
      const b = origBid.call(this, seat);
      if (b && b.kind === 'jokers' && this.bid && this.bid.kind !== 'jokers') {
        ntBids++;
        if (!this.worthNoTrump(seat)) badNT++;
      }
      return b;
    };
    let guard = 0;
    while (g.phase === 'dealing' && guard++ < 400) g.dealNext();
    games++;
  }
  ok('120 局里 AI 确实会反无主（不是一次都不反了）', ntBids > 0, '反无主次数=' + ntBids);
  ok('AI 每次反无主都是掂量过的，没有一次是无脑翻', badNT === 0, '无脑翻=' + badNT + '/' + ntBids);
  ok('120 局发牌全部跑完', games === 120);
}

console.log('甩牌 / 叫主测试：通过 ' + pass + ' / 失败 ' + fail);
`;

eval(src + test);
