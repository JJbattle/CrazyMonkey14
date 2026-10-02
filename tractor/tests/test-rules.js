const fs = require('fs');
const base = __dirname + '/../js/';
const src = fs.readFileSync(base + 'cards.js', 'utf8') + '\n' + fs.readFileSync(base + 'game.js', 'utf8');

const test = `
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log('✗ ' + name); } }

const C = (rank, suit) => ({ uid: Math.random(), rank, suit });

// ---- 1) 牌型识别 ----
ok('单张', classify([C(5,0)], 1, 3) && classify([C(5,0)], 1, 3).type === 'single');
ok('对子', classify([C(5,0), C(5,0)], 1, 3).type === 'pair');
ok('连对(拖拉机)', classify([C(5,0),C(5,0),C(6,0),C(6,0)], 1, 3).type === 'tractor');
ok('同点数两张不同花色不算对', classify([C(5,0), C(5,1)], 1, 3) === null);
ok('大小王不是对子', classify([C(16,4), C(17,4)], 1, 3) === null);

// ---- 2) 跟牌规则 ----
const trump = 1, level = 3;   // 主牌=红桃, 级牌=3
const lead = classify([C(5,0), C(5,0)], trump, level);   // 领出 黑桃5 一对

// 2a. 无此门：可任意甩 2 张（曾经误判为"不是合法牌型"）
let h = [C(7,2), C(8,3), C(9,1)];
ok('无此门可任意贴牌', validatePlay(h, [C(7,2), C(8,3)], lead, trump, level).ok);

// 2b. 只有 1 张此门：必须出它 + 任意一张（曾经误判为"必须跟黑桃"）
h = [C(7,0), C(8,3), C(9,1)];
ok('此门只有1张时出1张+垫牌', validatePlay(h, [C(7,0), C(8,3)], lead, trump, level).ok);

// 2c. 有 2 张此门但非对子，且手里没有对子：可以出这两张
h = [C(7,0), C(8,0), C(9,1)];
ok('有对子要求但无对子可乱出', validatePlay(h, [C(7,0), C(8,0)], lead, trump, level).ok);

// 2d. 此门有对子却不打对子：非法
h = [C(7,0), C(7,0), C(8,0)];
ok('有对子必须出对子', !validatePlay(h, [C(7,0), C(8,0)], lead, trump, level).ok);

// 2e. 张数不对：非法
ok('张数不对被拒', !validatePlay([C(7,0), C(8,0)], [C(7,0)], lead, trump, level).ok);

// 2f. 手里有 2 张这门，却只跟 1 张：非法
ok('有这门必须跟这门', !validatePlay([C(7,0), C(8,0), C(2,2)], [C(7,0), C(2,2)], lead, trump, level).ok);

// ---- 3) 跨花色"假拖拉机"（主门含 4 花色，不能跨花色连对） ----
// 手牌：黑桃5黑桃5 + 红桃6红桃6 —— 不同花色，不构成拖拉机
h = [C(5,0),C(5,0),C(6,1),C(6,1)];
ok('跨花色不算拖拉机(有拖拉机必出的判定)', !hasTractorIn(h, 'trump', 2, trump, level));

// ---- 4) 大小与将吃 ----
ok('大王大于小王', power(C(17,4), trump, level) > power(C(16,4), trump, level));
ok('主级牌大于副级牌',
   power(C(3,1), trump, level) > power(C(3,0), trump, level));
{
  const plays = [{ seat: 0, cards: [C(14,0)] }, { seat: 1, cards: [C(2,1)] }]; // 副门A vs 主2
  ok('将吃能赢副门A', resolveTrick(plays, trump, level) === 1);
}

console.log('单元测试：通过 ' + pass + ' / 失败 ' + fail);
`;

eval(src + test);
