'use strict';
// breakout-team(1팀) 모듈을 경로로 빌려 쓴다 — 복사하지 않는다 (고친 내용이 두 곳에서 갈라지지 않게).
// 전제: 같은 맥미니에 ~/AI/breakout-team 이 있다. 없으면 BT_ROOT 로 위치를 알려 준다.
const path = require('path');
const fs = require('fs');

const BT = process.env.BT_ROOT || path.join(process.env.HOME, 'AI', 'breakout-team');
if (!fs.existsSync(path.join(BT, 'scripts', 'lib', 'util.js'))) throw new Error(`breakout-team 을 찾을 수 없습니다: ${BT} (BT_ROOT 로 지정)`);
const req = (p) => require(path.join(BT, 'scripts', p));
const ROOT = path.join(__dirname, '..', '..');

module.exports = { BT, ROOT, req };
