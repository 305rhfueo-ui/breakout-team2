'use strict';
// node tests/run-all.js — tests/*.test.js 전부
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
let bad = 0;
for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('.test.js'))) {
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'pipe' }); console.log(`✅ ${f}`); }
  catch (e) { bad++; console.log(`❌ ${f}\n${String(e.stdout || '')}`); }
}
console.log(bad ? `❌ 실패 ${bad}` : '✅ 테스트 파일 전부 통과'); process.exit(bad ? 1 : 0);
