#!/usr/bin/env node
/* 사용자 흐름 E2E 테스트: node tools/e2e.mjs [시나리오 번호...]
 *
 * 전역 설치된 playwright를 쓴다(이 저장소에는 의존성이 없다). 브라우저는 설치하지 않으며
 * PLAYWRIGHT_BROWSERS_PATH(기본 /opt/pw-browsers)에 있는 chromium을 쓴다.
 * index.html을 file:// 로 열고, 외부 네트워크 요청(웹폰트 CDN)은 막는다.
 * 테스트 훅: window.HMATApp.state(), HMATApp._advanceClock(ms).
 * 앱을 떠나 있던 시간은 Playwright clock.setSystemTime으로 흉내 낸다.
 *
 * 시나리오마다 PASS/FAIL을 출력하고, 하나라도 실패하면 종료 코드 1.
 * 실패 시 스크린샷은 E2E_SHOTS(기본: OS 임시 폴더/hmat-e2e)에 남긴다. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'hmat-e2e');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

function loadPlaywright() {
  const bases = [process.env.PLAYWRIGHT_MODULE_ROOT, import.meta.url, '/opt/node22/lib/node_modules/'];
  try { bases.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() + '/'); } catch (e) { /* npm 없음 */ }
  for (const b of bases.filter(Boolean)) {
    try { return createRequire(b.endsWith('/') ? b + 'noop.js' : b)('playwright'); } catch (e) { /* 다음 후보 */ }
  }
  console.error('playwright 모듈을 찾지 못했습니다. PLAYWRIGHT_MODULE_ROOT=<node_modules 경로>를 지정하세요.');
  process.exit(2);
}
const { chromium } = loadPlaywright();

/* ---------------- 공통 도우미 ---------------- */
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toSec = (mmss) => { const m = /^(\d+):(\d\d)$/.exec(String(mmss).trim()); return m ? +m[1] * 60 + +m[2] : NaN; };

let browser;
async function openApp(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', ...opts });
  await ctx.route(/^https?:\/\//, (r) => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(APP_URL);
  await page.waitForFunction(() => window.HMATApp && document.querySelector('.set-grid'));
  return { ctx, page, errs };
}

const st = (page) => page.evaluate(() => { const s = window.HMATApp.state(); return s ? JSON.parse(JSON.stringify(s)) : null; });
const settingsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.HMATApp.settings())));
const advance = (page, ms) => page.evaluate((m) => window.HMATApp._advanceClock(m), ms);
const pageNow = (page) => page.evaluate(() => Date.now());
async function waitStage(page, stage, timeout = 5000) {
  await page.waitForFunction((s) => { const S = window.HMATApp.state(); return !!S && S.stage === s; }, stage, { timeout });
}
async function waitFor(page, fn, arg, timeout = 5000) { await page.waitForFunction(fn, arg, { timeout }); }
const text = (page, sel) => page.locator(sel).first().innerText();
const count = (page, sel) => page.locator(sel).count();
const isDisabled = (page, sel) => page.locator(sel).first().isDisabled();
const hasClass = (page, sel, cls) => page.locator(sel).first().evaluate((el, c) => el.classList.contains(c), cls);

async function setSettings(page, obj) {
  for (const [k, v] of Object.entries(obj)) {
    await page.click(`[data-setting="${k}"] button[data-val='${JSON.stringify(v)}']`);
  }
  const s = await settingsOf(page);
  for (const [k, v] of Object.entries(obj)) if (s[k] !== v) throw new Error(`설정 ${k}=${JSON.stringify(v)} 적용 실패(현재 ${JSON.stringify(s[k])})`);
}

async function modalText(page) { await page.waitForSelector('.modal-back .modal', { timeout: 3000 }); return page.locator('.modal-back .modal').last().innerText(); }
async function modalClick(page, label) { await page.locator('.modal-back .ma button', { hasText: label }).last().click(); }

async function keysOf(page, set, key) {
  return page.evaluate(([n, k]) => {
    const p = window.HMAT.sets[n].sections[k];
    return (Array.isArray(p) ? p : p.items).map((it) => ({ id: it.id, answer: it.answer }));
  }, [set, key]);
}
const wrongOf = (a) => (a % 5) + 1;
/* nCorrect개 정답, 이어서 nWrong개 오답, 나머지 미응답 */
function makePlan(keys, nCorrect, nWrong) {
  return keys.map((k, i) => (i < nCorrect ? k.answer : i < nCorrect + nWrong ? wrongOf(k.answer) : null));
}

/* 현재 영역(문항 화면)에서 계획대로 답을 표시한다. 짝수 번째는 선지 클릭, 홀수 번째는 OMR 클릭. */
async function applyPlan(page, plan) {
  for (let i = 0; i < plan.length; i++) {
    const S = await st(page);
    const sec = S.sections[S.secIdx];
    const cur = sec.answers[sec.ids[i]];
    const want = plan[i];
    if ((want ?? null) === (cur ?? null)) continue;
    if (i % 2 === 0) {
      if (S.qIdx !== i) await page.click(`#palette button[data-q="${i}"]`);
      await page.click(`#content .choice[data-choice="${want ?? cur}"]`);
    } else {
      await page.click(`.omr-row[data-row="${i}"] button[data-act="omr"][data-c="${want ?? cur}"]`);
    }
  }
  const S = await st(page);
  const sec = S.sections[S.secIdx];
  return sec.ids.map((id) => sec.answers[id] ?? null);
}

async function endSectionByModal(page) {
  await page.click('[data-act="end-section"]');
  const t = await modalText(page);
  await modalClick(page, '제출하고 종료');
  return t;
}

/* 홈 → 적성 시작 → 첫 영역 안내까지 (연습 모드면 사전점검·감독 단계 없음) */
async function startAptToIntro(page, set) {
  await page.click(`[data-act="start-apt"][data-set="${set}"]`);
  let S = await st(page);
  if (S.stage === 'precheck') { await page.click('[data-act="goto"][data-stage="checkin"]'); await page.click('[data-act="goto"][data-stage="info"]:has-text("건너뛰기")'); }
  await waitStage(page, 'info');
  await page.click('[data-act="confirm-info"]');
  await waitStage(page, 'rules');
  await page.click('[data-act="begin-apt"]');
  await waitStage(page, 'intro');
}

async function startSection(page) {
  await page.click('[data-act="start-section"]');
  await waitFor(page, () => ['question', 'study'].includes(window.HMATApp.state().stage));
  const S = await st(page);
  if (S.stage === 'study' && S.settings.mode === 'practice') { await page.click('[data-act="skip-study"]'); await waitStage(page, 'question'); }
}

async function hScroll(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    window.scrollTo(10000, window.scrollY);
    const sx = window.scrollX;
    window.scrollTo(0, window.scrollY);
    const off = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= W + 1) continue;
      let a = el.parentElement, clipped = false;
      while (a && a !== document.body) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) { clipped = true; break; } a = a.parentElement; }
      if (!clipped) off.push((el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/).join('.') : el.tagName.toLowerCase()) + ' right=' + Math.round(r.right));
    }
    return { W, sw, sx, off: [...new Set(off)].slice(0, 6) };
  });
}

async function bodyHasJunk(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return 'missing ' + s;
    const h = el.innerHTML;
    const bad = ['undefined', 'NaN', '[object Object]', 'null</'].filter((w) => h.includes(w));
    return bad.length ? bad.join(',') : '';
  }, sel);
}

/* ---------------- 시나리오 실행기 ---------------- */
const SCENARIOS = [];
const scenario = (no, name, fn) => SCENARIOS.push({ no, name, fn });

async function runScenario(sc) {
  const fails = [];
  const notes = [];
  const t0 = Date.now();
  const opened = [];
  const ctxApi = {
    check: (cond, msg) => { if (!cond) fails.push(msg); return !!cond; },
    note: (m) => notes.push(m),
    open: async (opts) => { const o = await openApp(opts); opened.push(o); return o; }
  };
  let crashed = null;
  try { await sc.fn(ctxApi); } catch (e) { crashed = e; }
  for (const o of opened) {
    if (o.errs.length) fails.push('페이지 오류: ' + [...new Set(o.errs)].slice(0, 5).join(' / '));
    if ((crashed || fails.length) && !o.page.isClosed()) {
      try { fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, `s${sc.no}-${opened.indexOf(o)}.png`); await o.page.screenshot({ path: f }); notes.push('스크린샷 ' + f); } catch (e) { /* 무시 */ }
    }
    await o.ctx.close().catch(() => {});
  }
  if (crashed) fails.push('중단: ' + String(crashed.message || crashed).split('\n').slice(0, 4).join(' | '));
  const ok = fails.length === 0;
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${sc.no}) ${sc.name}  (${dur}s)`);
  for (const f of fails) console.log('      - ' + f);
  for (const n of notes) console.log('      · ' + n);
  return ok;
}

/* ================= 1) 실전 모드 하반기형 전체 흐름 ================= */
scenario(1, '실전 모드 1회 하반기형: 사전점검→감독→응시자→유의사항→4영역→결과 정답 수', async ({ check, open }) => {
  const { page } = await open();
  await setSettings(page, { variant: 'H2', mode: 'real' });
  await page.click('[data-act="start-apt"][data-set="1"]');
  await waitStage(page, 'precheck');
  check((await count(page, '.checklist li')) >= 4, '사전점검 항목이 4개 미만');
  await page.click('[data-act="goto"][data-stage="checkin"]');
  await waitStage(page, 'checkin');

  // 감독 확인: 모두 체크하기 전에는 다음 비활성
  const boxes = page.locator('[data-ck]');
  const nb = await boxes.count();
  check(nb === 6, `감독 체크리스트 ${nb}개(6개 기대)`);
  check(await isDisabled(page, '#ck-next'), '체크 전 [다음]이 활성화됨');
  for (let i = 0; i < nb - 1; i++) await boxes.nth(i).check();
  check(await isDisabled(page, '#ck-next'), '마지막 항목 체크 전 [다음]이 활성화됨');
  await boxes.nth(nb - 1).check();
  check(!(await isDisabled(page, '#ck-next')), '모두 체크했는데 [다음]이 비활성');
  await boxes.nth(2).uncheck();
  check(await isDisabled(page, '#ck-next'), '체크 해제 후에도 [다음]이 활성');
  await boxes.nth(2).check();
  await page.click('#ck-next');
  await waitStage(page, 'info');

  await page.fill('#nm', '테스트응시자');
  await page.click('[data-act="confirm-info"]');
  await waitStage(page, 'rules');
  let S = await st(page);
  check(S.candidate.name === '테스트응시자', '응시자 이름이 저장되지 않음');
  const rulesTxt = await text(page, '.rules-list');
  check(/도식이해/.test(rulesTxt) && /4분간 규칙을 숙지/.test(rulesTxt), '유의사항에 도식 규칙 숙지 안내 없음');
  check(S.sections.map((s) => s.key).join() === 'verbal,logic,data,diagram', '하반기형 영역 구성이 다름: ' + S.sections.map((s) => s.key).join());
  await page.click('[data-act="begin-apt"]');
  await waitStage(page, 'intro');
  check(/언어이해/.test(await text(page, '.section-intro h2')), '영역 1 안내에 언어이해가 없음');

  /* --- 영역 1: 언어이해 --- */
  await page.click('[data-act="start-section"]');
  await waitStage(page, 'question');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !!document.fullscreenElement), '실전 모드인데 전체화면이 아님');
  check(await count(page, '#fs-ov') === 0, '전체화면 유지 오버레이가 남아 있음');
  check(Math.abs(toSec(await text(page, '#timer-val')) - 1200) <= 2, '언어이해 시작 타이머가 20:00이 아님: ' + await text(page, '#timer-val'));
  const vKeys = await keysOf(page, 1, 'verbal');
  const id0 = vKeys[0].id;
  const ans0 = async () => (await st(page)).sections[0].answers[id0];

  // 선지 클릭 → OMR 동기화
  await page.click('#content .choice[data-choice="2"]');
  check(await ans0() === 2, '선지 ② 클릭 후 상태 답이 2가 아님');
  check(await hasClass(page, '.omr-row[data-row="0"] button[data-c="2"]', 'on'), '선지 클릭이 OMR에 반영되지 않음');
  check(await hasClass(page, '#palette button[data-q="0"]', 'ans'), '팔레트에 응답 표시 없음');
  check((await text(page, '#omr-cnt')).startsWith('1 /'), 'OMR 응답 수가 1이 아님');
  // OMR 클릭 → 선지 동기화
  await page.click('.omr-row[data-row="0"] button[data-c="4"]');
  check(await ans0() === 4, 'OMR ④ 클릭 후 상태 답이 4가 아님');
  check(await hasClass(page, '#content .choice[data-choice="4"]', 'on') && !(await hasClass(page, '#content .choice[data-choice="2"]', 'on')), 'OMR 클릭이 선지 화면에 반영되지 않음');
  check(!(await hasClass(page, '.omr-row[data-row="0"] button[data-c="2"]', 'on')), 'OMR에 이전 답 ②가 남음');
  // 같은 선지 재클릭 → 해제
  await page.click('#content .choice[data-choice="4"]');
  check(await ans0() === undefined, '같은 선지 재클릭으로 해제되지 않음');
  check(await count(page, '.omr-row[data-row="0"] button.on') === 0 && await count(page, '#content .choice.on') === 0, '해제 후 OMR/선지에 선택 표시가 남음');
  check(!(await hasClass(page, '#palette button[data-q="0"]', 'ans')), '해제 후 팔레트 응답 표시가 남음');
  // OMR 재클릭 해제와 키보드 입력
  await page.click('.omr-row[data-row="0"] button[data-c="1"]');
  await page.click('.omr-row[data-row="0"] button[data-c="1"]');
  check(await ans0() === undefined, 'OMR 같은 칸 재클릭으로 해제되지 않음');
  await page.keyboard.press('3');
  check(await ans0() === 3, '키보드 3 입력이 반영되지 않음');
  await page.keyboard.press('3');
  check(await ans0() === undefined, '키보드 3 재입력으로 해제되지 않음');

  // 검토 표시
  await page.click('#flag-btn');
  S = await st(page);
  check(S.sections[0].flags[id0] === true, '검토 표시가 상태에 저장되지 않음');
  check(await hasClass(page, '.omr-row[data-row="0"] .n', 'flag') && await hasClass(page, '#palette button[data-q="0"]', 'flag'), '검토 표시가 OMR/팔레트에 반영되지 않음');
  check(/해제/.test(await text(page, '#flag-btn')), '검토 버튼 문구가 바뀌지 않음');
  await page.click('#flag-btn');
  S = await st(page);
  check(!S.sections[0].flags[id0] && !(await hasClass(page, '#palette button[data-q="0"]', 'flag')), '검토 표시 해제가 반영되지 않음');

  // 이동: 이전/다음/팔레트/OMR 번호/방향키
  check(await isDisabled(page, '[data-act="prev"]'), '1번에서 [이전]이 활성');
  await page.click('[data-act="next"]');
  check((await st(page)).qIdx === 1 && /2 \/ 15/.test(await text(page, '.exam-head .sec')), '[다음] 이동 실패');
  await page.click('[data-act="prev"]');
  check((await st(page)).qIdx === 0, '[이전] 이동 실패');
  await page.click('#palette button[data-q="7"]');
  check((await st(page)).qIdx === 7 && /8번 문항/.test(await text(page, '.qno-label')), '팔레트 이동 실패');
  await page.click('.omr-row[data-row="10"] button[data-act="goq"]');
  check((await st(page)).qIdx === 10, 'OMR 번호 이동 실패');
  await page.keyboard.press('ArrowRight');
  check((await st(page)).qIdx === 11, '→ 키 이동 실패');
  await page.click('#palette button[data-q="14"]');
  check(await isDisabled(page, '[data-act="next"]'), '마지막 문항에서 [다음]이 활성');
  // 현재 문항이 아닌 OMR 줄에 표시
  await page.click('.omr-row[data-row="12"] button[data-c="5"]');
  S = await st(page);
  check(S.qIdx === 14 && S.sections[0].answers[vKeys[12].id] === 5, '다른 문항 OMR 표시가 반영되지 않거나 현재 문항이 바뀜');

  // 계획 답안: 언어 6정답 4오답 5미응답, 검토 2개
  const vPlan = makePlan(vKeys, 6, 4);
  const vGot = await applyPlan(page, vPlan);
  check(JSON.stringify(vGot) === JSON.stringify(vPlan), '언어 답안이 계획과 다름: ' + JSON.stringify(vGot));
  await page.click('#palette button[data-q="0"]'); await page.click('#flag-btn');
  await page.click('#palette button[data-q="8"]'); await page.click('#flag-btn');

  // 영역 종료 모달: 계속 풀기 → 제출
  await page.click('[data-act="end-section"]');
  let mt = await modalText(page);
  check(/미응답 문항: 5개/.test(mt), '종료 모달 미응답 수가 5가 아님: ' + mt.replace(/\s+/g, ' '));
  check(/검토 표시 문항: 2개/.test(mt), '종료 모달 검토 수가 2가 아님');
  await modalClick(page, '계속 풀기');
  check((await st(page)).stage === 'question' && await count(page, '.modal-back') === 0, '[계속 풀기] 후 문항 화면이 아님');
  await endSectionByModal(page);
  await waitStage(page, 'intro');
  S = await st(page);
  check(S.secIdx === 1 && S.sections[0].status === 'done' && S.sections[0].endReason === 'submit', '언어 영역 제출 상태가 잘못됨');
  check(/논리판단/.test(await text(page, '.section-intro h2')), '영역 2 안내가 논리판단이 아님');

  /* --- 영역 2: 논리판단 (시간 만료 자동 제출) --- */
  await startSection(page);
  check(await count(page, '.omr-row') === 10, '논리 OMR 줄 수가 10이 아님(이전 영역이 보임?)');
  const lKeys = await keysOf(page, 1, 'logic');
  const lPlan = makePlan(lKeys, 5, 3);
  await applyPlan(page, lPlan);
  await advance(page, 15 * 60000 - 4.5 * 60000);
  await page.waitForTimeout(600);
  check(await hasClass(page, '#timer', 'warn'), '남은 5분 이하인데 타이머 경고(주황) 없음');
  await advance(page, 4 * 60000);
  await page.waitForTimeout(600);
  check(await hasClass(page, '#timer', 'crit'), '남은 1분 이하인데 타이머 경고(빨강) 없음');
  check(await page.locator('.toast', { hasText: '1분 전' }).count() > 0, '종료 1분 전 알림 없음');
  await page.click('[data-act="end-section"]');      // 확인 모달이 떠 있는 동안 만료
  await advance(page, 60000);
  await waitStage(page, 'intro');
  mt = await modalText(page);
  check(/자동 제출/.test(mt), '시간 만료 모달이 없음: ' + mt);
  check(await count(page, '.modal-back') === 1, '시간 만료 후 모달이 ' + await count(page, '.modal-back') + '개(이전 확인 모달이 남음?)');
  await modalClick(page, '확인');
  S = await st(page);
  check(S.secIdx === 2 && S.sections[1].endReason === 'timeout', '논리 영역이 시간 만료로 끝나지 않음');
  check(JSON.stringify(S.sections[1].ids.map((id) => S.sections[1].answers[id] ?? null)) === JSON.stringify(lPlan), '시간 만료 후 논리 답안이 보존되지 않음');

  /* --- 영역 3: 정보추론 --- */
  await startSection(page);
  const dKeys = await keysOf(page, 1, 'data');
  const dPlan = makePlan(dKeys, 7, 3);
  await applyPlan(page, dPlan);
  mt = await endSectionByModal(page);
  check(/미응답 문항: 5개/.test(mt), '정보추론 종료 모달 미응답 수 오류');
  await waitStage(page, 'intro');

  /* --- 영역 4: 도식이해 (숙지 4분 → 자동 시작) --- */
  check(/도식이해/.test(await text(page, '.section-intro h2')), '영역 4 안내가 도식이해가 아님');
  await page.click('[data-act="start-section"]');
  await waitStage(page, 'study');
  check(await count(page, '.study .rule-table') === 1, '숙지 화면에 규칙표 없음');
  check(await count(page, '[data-act="skip-study"]') === 0, '실전 모드인데 [바로 문항 시작]이 있음');
  check(Math.abs(toSec(await text(page, '#timer-val')) - 240) <= 2, '숙지 타이머가 04:00이 아님');
  await advance(page, 3 * 60000);
  await page.waitForTimeout(500);
  check((await st(page)).stage === 'study', '숙지 3분 경과 시점에 이미 문항으로 넘어감');
  await advance(page, 60000);
  await waitStage(page, 'question');
  S = await st(page);
  const rem = S.sections[3].endAt - await pageNow(page);
  check(rem > 11.9 * 60000 && rem <= 12 * 60000, '숙지 후 도식 문항 시간이 12분이 아님: ' + rem);
  await page.click('[data-act="rules-drawer"]');
  check(await count(page, '.drawer .rule-table') === 1, '[규칙표 보기] 패널이 열리지 않음');
  await page.click('.drawer .dh button');
  const gKeys = await keysOf(page, 1, 'diagram');
  const gPlan = makePlan(gKeys, 4, 2);
  await applyPlan(page, gPlan);
  await endSectionByModal(page);
  await waitStage(page, 'complete');

  /* --- 완료 → 결과 --- */
  check(/응시가 완료되었습니다/.test(await text(page, 'main')), '완료 화면 문구 없음');
  check(await isDisabled(page, '#ck-next'), '연습장 지우기 확인 전 [결과 보기]가 활성');
  await page.check('#erase');
  await page.click('#ck-next');
  await page.waitForSelector('.score-grid');
  const expected = { 언어이해: [6, 15, 5], 논리판단: [5, 10, 2], 정보추론: [7, 15, 5], 도식이해: [4, 8, 2] };
  const total = Object.values(expected).reduce((a, v) => a + v[0], 0);
  const tiles = await page.$$eval('.score-tile', (els) => els.map((e) => ({ k: e.querySelector('.k').innerText.trim(), v: e.querySelector('.v').innerText.replace(/\s+/g, ' ').trim(), sub: (e.querySelector('.small') || {}).innerText || '' })));
  const tot = tiles.find((t) => t.k === '전체 정답');
  check(tot && tot.v === `${total} / 48`, `결과 전체 정답 ${tot && tot.v}, 기대 ${total} / 48`);
  for (const [name, [c, n, un]] of Object.entries(expected)) {
    const t = tiles.find((x) => x.k === name);
    check(t && t.v === `${c} / ${n}`, `결과 ${name} ${t && t.v}, 기대 ${c} / ${n}`);
    check(t && new RegExp('미응답 ' + un + '$').test(t.sub.trim()), `결과 ${name} 미응답 표기 오류: ${t && t.sub}`);
  }
  check(/시간 종료/.test(tiles.find((x) => x.k === '논리판단').sub), '논리판단 결과에 시간 종료 표시 없음');
  const subSum = await page.$$eval('.res-table tbody tr', (rows) => rows.reduce((a, r) => a + +r.children[2].innerText.split('/')[0], 0));
  check(subSum === total, `유형별 정답 합 ${subSum} ≠ ${total}`);
  await page.click('[data-act="res-tab"][data-tab="table"]');
  const ox = await page.$$eval('.res-table tbody .ox', (els) => els.map((e) => e.innerText));
  check(ox.length === 48 && ox.filter((x) => x === 'O').length === total, `문항별 결과표 O 개수 ${ox.filter((x) => x === 'O').length}/${ox.length}`);
  check(await page.evaluate(() => !document.fullscreenElement), '완료 후에도 전체화면이 유지됨');
  await page.click('[data-act="home"]');
  check(new RegExp(`최근 적성: ${total} / 48`).test(await text(page, '.set-grid')), '홈의 최근 적성 기록 점수 불일치');
});

/* ================= 2) 연습 모드: 일시정지, 정답 확인 ================= */
scenario(2, '연습 모드: 일시정지 중 타이머 정지, 정답 확인 해설', async ({ check, open }) => {
  const { page } = await open();
  await setSettings(page, { variant: 'H2', mode: 'practice' });
  await page.click('[data-act="start-apt"][data-set="2"]');
  await waitStage(page, 'info');
  check(await count(page, '.steps span') === 2, '연습 모드인데 사전점검/감독 단계가 표시됨');
  await page.click('[data-act="confirm-info"]');
  await page.click('[data-act="begin-apt"]');
  await waitStage(page, 'intro');
  await startSection(page);
  check(await page.evaluate(() => !document.fullscreenElement), '연습 모드에서 전체화면 진입');
  check(await count(page, '[data-act="pause"]') === 1 && await count(page, '[data-act="peek"]') === 1, '연습 모드 버튼(일시정지/정답 확인) 없음');

  await page.waitForTimeout(1200);
  await page.click('[data-act="pause"]');
  await page.waitForSelector('#pause-ov');
  let S = await st(page);
  const r0 = S.sections[0].remain;
  const t0 = await text(page, '#timer-val');
  check(r0 != null && r0 < 20 * 60000, '일시정지 후 remain 값 없음');
  await page.waitForTimeout(2600);
  await page.keyboard.press('1');
  S = await st(page);
  check(S.sections[0].remain === r0, '일시정지 중 remain이 변함');
  check(await text(page, '#timer-val') === t0, `일시정지 중 표시 시간이 변함 ${t0} → ${await text(page, '#timer-val')}`);
  check(Object.keys(S.sections[0].answers).length === 0, '일시정지 중 키보드로 답이 입력됨');

  // 일시정지 상태로 새로고침 → 이어서 응시해도 정지 유지
  await page.reload();
  await page.waitForSelector('[data-act="resume"]');
  await page.waitForTimeout(1000);
  await page.click('[data-act="resume"]');
  await waitStage(page, 'question');
  check(await count(page, '#pause-ov') === 1, '새로고침 후 이어서 응시 시 일시정지 화면이 아님');
  S = await st(page);
  check(S.sections[0].remain === r0, '새로고침 후 일시정지 remain이 변함');

  await page.click('[data-act="resume-pause"]');
  check(await count(page, '#pause-ov') === 0, '[계속하기] 후 오버레이가 남음');
  S = await st(page);
  const r1 = S.sections[0].endAt - await pageNow(page);
  check(Math.abs(r1 - r0) < 1500, `재개 후 남은 시간이 정지 전과 다름: ${r0} → ${r1}`);
  await page.waitForTimeout(1300);
  S = await st(page);
  const r2 = S.sections[0].endAt - await pageNow(page);
  check(r2 < r1 - 1000, '재개 후 타이머가 다시 흐르지 않음');

  // 정답 확인
  const keys = await keysOf(page, 2, 'verbal');
  await page.click('[data-act="peek"]');
  await page.waitForSelector('#content .explain');
  let ex = await text(page, '#content .explain');
  check(ex.includes('정답 ' + CIRCLED[keys[0].answer - 1]) && /미응답/.test(ex), '미응답 상태 정답 확인 표기 오류: ' + ex.slice(0, 40));
  check((await text(page, '#content .explain .body')).trim().length > 10, '해설 본문이 비어 있음');
  check(await hasClass(page, `#content .choice[data-choice="${keys[0].answer}"]`, 'correct'), '정답 선지 강조 없음');
  await page.click(`#content .choice[data-choice="${wrongOf(keys[0].answer)}"]`);
  await page.click('[data-act="peek"]');
  ex = await text(page, '#content .explain');
  check(/오답 · 내 답/.test(ex) && await hasClass(page, `#content .choice[data-choice="${wrongOf(keys[0].answer)}"]`, 'wrong'), '오답 선택 후 정답 확인 표기 오류');
  await page.click(`#content .choice[data-choice="${keys[0].answer}"]`);
  await page.click('[data-act="peek"]');
  check(/정답/.test(await text(page, '#content .explain .tag.ok')), '정답 선택 후 정답 확인에 정답 표시 없음');
});

/* ================= 3) 새로고침 이어서 응시 ================= */
scenario(3, '새로고침 이어서 응시: 영역·답·남은 시간 연속, 시간 경과 시 다음 영역', async ({ check, open }) => {
  const { page } = await open();
  await setSettings(page, { variant: 'H2', mode: 'real' });
  await startAptToIntro(page, 1);
  await startSection(page);
  const vKeys = await keysOf(page, 1, 'verbal');
  await applyPlan(page, makePlan(vKeys, 3, 2));
  await endSectionByModal(page);
  await waitStage(page, 'intro');
  await startSection(page);
  const lKeys = await keysOf(page, 1, 'logic');
  const lPlan = makePlan(lKeys, 2, 2);
  await applyPlan(page, lPlan);
  await page.click('#palette button[data-q="2"]'); await page.click('#flag-btn');
  await page.click('#palette button[data-q="5"]');
  await advance(page, 3 * 60000);
  let before = await st(page);
  const remBefore = before.sections[1].endAt - await pageNow(page);

  await page.reload();
  await page.waitForSelector('[data-act="resume"]');
  const notice = await text(page, '.notice.info');
  check(/제1회 적성검사/.test(notice), '홈 이어서 응시 안내 문구 오류: ' + notice);
  await page.waitForTimeout(1500);
  await page.click('[data-act="resume"]');
  await waitStage(page, 'question');
  await page.waitForTimeout(400);
  let S = await st(page);
  check(S.secIdx === 1 && S.qIdx === 5, `이어서 응시 위치 오류: 영역 ${S.secIdx}, 문항 ${S.qIdx}`);
  check(JSON.stringify(S.sections[1].answers) === JSON.stringify(before.sections[1].answers), '이어서 응시 후 답이 다름');
  check(JSON.stringify(S.sections[1].flags) === JSON.stringify(before.sections[1].flags), '이어서 응시 후 검토 표시가 다름');
  check(S.sections[1].endAt === before.sections[1].endAt, '이어서 응시 후 종료 시각(endAt)이 바뀜');
  const remAfter = S.sections[1].endAt - await pageNow(page);
  check(remBefore - remAfter >= 1500 && remBefore - remAfter < 6000, `떠나 있던 시간만큼 줄지 않음: ${remBefore} → ${remAfter}`);
  check(Math.abs(toSec(await text(page, '#timer-val')) - remAfter / 1000) <= 2, '표시 시간이 남은 시간과 다름');
  check(/6 \/ 10/.test(await text(page, '.exam-head .sec')), '이어서 응시 화면 문항 번호 오류');
  for (let i = 0; i < lPlan.length; i++) {
    if (lPlan[i]) check(await hasClass(page, `.omr-row[data-row="${i}"] button[data-c="${lPlan[i]}"]`, 'on'), `이어서 응시 후 OMR ${i + 1}번 표시 없음`);
  }
  check(await hasClass(page, '#palette button[data-q="2"]', 'flag'), '이어서 응시 후 팔레트 검토 표시 없음');
  check(await page.evaluate(() => !!document.fullscreenElement) && await count(page, '#fs-ov') === 0, '이어서 응시(실전) 후 전체화면 복귀 안 됨');

  // 영역 시간이 지난 뒤 돌아오면 다음 영역으로
  before = await st(page);
  await page.reload();
  await page.waitForSelector('[data-act="resume"]');
  await page.clock.setSystemTime(new Date(Date.now() + 13 * 60000));
  await page.click('[data-act="resume"]');
  await waitStage(page, 'intro');
  S = await st(page);
  check(S.secIdx === 2 && S.sections[1].status === 'done' && S.sections[1].endReason === 'timeout', '영역 시간이 지난 뒤 이어서 응시했는데 다음 영역으로 넘어가지 않음');
  check(JSON.stringify(S.sections[1].answers) === JSON.stringify(before.sections[1].answers), '시간 경과 종료 시 답이 보존되지 않음');
  check(/정보추론/.test(await text(page, '.section-intro h2')), '다음 영역 안내가 정보추론이 아님');

  // 도식 숙지 중 이탈 후, 숙지(4분)+문항(12분) 시간이 모두 지난 뒤 돌아온 경우
  await startSection(page);
  await endSectionByModal(page);
  await waitStage(page, 'intro');
  await page.click('[data-act="start-section"]');
  await waitStage(page, 'study');
  await page.reload();
  await page.waitForSelector('[data-act="resume"]');
  await page.clock.setSystemTime(new Date(Date.now() + 26 * 60000)); // 누적 39분 경과, 숙지 시작 후 약 17분
  await page.click('[data-act="resume"]');
  await page.waitForTimeout(600);
  S = await st(page);
  const n = await pageNow(page);
  const secD = S.sections[3];
  const diag = S.stage === 'question' ? `문항 화면, 남은 ${Math.round((secD.endAt - n) / 1000)}초` : S.stage;
  check(S.stage === 'complete' || (S.stage === 'question' && secD.endAt - n <= 0), `숙지 시작 후 약 17분 뒤 이어서 응시했는데 도식 영역이 끝나지 않음(${diag}). 숙지 종료 시점이 아니라 재개 시점부터 12분을 새로 줌`);

  // 숙지 중 짧게 이탈: 숙지 종료 1분 뒤 돌아오면 문항 시간은 11분 남아야 함
  const { page: p2 } = await open();
  await setSettings(p2, { variant: 'H2', mode: 'practice' });
  await startAptToIntro(p2, 2);
  for (let i = 0; i < 3; i++) { await startSection(p2); await endSectionByModal(p2); await waitStage(p2, 'intro'); }
  await p2.click('[data-act="start-section"]');
  await waitStage(p2, 'study');
  await p2.reload();
  await p2.waitForSelector('[data-act="resume"]');
  await p2.clock.setSystemTime(new Date(Date.now() + 5 * 60000));
  await p2.click('[data-act="resume"]');
  await waitStage(p2, 'question');
  S = await st(p2);
  const left = S.sections[3].endAt - await pageNow(p2);
  check(left < 11.2 * 60000, `숙지 종료 약 1분 뒤 복귀 시 도식 남은 시간 ${Math.round(left / 1000)}초(약 660초 기대). 이탈 시간이 문항 시간에서 빠지지 않음`);
});

/* ================= 4) 인성검사 ================= */
scenario(4, '인성검사: 가/멀 상호배타, 페이지 완료 전 다음 비활성, 페이지·Ⅰ부 시간 만료, 결과 지표', async ({ check, open }) => {
  const { page } = await open();
  await setSettings(page, { mode: 'real', likert: 5, part2: 'yn', persTiming: 'split', pageTimer: true });
  await page.click('[data-act="start-pers"][data-set="1"]');
  await waitStage(page, 'info');
  await page.click('[data-act="confirm-info"]');
  await waitStage(page, 'intro');
  // 예시 묶음에서도 가/멀 상호배타
  await page.click('.pers-block [data-act="fc"][data-id="demo0"][data-w="near"]');
  await page.click('.pers-block [data-act="fc"][data-id="demo0"][data-w="far"]');
  check(!(await hasClass(page, '[data-id="demo0"][data-w="near"]', 'on')) && await hasClass(page, '[data-id="demo0"][data-w="far"]', 'on'), '예시 묶음 가/멀 상호배타 실패');
  await page.click('[data-act="begin-pers"]');
  await waitStage(page, 'part');
  await page.waitForTimeout(300);
  check(/Ⅰ부 남은 시간/.test(await text(page, '#timer .lbl')) && Math.abs(toSec(await text(page, '#timer-val')) - 3000) <= 2, 'Ⅰ부 타이머 표시 오류');
  const pageSec0 = toSec(await text(page, '#page-timer'));
  check(pageSec0 > 0, '페이지 타이머 표시 없음');
  check(await isDisabled(page, '#pers-next'), '응답 전 [다음 페이지]가 활성');

  let S = await st(page);
  const blocks = S.parts.blocks;
  const b0 = blocks[0];
  const fcOf = async (bi) => ((await st(page)).fc[bi] || {});
  const sel = (bi, id, w) => `.pers-block [data-act="fc"][data-b="${bi}"][data-id="${id}"][data-w="${w}"]`;
  const lk = (id, v) => page.click(`[data-act="lk"][data-id="${id}"][data-v="${v}"]`);
  await page.click(sel(0, b0[0], 'near'));
  check((await fcOf(0)).near === b0[0], '가 선택이 저장되지 않음');
  await page.click(sel(0, b0[0], 'far'));
  let f = await fcOf(0);
  check(f.far === b0[0] && f.near == null, `같은 진술을 가·멀 동시 선택 가능: ${JSON.stringify(f)}`);
  check(!(await hasClass(page, sel(0, b0[0], 'near'), 'on')), '멀 선택 후 같은 진술의 가 표시가 남음');
  await page.click(sel(0, b0[0], 'near'));
  f = await fcOf(0);
  check(f.near === b0[0] && f.far == null, '가 재선택 시 멀이 해제되지 않음');
  await page.click(sel(0, b0[1], 'far'));
  await page.click(sel(0, b0[2], 'near'));
  f = await fcOf(0);
  check(f.near === b0[2] && f.far === b0[1] && await count(page, '.pers-block:nth-of-type(1) .fc.near.on') <= 1, '묶음 안에서 가가 하나만 유지되지 않음');
  const onCount = await page.$$eval('.pers-wrap .pers-block', (els) => els[0].querySelectorAll('.fc.near.on').length);
  check(onCount === 1, `첫 묶음 가 표시 ${onCount}개`);
  await page.click(sel(0, b0[0], 'near'));
  // 척도: 다시 누르면 바뀜
  await lk(b0[0], 2); await lk(b0[0], 1);
  S = await st(page);
  check(S.answers[b0[0]] === 1 && await count(page, `[data-act="lk"][data-id="${b0[0]}"].on`) === 1, '척도 재선택이 반영되지 않음');
  await lk(b0[1], 5); await lk(b0[2], 3);               // 가(1점) < 멀(5점): 모순 1건
  check(await isDisabled(page, '#pers-next'), '첫 묶음만 완료했는데 [다음 페이지]가 활성');
  for (const bi of [1, 2]) {
    const b = blocks[bi];
    await lk(b[0], 5); await lk(b[1], 1); await lk(b[2], 3);
    await page.click(sel(bi, b[0], 'near'));
    if (bi === 2) check(await isDisabled(page, '#pers-next'), '멀을 고르기 전 [다음 페이지]가 활성');
    await page.click(sel(bi, b[1], 'far'));
  }
  check(!(await isDisabled(page, '#pers-next')), '페이지를 모두 응답했는데 [다음 페이지]가 비활성');
  await page.click('#pers-next');
  await waitFor(page, () => window.HMATApp.state().page === 1);
  check(await count(page, '[data-act="prev"]') === 0, '인성검사에 이전 버튼이 있음');

  // 페이지 타이머 만료 → 자동 넘김
  S = await st(page);
  const pageLeft = S.pageEndAt - await pageNow(page);
  await advance(page, pageLeft + 500);
  await waitFor(page, () => window.HMATApp.state().page === 2);
  S = await st(page);
  check(S.timedOutPages === 1, 'timedOutPages가 1이 아님');
  check(await page.locator('.toast', { hasText: '다음 페이지' }).count() > 0, '페이지 자동 넘김 알림 없음');
  check(Math.abs((S.pageEndAt - await pageNow(page)) - pageSec0 * 1000) < 2500, '새 페이지 타이머가 다시 시작되지 않음');

  // 2페이지 일부 응답: 묶음 6에 가(5점)/멀(4점), 셋째 진술 미응답
  const b6 = blocks[6];
  await lk(b6[0], 5); await lk(b6[1], 4);
  await page.click(sel(6, b6[0], 'near')); await page.click(sel(6, b6[1], 'far'));
  check(await isDisabled(page, '#pers-next'), '미완료 페이지에서 [다음 페이지]가 활성');

  // Ⅰ부 시간 만료 → Ⅱ부 안내
  await advance(page, 50 * 60000);
  await waitStage(page, 'between');
  const mt = await modalText(page);
  check(/Ⅰ부 제한시간/.test(mt), 'Ⅰ부 시간 만료 모달 없음');
  await modalClick(page, '확인');
  check(/Ⅱ부/.test(await text(page, '.section-intro h2')) && /45분/.test(await text(page, '.section-intro .spec')), 'Ⅱ부 안내 화면 오류');
  await page.click('[data-act="begin-part2"]');
  await waitStage(page, 'part');
  await page.waitForTimeout(300);
  S = await st(page);
  check(S.part === 1 && S.page === 0, 'Ⅱ부 1페이지가 아님');
  check(/Ⅱ부 남은 시간/.test(await text(page, '#timer .lbl')) && Math.abs(toSec(await text(page, '#timer-val')) - 2700) <= 2, 'Ⅱ부 타이머 표시 오류');
  const p2ids = S.parts.items.slice(0, 10);
  for (let i = 0; i < 10; i++) {
    if (i === 9) check(await isDisabled(page, '#pers-next'), 'Ⅱ부 9/10 응답 상태에서 [다음]이 활성');
    await lk(p2ids[i], (i % 2) + 1);
  }
  check(await page.locator(`[data-act="lk"][data-id="${p2ids[0]}"]`).first().innerText() === '예', 'Ⅱ부 예/아니오 버튼 문구 오류');
  await page.click('#pers-next');
  await waitFor(page, () => window.HMATApp.state().page === 1);
  const p2b = (await st(page)).parts.items.slice(10, 13);
  for (const id of p2b) await lk(id, 1);
  await advance(page, 45 * 60000);
  await waitStage(page, 'complete');
  check(/자동 제출/.test(await modalText(page)), 'Ⅱ부 시간 만료 모달 없음');
  await modalClick(page, '확인');
  S = await st(page);
  const answered = Object.keys(S.answers).length;
  check(answered === 9 + 2 + 10 + 3, `응답 수 ${answered}(24 기대)`);
  check(!(await isDisabled(page, '#ck-next')), '인성 완료 화면 [결과 보기]가 비활성');
  await page.click('#ck-next');
  await page.waitForSelector('.score-grid');
  const tiles = await page.$$eval('.score-tile', (els) => Object.fromEntries(els.map((e) => [e.querySelector('.k').innerText.trim(), { v: e.querySelector('.v').innerText.replace(/\s+/g, ' ').trim(), sub: (e.querySelector('.small') || {}).innerText || '' }])));
  check(tiles['응답 완료'] && tiles['응답 완료'].v === '24 / 456', '응답 완료 지표 ' + JSON.stringify(tiles['응답 완료']));
  check(tiles['응답 완료'] && /무응답 432/.test(tiles['응답 완료'].sub) && /시간 초과 페이지 1/.test(tiles['응답 완료'].sub), '무응답/시간 초과 페이지 표기 오류: ' + (tiles['응답 완료'] || {}).sub);
  check(tiles['가/멀 선택과 척도 모순'] && tiles['가/멀 선택과 척도 모순'].v === '1 / 4묶음', '가/멀 모순 지표 ' + JSON.stringify(tiles['가/멀 선택과 척도 모순']));
  check(tiles['극단 응답 비율'] && tiles['극단 응답 비율'].v === '64%', '극단 응답 비율 ' + JSON.stringify(tiles['극단 응답 비율']) + ' (11개 중 7개 = 64% 기대)');
  check(tiles['일관성 지수'] && tiles['과장 응답 경향'], '일관성/과장 응답 지표 없음');
  check(await count(page, '.profile-row') === 6, '차원별 프로파일 6개가 아님');
  check(/규준/.test(await text(page, '.hero')), '규준 없음 안내가 없음');
});

/* ================= 5) 유형별 시작, 3개 회차 전 문항 렌더링 ================= */
scenario(5, '5영역 전체·상반기형 시작, 3개 회차 전 문항 렌더링 오류 없음', async ({ check, open }) => {
  const { page, errs } = await open();
  await setSettings(page, { variant: 'ALL', mode: 'practice' });
  for (const set of [1, 2, 3]) {
    await startAptToIntro(page, set);
    let S = await st(page);
    check(S.sections.map((s) => s.key).join() === 'verbal,logic,data,diagram,spatial', `${set}회 5영역 구성 오류`);
    let total = 0;
    for (let si = 0; si < 5; si++) {
      const key = S.sections[si].key;
      await page.click('[data-act="start-section"]');
      await waitFor(page, () => ['question', 'study'].includes(window.HMATApp.state().stage));
      if (key === 'diagram') {
        check((await st(page)).stage === 'study' && await count(page, '.study .rule-table tbody tr') >= 4, `${set}회 도식 숙지 화면/규칙표 오류`);
        await page.click('[data-act="skip-study"]');
        await waitStage(page, 'question');
      }
      const ids = (await st(page)).sections[si].ids;
      check(ids.length === { verbal: 15, logic: 10, data: 15, diagram: 8, spatial: 10 }[key], `${set}회 ${key} 문항 수 ${ids.length}`);
      for (let i = 0; i < ids.length; i++) {
        if (i > 0) await page.click(`#palette button[data-q="${i}"]`);
        await page.click('[data-act="peek"]');
        const info = await page.evaluate(() => {
          const c = document.getElementById('content');
          return { stem: (c.querySelector('.q-stem') || {}).innerText || '', choices: c.querySelectorAll('.choice').length, explain: ((c.querySelector('.explain .body') || {}).innerText || '').length,
            svgs: c.querySelectorAll('svg').length, passage: c.querySelector('.pane.passage') ? c.querySelector('.pane.passage').innerText.length : -1 };
        });
        const tag = `${set}회 ${key} ${i + 1}번`;
        check(info.stem.length > 3, tag + ' 발문 없음');
        check(info.choices === 5, `${tag} 선지 ${info.choices}개`);
        check(info.explain > 5, tag + ' 해설 없음');
        check(info.passage !== 0, tag + ' 지문 영역이 비어 있음');
        if (key === 'spatial' || key === 'diagram') check(info.svgs > 0, tag + ' 그림(SVG) 없음');
        const junk = await bodyHasJunk(page, '#content');
        check(!junk, `${tag} 렌더링에 ${junk} 문자열`);
        total++;
      }
      if (key === 'diagram') { await page.click('[data-act="rules-drawer"]'); check(await count(page, '.drawer .rule-table') === 1, `${set}회 규칙표 패널 오류`); await page.click('.drawer .dh button'); }
      await endSectionByModal(page);
      await waitFor(page, () => ['intro', 'complete'].includes(window.HMATApp.state().stage));
    }
    await waitStage(page, 'complete');
    await page.check('#erase');
    await page.click('#ck-next');
    await page.click('[data-act="res-tab"][data-tab="review"]');
    const nrev = await count(page, '.review-item');
    check(nrev === total && total === 58, `${set}회 해설 보기 문항 ${nrev}개, 렌더 ${total}개(58 기대)`);
    const junk = await bodyHasJunk(page, 'main');
    check(!junk, `${set}회 해설 화면에 ${junk} 문자열`);
    await page.click('[data-act="home"]');
  }
  // 상반기형(공간) 각 회차 시작
  await setSettings(page, { variant: 'H1' });
  check(/공간지각 10/.test(await text(page, '.set-grid')), '상반기형 홈 카드에 공간지각 표시 없음');
  for (const set of [1, 2, 3]) {
    await startAptToIntro(page, set);
    const S = await st(page);
    check(S.sections.map((s) => s.key).join() === 'verbal,logic,data,spatial', `${set}회 상반기형 구성 오류`);
    for (let si = 0; si < 3; si++) { await startSection(page); await endSectionByModal(page); await waitStage(page, 'intro'); }
    check(/공간지각/.test(await text(page, '.section-intro h2')), `${set}회 상반기형 4번째 영역이 공간지각이 아님`);
    await startSection(page);
    check(await count(page, '#content .choice') === 5 && await count(page, '#content svg') > 0, `${set}회 공간지각 1번 렌더링 오류`);
    await page.evaluate(() => { localStorage.removeItem('hmat-mock:session'); window.HMATApp.home(); });
    await page.reload();
    await page.waitForSelector('.set-grid');
  }
  check(errs.length === 0, '렌더링 중 페이지 오류');
});

/* ================= 6) 390px 모바일 폭 ================= */
scenario(6, '390px 모바일 폭: 홈·문항·인성 화면 가로 스크롤 없음', async ({ check, open }) => {
  const { page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const probe = async (label) => {
    await page.waitForTimeout(150);
    const r = await hScroll(page);
    check(r.sw <= r.W + 1 && r.sx === 0, `${label}: 가로 스크롤 발생(scrollWidth ${r.sw} > ${r.W}) ${r.off.join(', ')}`);
  };
  await probe('홈');
  await setSettings(page, { variant: 'ALL', mode: 'practice' });
  await probe('홈(설정 변경 후)');
  await startAptToIntro(page, 1);
  await probe('영역 안내');
  const visit = async (key, label) => {
    const S = await st(page);
    const items = await page.evaluate(([k]) => { const p = window.HMAT.sets[1].sections[k]; return (Array.isArray(p) ? p : p.items).map((it) => ({ passage: !!(it.passage || (it.materials && it.materials.length)), charts: !!it.choiceCharts, svgs: !!it.choiceSvgs, table: !!(it.materials || []).find((m) => m.kind === 'table') })); }, [key]);
    const picks = new Set([0]);
    ['passage', 'charts', 'svgs', 'table'].forEach((f) => { const i = items.findIndex((x) => x[f]); if (i >= 0) picks.add(i); });
    for (const i of picks) {
      if (S.qIdx !== i) await page.click(`#palette button[data-q="${i}"]`).catch(() => page.evaluate((q) => document.querySelector(`#palette button[data-q="${q}"]`).click(), i));
      await probe(`${label} ${i + 1}번`);
    }
  };
  await startSection(page); await visit('verbal', '언어이해'); await endSectionByModal(page); await waitStage(page, 'intro');
  await startSection(page); await visit('logic', '논리판단'); await endSectionByModal(page); await waitStage(page, 'intro');
  await startSection(page); await visit('data', '정보추론'); await endSectionByModal(page); await waitStage(page, 'intro');
  await page.click('[data-act="start-section"]'); await waitStage(page, 'study'); await probe('도식 숙지');
  await page.click('[data-act="skip-study"]'); await waitStage(page, 'question');
  await visit('diagram', '도식이해');
  await page.click('[data-act="rules-drawer"]'); await probe('도식 규칙표 패널'); await page.click('.drawer .dh button');
  await endSectionByModal(page); await waitStage(page, 'intro');
  await startSection(page); await visit('spatial', '공간지각');
  await page.click('[data-act="end-section"]'); await modalText(page); await probe('영역 종료 모달'); await modalClick(page, '제출하고 종료');
  await waitStage(page, 'complete');
  await page.check('#erase'); await page.click('#ck-next');
  await probe('적성 결과 요약');
  await page.click('[data-act="res-tab"][data-tab="table"]'); await probe('적성 결과 문항별');
  await page.click('[data-act="res-tab"][data-tab="review"]'); await probe('적성 해설 보기');
  await page.click('[data-act="home"]');

  for (const likert of [5, 7]) {
    await setSettings(page, { likert, part2: likert === 5 ? 'yn' : 'l5' });
    await page.click('[data-act="start-pers"][data-set="2"]');
    await waitStage(page, 'info');
    await page.click('[data-act="confirm-info"]');
    await waitStage(page, 'intro');
    await probe(`인성 안내(${likert}점)`);
    await page.click('[data-act="begin-pers"]');
    await waitStage(page, 'part');
    await probe(`인성 Ⅰ부(${likert}점)`);
    await advance(page, 60 * 60000);
    await waitStage(page, 'between');
    await modalClick(page, '확인');
    await page.click('[data-act="begin-part2"]');
    await waitStage(page, 'part');
    await probe(`인성 Ⅱ부(${likert === 5 ? '예/아니오' : '5점'})`);
    await advance(page, 60 * 60000);
    await waitStage(page, 'complete');
    await modalClick(page, '확인');
    await page.click('#ck-next');
    await page.waitForSelector('.score-grid');
    await probe(`인성 결과(${likert}점)`);
    await page.click('[data-act="home"]');
  }
});

/* ================= 7) 결과 해설 보기 필터 ================= */
scenario(7, "결과 '해설 보기' 필터(틀린 문항만·검토 표시)", async ({ check, open }) => {
  const { page } = await open();
  await setSettings(page, { variant: 'H2', mode: 'practice' });
  await startAptToIntro(page, 3);
  const plan = { verbal: [5, 4], logic: [3, 3], data: [8, 2], diagram: [2, 1] };
  let correct = 0, total = 0, flagged = [];
  for (const key of ['verbal', 'logic', 'data', 'diagram']) {
    await startSection(page);
    const keys = await keysOf(page, 3, key);
    await applyPlan(page, makePlan(keys, ...plan[key]));
    correct += plan[key][0]; total += keys.length;
    // 정답 1개, 오답 1개에 검토 표시
    for (const q of [0, plan[key][0]]) { await page.click(`#palette button[data-q="${q}"]`).catch(() => {}); if ((await st(page)).qIdx === q) { await page.click('#flag-btn'); flagged.push(`${key}-${q}`); } }
    await endSectionByModal(page);
    await waitFor(page, () => ['intro', 'complete'].includes(window.HMATApp.state().stage));
  }
  await page.check('#erase');
  await page.click('#ck-next');
  await page.click('[data-act="res-tab"][data-tab="review"]');
  check(await count(page, '.review-item') === total, `전체 필터 ${await count(page, '.review-item')}개(${total} 기대)`);
  await page.click('[data-act="res-filter"][data-f="wrong"]');
  const wrongTags = await page.$$eval('.review-item .rh .tag:first-of-type', (els) => els.map((e) => e.innerText.trim()));
  check(wrongTags.length === total - correct, `틀린 문항 필터 ${wrongTags.length}개(${total - correct} 기대)`);
  check(wrongTags.every((t) => t === '오답' || t === '미응답'), '틀린 문항 필터에 정답 문항이 섞임: ' + [...new Set(wrongTags)].join(','));
  check(wrongTags.filter((t) => t === '오답').length === Object.values(plan).reduce((a, p) => a + p[1], 0), '틀린 문항 필터의 오답 개수 불일치');
  check(await hasClass(page, '[data-act="res-filter"][data-f="wrong"]', 'primary'), '필터 버튼 선택 표시 없음');
  const junk = await bodyHasJunk(page, 'main');
  check(!junk, '해설(틀린 문항) 화면에 ' + junk);
  await page.click('[data-act="res-filter"][data-f="flag"]');
  check(await count(page, '.review-item') === flagged.length, `검토 표시 필터 ${await count(page, '.review-item')}개(${flagged.length} 기대)`);
  await page.click('[data-act="res-filter"][data-f="all"]');
  check(await count(page, '.review-item') === total, '전체 필터로 돌아오지 않음');
  // 문항별 결과표 행 클릭 → 해설로 이동
  await page.click('[data-act="res-tab"][data-tab="table"]');
  await page.click('tr[data-act="review-one"][data-sec="2"][data-q="4"]');
  check(await count(page, '#rv-2-4') === 1 && await page.locator('#rv-2-4').isVisible(), '결과표 행 클릭 시 해당 해설로 이동하지 않음');
});

/* ---------------- 실행 ---------------- */
const only = process.argv.slice(2).map(Number).filter(Boolean);
browser = await chromium.launch();
let allOk = true;
console.log(`HMAT E2E — ${APP_URL}`);
for (const sc of SCENARIOS) {
  if (only.length && !only.includes(sc.no)) continue;
  const ok = await runScenario(sc);
  allOk = allOk && ok;
}
await browser.close();
console.log(allOk ? '\n결과: 모든 시나리오 통과' : '\n결과: 실패한 시나리오가 있습니다');
process.exit(allOk ? 0 : 1);
