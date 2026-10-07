'use strict';
// 把浏览器版引擎（cards.js + game.js）拼进同一个 eval 作用域，再吐出一份符号给 Node 用。
// 这两个文件是经典 <script> 全局脚本、没有 module.exports，tests/ 里早就是这套加载法在 Node 里跑它们。
const fs = require('fs');
const path = require('path');

const cards = fs.readFileSync(path.join(__dirname, '..', 'js', 'cards.js'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');

const exportsExpr = '; ({ Game, SEAT_CN, MAX_LEVEL, levelName, nextLevel, HUMAN_NAME, CAT_NAME, PLAYER_POOL, AI_PROFILES, NAME_PROFILE, buildDeck, shuffle, sortHand, cardText, pointValue, isTrump, power, SUITS, SUIT_CN, RANK_CN, rankName })';

module.exports = eval(cards + '\n' + game + '\n' + exportsExpr);
