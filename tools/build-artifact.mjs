#!/usr/bin/env node
/* claude.ai 아티팩트용 진입 파일 생성: node tools/build-artifact.mjs <출력 경로>
 *
 * 아티팩트는 게시할 때 문서 골격(<!doctype>, <html>, <head>, <body>)을 직접 씌우고,
 * 외부 스타일시트는 Google Fonts만 허용한다. 그래서 index.html에서 골격 태그를 걷어 내고
 * 글꼴을 Noto Sans KR(Google Fonts)로 바꾼 뒤, 인쇄·카메라를 쓰지 않는 내장 모드 표시를 넣는다.
 * 나머지 CSS·JS·문항 데이터는 같은 상대 경로의 별도 파일로 함께 게시한다(아래 FILES 목록 출력). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('사용법: node tools/build-artifact.mjs <출력 경로>'); process.exit(1); }

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]).filter((h) => !/^https?:/.test(h));
const page = [
  '<title>HMAT 대비 모의고사</title>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap">',
  ...links.map((h) => `<link rel="stylesheet" href="${h}">`),
  '<script>window.HMAT_ENV = \'artifact\';</script>',
  body,
  '',
].join('\n');
fs.writeFileSync(out, page);

const files = [...links, ...[...body.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])];
const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) { console.error('없는 파일: ' + missing.join(', ')); process.exit(1); }
console.log(JSON.stringify(Object.fromEntries(files.map((f) => [f, f]))));
