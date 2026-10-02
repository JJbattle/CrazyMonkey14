'use strict';
// 《拖拉机》(升级/双升) —— 纸牌模型与牌型规则

const SUITS = ['♠', '♥', '♣', '♦'];
const SUIT_CN = ['黑桃', '红桃', '梅花', '方块'];
// rank: 2..14 (2~10, J=11, Q=12, K=13, A=14), 16=小王, 17=大王
const RANK_CN = {11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王'};

function rankName(r) { return RANK_CN[r] || String(r); }
function cardText(c) { return c.rank >= 16 ? RANK_CN[c.rank] : SUITS[c.suit] + rankName(c.rank); }

// 一副牌的 54 种唯一牌（无 uid，仅用于 AI 记牌推算），两副即每种 2 张
const UNIQUE_DECK = (() => {
  const a = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) a.push({ suit: s, rank: r });
  a.push({ suit: 4, rank: 16 });
  a.push({ suit: 4, rank: 17 });
  return a;
})();

function buildDeck() {
  const deck = [];
  let uid = 0;
  for (let d = 0; d < 2; d++) {
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ uid: uid++, suit: s, rank: r });
    deck.push({ uid: uid++, suit: 4, rank: 16 }); // 小王
    deck.push({ uid: uid++, suit: 4, rank: 17 }); // 大王
  }
  return deck;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isJoker = c => c.rank >= 16;

// 是否主牌：王 / 级牌 / 主花色
function isTrump(c, trumpSuit, levelRank) {
  if (isJoker(c)) return true;
  if (c.rank === levelRank) return true;
  return trumpSuit != null && c.suit === trumpSuit;
}

// 单张强度（越大越强），用于同门排序与比较
function power(c, trumpSuit, levelRank) {
  if (c.rank === 17) return 1000;      // 大王
  if (c.rank === 16) return 990;       // 小王
  if (c.rank === levelRank) return c.suit === trumpSuit ? 980 : 970; // 主级牌 > 副级牌
  if (trumpSuit != null && c.suit === trumpSuit) return 900 + c.rank; // 主花色 A..2
  return c.rank;                        // 副牌
}

// 分牌：5=5分, 10=10分, K=10分
function pointValue(c) {
  if (c.rank === 5) return 5;
  if (c.rank === 10 || c.rank === 13) return 10;
  return 0;
}

const isSame = (a, b) => a.suit === b.suit && a.rank === b.rank;

function sortHand(cards, trumpSuit, levelRank) {
  return cards.slice().sort((a, b) => {
    const at = isTrump(a, trumpSuit, levelRank), bt = isTrump(b, trumpSuit, levelRank);
    if (at !== bt) return at ? -1 : 1;
    if (at) return power(b, trumpSuit, levelRank) - power(a, trumpSuit, levelRank);
    if (a.suit !== b.suit) return a.suit - b.suit;
    return b.rank - a.rank;
  });
}

// 判断一组牌是否构成合法牌型
// 返回 { type:'single'|'pair'|'tractor', key, suit, isTrump, len } 或 null
function classify(cards, trumpSuit, levelRank) {
  const n = cards.length;
  if (n === 0) return null;
  if (n === 1) {
    const c = cards[0];
    return { type: 'single', key: power(c, trumpSuit, levelRank), suit: c.suit, isTrump: isTrump(c, trumpSuit, levelRank), len: 1 };
  }
  if (n % 2 !== 0) return null;
  if (n === 2 && isSame(cards[0], cards[1])) {
    const c = cards[0];
    return { type: 'pair', key: power(c, trumpSuit, levelRank), suit: c.suit, isTrump: isTrump(c, trumpSuit, levelRank), len: 1 };
  }
  return tractorInfo(cards, trumpSuit, levelRank);
}

// 拖拉机（连对）：n>=2 个相邻点数的对子，不含王/级牌，每点数恰好一对
function tractorInfo(cards, trumpSuit, levelRank) {
  const n = cards.length;
  if (n < 4 || n % 2 !== 0) return null;
  const c0 = cards[0];
  if (isJoker(c0) || c0.rank === levelRank) return null;
  const suit = c0.suit;
  for (const c of cards) if (c.suit !== suit || isJoker(c) || c.rank === levelRank) return null;
  const cnt = {};
  for (const c of cards) cnt[c.rank] = (cnt[c.rank] || 0) + 1;
  const ranks = Object.keys(cnt).map(Number).sort((a, b) => b - a);
  if (ranks.length !== n / 2) return null;
  for (let i = 0; i < ranks.length; i++) {
    if (cnt[ranks[i]] !== 2) return null;
    if (i > 0 && ranks[i - 1] - ranks[i] !== 1) return null;
  }
  const top = cards.find(c => c.rank === ranks[0]);
  return { type: 'tractor', key: power(top, trumpSuit, levelRank), suit, isTrump: isTrump(top, trumpSuit, levelRank), len: ranks.length };
}

// ---------- 甩牌 ----------
// 把同门的一手牌拆成「组」：先抽最长拖拉机，再抽对子，余下单张
function decomposeThrow(cards, trumpSuit, levelRank) {
  const comps = decomposeComps(cards, trumpSuit, levelRank);
  return comps && comps.length >= 2 ? comps : null;
}

// 把同门的一手牌拆成「组」：useTractor 时先抽最长拖拉机，否则只按对子/单张分
function decomposeComps(cards, trumpSuit, levelRank, useTractor) {
  if (!cards || !cards.length) return null;
  const cat = catOf(cards[0], trumpSuit, levelRank);
  for (const c of cards) if (catOf(c, trumpSuit, levelRank) !== cat) return null;

  let rest = cards.slice();
  const comps = [];
  if (useTractor !== false) {
    for (;;) {                                // 1) 最长拖拉机
      const t = longestTractorFrom(rest, trumpSuit, levelRank);
      if (!t) break;
      comps.push(t);
      const ids = new Set(t.map(c => c.uid));
      rest = rest.filter(c => !ids.has(c.uid));
    }
  }
  for (;;) {                                  // 2) 对子
    const p = lowestPairFrom(rest, trumpSuit, levelRank);
    if (!p) break;
    comps.push(p);
    const ids = new Set(p.map(c => c.uid));
    rest = rest.filter(c => !ids.has(c.uid));
  }
  for (const c of rest) comps.push([c]);      // 3) 单张
  return comps;
}

// 一手牌的「牌型」：各组张数排序后拼起来的字符串，如 '1+2'。
// 返回所有可能的拆法（拼拖拉机 / 不拼拖拉机），用于判断将吃是不是「同样的牌型」
function shapeVariants(cards, trumpSuit, levelRank) {
  const out = new Set();
  const key = comps => comps.map(c => c.length).sort((a, b) => a - b).join('+');
  for (const useT of [true, false]) {
    const comps = decomposeComps(cards, trumpSuit, levelRank, useT);
    if (comps) out.add(key(comps));
  }
  return out;
}

// 一门牌「该怎么出」：尽量凑拖拉机、再凑对子，取够 need 张。
// 返回各组张数拼成的结构（如 '2+1'）和对应的牌（picks）。
//
// **校验和 AI 都走这一个函数**——两边要是各算各的，就会出现
// 「AI 出的牌被判无效」这种自己跟自己打架的事。
//
// 截断时有个坑：对子和拖拉机都是偶数张，凑不够一整组时多出来的那半截
// 只能按单张算。所以 4 张的拖拉机只让出 3 张时，结构是「一对 + 一张」，
// 不存在「三张」这种组（甩牌里也一样，组只有 1 张、2 张和 ≥4 张三种）。
function bestShapePick(pool, need, trumpSuit, levelRank) {
  const comps = decomposeComps(pool, trumpSuit, levelRank);
  if (!comps) return null;
  const sizes = [], picks = [];
  let left = need;
  for (const c of comps) {
    if (left <= 0) break;
    let off = 0;
    while (off < c.length && left > 0) {
      let take = Math.min(c.length - off, left);
      if (take < c.length - off && take % 2 === 1) take -= 1;
      if (take <= 0) take = 1;
      sizes.push(take);
      picks.push(...c.slice(off, off + take));
      off += take;
      left -= take;
    }
  }
  return { shape: sizes.join('+'), picks };
}

// 一手牌实际摆成了什么结构（跟 bestShapePick 用同一套拆法，才能对得上）
function shapeOf(cards, trumpSuit, levelRank) {
  const comps = decomposeComps(cards, trumpSuit, levelRank);
  return comps ? comps.map(c => c.length).join('+') : null;
}

// 这一门按「有对必对 / 有拖拉机必跟」该摆成什么结构；这几张牌对得上吗
function shapeMatches(pool, played, need, trumpSuit, levelRank) {
  const best = bestShapePick(pool, need, trumpSuit, levelRank);
  const got = shapeOf(played, trumpSuit, levelRank);
  return !best || !got || best.shape === got;
}

// 在一手牌里找最长的一条拖拉机（同花色、非王、非级牌）
function longestTractorFrom(cards, trumpSuit, levelRank) {
  const bySuit = {};
  for (const c of cards) {
    if (isJoker(c) || c.rank === levelRank) continue;
    (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
  }
  let best = null;
  for (const s in bySuit) {
    const g = {};
    for (const c of bySuit[s]) (g[c.rank] = g[c.rank] || []).push(c);
    const ranks = Object.keys(g).map(Number).filter(r => g[r].length >= 2).sort((a, b) => a - b);
    let cur = [], bestRun = [];
    for (let i = 0; i < ranks.length; i++) {
      if (i > 0 && ranks[i] - ranks[i - 1] === 1) cur.push(ranks[i]); else cur = [ranks[i]];
      if (cur.length > bestRun.length) bestRun = cur.slice();
    }
    if (bestRun.length >= 2 && (!best || bestRun.length > best.length)) {
      const out = [];
      for (const r of bestRun) out.push(...g[r].slice(0, 2));
      best = out;
    }
  }
  return best;
}

function lowestPairFrom(cards, trumpSuit, levelRank) {
  const g = {};
  for (const c of cards) {
    const k = c.suit + '-' + c.rank;
    (g[k] = g[k] || []).push(c);
  }
  let best = null, bestP = Infinity;
  for (const k in g) {
    if (g[k].length >= 2) {
      const p = power(g[k][0], trumpSuit, levelRank);
      if (p < bestP) { bestP = p; best = g[k].slice(0, 2); }
    }
  }
  return best;
}

// 识别「甩牌」：同门若干组，至少 2 组
function classifyThrow(cards, trumpSuit, levelRank) {
  const comps = decomposeThrow(cards, trumpSuit, levelRank);
  if (!comps) return null;
  const cat = catOf(cards[0], trumpSuit, levelRank);
  const isT = cat === 'trump';
  let key = -1;
  for (const comp of comps) {
    const p = Math.max(...comp.map(x => power(x, trumpSuit, levelRank)));
    if (p > key) key = p;
  }
  return {
    type: 'throw', comps, cat, isTrump: isT,
    suit: isT ? null : cards[0].suit,
    len: cards.length, key,
  };
}

// 领出用：先按单张/对子/拖拉机识别，再试甩牌
function classifyLead(cards, trumpSuit, levelRank) {
  return classify(cards, trumpSuit, levelRank) || classifyThrow(cards, trumpSuit, levelRank);
}

// cards 里能不能抽出「各组张数为 wantSizes」的牌（wantSizes 从大到小），用于估算将吃风险
function canTakeShape(cards, wantSizes, trumpSuit, levelRank) {
  let pool = cards.slice();
  for (const size of wantSizes) {
    if (size === 1) {
      if (!pool.length) return false;
      pool.shift();
      continue;
    }
    if (size === 2) {
      const p = lowestPairFrom(pool, trumpSuit, levelRank);
      if (!p) return false;
      const ids = new Set(p.map(c => c.uid));
      pool = pool.filter(c => !ids.has(c.uid));
      continue;
    }
    const t = longestTractorFrom(pool, trumpSuit, levelRank);
    if (!t || t.length < size) return false;
    const ids = new Set(t.slice(0, size).map(c => c.uid));
    pool = pool.filter(c => !ids.has(c.uid));
  }
  return true;
}

// 一组牌是否被「同门更强的组合」压住（byCards 为对手手牌）
function compBeaten(comp, cat, byCards, trumpSuit, levelRank) {
  const ts = trumpSuit, lr = levelRank;
  const mine = classify(comp, ts, lr);
  if (!mine) return null;
  const pool = byCards.filter(c => catOf(c, ts, lr) === cat);
  if (!pool.length) return null;

  if (mine.type === 'single') {
    const p = power(comp[0], ts, lr);
    for (const c of pool) if (power(c, ts, lr) > p) return c;
    return null;
  }
  if (mine.type === 'pair') {
    const g = {};
    for (const c of pool) { const k = c.suit + '-' + c.rank; (g[k] = g[k] || []).push(c); }
    const p = power(comp[0], ts, lr);
    for (const k in g) if (g[k].length >= 2 && power(g[k][0], ts, lr) > p) return g[k][0];
    return null;
  }
  // 拖拉机：**不算被压**。相邻的 AABB 可以一直甩，不理会别人是否有更大的
  // 对子(CC) 或更大的连对(CCDD)
  return null;
}

// 跟这手领出牌应该出几张
function needOf(lead) {
  if (!lead) return 0;
  if (lead.type === 'single') return 1;
  if (lead.type === 'pair') return 2;
  if (lead.type === 'throw') return lead.len;
  return lead.len * 2;
}

// 牌的门类：'trump' 或 'suit:N'
function catOf(c, trumpSuit, levelRank) {
  return isTrump(c, trumpSuit, levelRank) ? 'trump' : 'suit:' + c.suit;
}

// 判定一圈的赢家
// plays: [{ seat, cards }]，plays[0] 为领出
function resolveTrick(plays, trumpSuit, levelRank) {
  const lead = classifyLead(plays[0].cards, trumpSuit, levelRank);
  // 甩牌：可以被**将吃**，但必须用**同样的牌型**整手主牌来毙
  // （甩 ♠A ♠Q♠Q 是三张「1 单 + 1 对」，就得用 3 张主牌摆成「1 单 + 1 对」才毙得掉）
  if (lead.type === 'throw') {
    const want = shapeVariants(plays[0].cards, trumpSuit, levelRank);
    let winner = 0, best = -Infinity;
    plays.forEach((p, i) => {
      if (i === 0) return;
      if (!p.cards.every(c => isTrump(c, trumpSuit, levelRank))) return;  // 必须整手都是主
      let hit = false;
      for (const k of shapeVariants(p.cards, trumpSuit, levelRank)) if (want.has(k)) { hit = true; break; }
      if (!hit) return;                                                   // 牌型不一样，毙不了
      const k2 = Math.max(...p.cards.map(c => power(c, trumpSuit, levelRank)));
      if (k2 > best) { best = k2; winner = i; }
    });
    return winner;
  }
  const leadCat = lead.isTrump ? 'trump' : 'suit:' + lead.suit;
  let winner = 0, best = -Infinity;
  plays.forEach((p, i) => {
    const combo = classify(p.cards, trumpSuit, levelRank);
    if (!combo || combo.type !== lead.type || combo.len !== lead.len) return;
    const cat = combo.isTrump ? 'trump' : 'suit:' + combo.suit;
    let key;
    if (cat === leadCat) key = combo.key;
    else if (cat === 'trump') key = 10000 + combo.key; // 将吃
    else return;
    if (key > best) { best = key; winner = i; }
  });
  return winner;
}

// 某门类下是否含对子
function hasPairIn(cards, cat, trumpSuit, levelRank) {
  const cnt = {};
  for (const c of cards) if (catOf(c, trumpSuit, levelRank) === cat) {
    const k = c.suit + '-' + c.rank;
    cnt[k] = (cnt[k] || 0) + 1;
  }
  return Object.values(cnt).some(v => v >= 2);
}

// 某门类下最长连对（以“对”计）。必须同花色——主门含 4 种花色，不能跨花色连对
function longestTractorIn(cards, cat, trumpSuit, levelRank) {
  const same = cards.filter(c => catOf(c, trumpSuit, levelRank) === cat && !isJoker(c) && c.rank !== levelRank);
  const bySuit = {};
  for (const c of same) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
  let best = 0;
  for (const s in bySuit) {
    const g = {};
    for (const c of bySuit[s]) g[c.rank] = (g[c.rank] || 0) + 1;
    const ranks = Object.keys(g).map(Number).filter(r => g[r] >= 2).sort((a, b) => a - b);
    let cur = 0, prev = null;
    for (const r of ranks) {
      if (prev != null && r - prev === 1) cur++; else cur = 1;
      if (cur > best) best = cur;
      prev = r;
    }
  }
  return best;
}

function hasTractorIn(cards, cat, len, trumpSuit, levelRank) {
  return longestTractorIn(cards, cat, trumpSuit, levelRank) >= len;
}

function catName(cat) {
  if (cat === 'trump') return '主牌';
  return SUIT_CN[Number(cat.slice(5))];
}

// 校验出牌是否合法。lead 为 classify(领出牌) 的结果，或 null 表示领出。
// hand 为当前手牌（用于判断“有门必跟”）。
function validatePlay(hand, played, lead, trumpSuit, levelRank) {
  // 领出：必须构成合法牌型（单张 / 对子 / 拖拉机 / 甩牌）
  if (!lead) {
    if (!classifyLead(played, trumpSuit, levelRank)) return { ok: false, reason: '不是合法的牌型（单张 / 对子 / 拖拉机 / 甩牌）' };
    return { ok: true };
  }
  if (lead.type === 'throw' && played.length !== lead.len) return { ok: false, reason: '出牌张数应为 ' + lead.len + ' 张' };

  const need = lead.type === 'single' ? 1
             : (lead.type === 'pair' ? 2
             : (lead.type === 'throw' ? lead.len : lead.len * 2));
  if (played.length !== need) return { ok: false, reason: '出牌张数应为 ' + need + ' 张' };

  const leadCat = lead.isTrump ? 'trump' : 'suit:' + lead.suit;
  const haveCat = hand.filter(c => catOf(c, trumpSuit, levelRank) === leadCat).length;
  if (haveCat === 0) return { ok: true }; // 无此门：任意贴牌或将吃，不要求牌型

  // 有这门就必须尽量跟：本门不够时，能跟几张跟几张，其余可任意垫
  const needCat = Math.min(haveCat, need);
  const playedCat = played.filter(c => catOf(c, trumpSuit, levelRank) === leadCat).length;
  if (playedCat !== needCat) {
    return { ok: false, reason: '有' + catName(leadCat) + '，必须用 ' + needCat + ' 张' + catName(leadCat) };
  }
  if (playedCat < need) return { ok: true };

  // 本门够跟：那「组」也得跟上——有对子必须出对子，有拖拉机必须出拖拉机，
  // **甩牌一样跑不掉**（领出 a b c c，你就得拿「两张单 + 一对」来跟）。
  // 判法：把手里这一门**最多能摆出的结构**算出来，跟你实际出的比；
  // 不一样就说明本门里还有对子/拖拉机没舍得下。
  const pool = hand.filter(c => catOf(c, trumpSuit, levelRank) === leadCat);
  const best = bestShapePick(pool, need, trumpSuit, levelRank);
  const got = shapeOf(played, trumpSuit, levelRank);
  if (best && got && best.shape !== got) {
    const g = best.shape.split('+').map(Number);
    return {
      ok: false,
      reason: g.some(n => n >= 4) ? '有同样长度的拖拉机必须出'
            : (g.some(n => n === 2) ? '有对子必须出对子' : '得按领出的牌型跟'),
    };
  }
  return { ok: true };
}
