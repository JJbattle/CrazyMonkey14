// cards.js —— 蜘蛛纸牌：牌模型 + 牌组生成 + 确定性洗牌 + 初始发牌（纯逻辑，不碰 UI）
//
// 两副标准扑克（104 张，无大小王）。花色：0♠ 1♥ 2♣ 3♦。
// rank：1=A … 11=J 12=Q 13=K（K 最大、A 最小，收牌方向 K→A）。

(function () {
  'use strict';

  const SUITS = ['♠', '♥', '♣', '♦'];
  // 红黑对比：黑桃/梅花黑，红桃/方片红（照顾色觉异常，不只用颜色）
  const SUIT_COLOR = ['#1a1a1a', '#c0392b', '#1a1a1a', '#c0392b'];
  const RANK_TEXT = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  function rankText(r) { return RANK_TEXT[r] || String(r); }

  // 三档难度：简单=1 花色，普通=2 花色，困难=4 花色
  const DIFFICULTIES = {
    0: { name: '简单', suitDesc: '1花色', suits: [0], copies: 8 },
    1: { name: '普通', suitDesc: '2花色', suits: [0, 1], copies: 4 },
    2: { name: '困难', suitDesc: '4花色', suits: [0, 1, 2, 3], copies: 2 },
  };

  // 确定性 PRNG（mulberry32）：相同 seed 得到完全相同的随机序列
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 建一副 104 张（无大小王）。卡面字段：id 唯一、s 花色、r 点数、u 是否正面。
  function buildDeck(difficulty) {
    const d = DIFFICULTIES[difficulty];
    const deck = [];
    for (const s of d.suits) {
      for (let r = 1; r <= 13; r++) {
        for (let c = 0; c < d.copies; c++) {
          deck.push({ s: s, r: r, u: 0 });
        }
      }
    }
    return deck; // 104 张
  }

  // Fisher-Yates 洗牌（确定性，用 seed 初始化 PRNG）
  function shuffle(deck, seed) {
    const rng = mulberry32(seed);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // 初始发牌：前 4 列 6 张、后 6 列 5 张（共 54 张），每列最底一张正面朝上；
  // 剩下 50 张进牌库（背面）。
  function dealInitial(deck) {
    const tableau = [[], [], [], [], [], [], [], [], [], []];
    let idx = 0;
    for (let col = 0; col < 10; col++) {
      const n = col < 4 ? 6 : 5;
      for (let i = 0; i < n; i++) {
        const c = deck[idx++];
        c.u = (i === n - 1) ? 1 : 0;
        tableau[col].push(c);
      }
    }
    const stock = deck.slice(idx);
    return { tableau, stock };
  }

  const Cards = {
    SUITS, SUIT_COLOR, rankText, DIFFICULTIES,
    mulberry32, buildDeck, shuffle, dealInitial,
  };

  globalThis.Cards = Cards;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cards;
})();
