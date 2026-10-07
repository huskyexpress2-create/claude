/* HMAT 대비 모의고사(비공식) — 시험 진행 엔진 */
(function () {
  'use strict';
  var R = window.HMATRender, P = window.HMATPersonality;
  var root = document.getElementById('app');
  var CIRC = R.CIRCLED;
  var esc = R.esc;

  var SECTION_META = {
    verbal: { name: '언어이해', minutes: 20, desc: '글을 읽고 세부 내용, 추론, 주제, 문단 배열, 빈칸 등을 판단합니다.' },
    logic: { name: '논리판단', minutes: 15, desc: '명제, 조건추리, 참·거짓 진술 등 논리적 추론 능력을 평가합니다.' },
    data: { name: '정보추론', sub: '자료해석', minutes: 20, desc: '표·그래프·보도자료를 해석하고 계산·추론합니다.' },
    diagram: { name: '도식이해', minutes: 12, studyMinutes: 4, desc: '기호별 변환 규칙을 숙지한 뒤 도식의 결과를 추론합니다.' },
    spatial: { name: '공간지각', minutes: 15, desc: '투상도, 전개도, 종이 접기, 블록 등 공간 추론 능력을 평가합니다.' }
  };
  var VARIANTS = {
    H2: { name: '하반기형', desc: '언어이해 · 논리판단 · 정보추론 · 도식이해', sections: ['verbal', 'logic', 'data', 'diagram'] },
    H1: { name: '상반기형', desc: '언어이해 · 논리판단 · 정보추론 · 공간지각', sections: ['verbal', 'logic', 'data', 'spatial'] },
    ALL: { name: '5영역 전체', desc: '도식이해와 공간지각 모두 포함', sections: ['verbal', 'logic', 'data', 'diagram', 'spatial'] }
  };
  var DEFAULTS = {
    variant: 'H2', mode: 'real', tools: false, rulesVisible: true, introTimer: 0, penalty: false, flag: true,
    fullscreen: true, focusWarn: true, proctorPause: false, blind: false,
    likert: 5, part2: 'yn', persTiming: 'split', pageTimer: true
  };
  var PERS_TIMING = {
    split: { name: 'Ⅰ부 50분 + Ⅱ부 45분', parts: [50, 45] },
    total110: { name: '합산 110분', total: 110 },
    total80: { name: '합산 80분', total: 80 }
  };
  var PAGE_SECONDS = [165, 90]; // 페이지 제한시간(모의값): Ⅰ부 3묶음, Ⅱ부 10문항
  var PART2_PER_PAGE = 10, PART1_PER_PAGE = 3;

  /* ---------- 저장소 ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('hmat-mock:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('hmat-mock:' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
    del: function (k) { try { localStorage.removeItem('hmat-mock:' + k); } catch (e) { /* noop */ } }
  };
  var settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  var S = null;            // 진행 중 세션
  var tick = null;         // 타이머 interval
  var qShownAt = 0;        // 현재 문항 표시 시각(소요시간 측정)
  var proctorFired = false;

  function now() { return Date.now(); }
  function save() { if (S) store.set('session', S); }
  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtDur(ms) {
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + '분 ' + String(s % 60).padStart(2, '0') + '초';
  }
  function setData(n) { return (window.HMAT && HMAT.sets[n]) || { sections: {} }; }
  function sectionItems(n, key) {
    var p = setData(n).sections[key];
    if (!p) return [];
    return Array.isArray(p) ? p : (p.items || []);
  }
  function sectionRules(n, key) { var p = setData(n).sections[key]; return p && !Array.isArray(p) ? p.rules : null; }
  function itemById(n, key, id) {
    var list = sectionItems(n, key);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function hasSection(n, key) { return sectionItems(n, key).length > 0; }
  function show(html) { clearToasts(); root.innerHTML = html; window.scrollTo(0, 0); }
  function clearToasts() { document.querySelectorAll('.toast').forEach(function (t) { t.remove(); }); }
  function footer() { return '<div class="page-foot">현대자동차 및 현대자동차그룹과 무관한 비공식 연습용 모의고사입니다. 실제 시험 화면·문항을 재현한 것이 아니며, 모든 문항은 새로 작성되었습니다.</div>'; }
  function pageHead(right) {
    return '<header class="page-head"><div class="brand">HMAT 대비 모의고사<small>비공식 연습용</small></div><div>' + (right || '') + '</div></header>';
  }

  /* ---------- 모달 ---------- */
  function modal(title, body, actions) {
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><div class="mb">' + body + '</div><div class="ma"></div></div>';
      var ma = back.querySelector('.ma');
      (actions || [{ label: '확인', value: true, cls: 'primary' }]).forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'btn ' + (a.cls || '');
        b.textContent = a.label;
        b.onclick = function () { back.remove(); resolve(a.value); };
        ma.appendChild(b);
      });
      document.body.appendChild(back);
      var last = ma.lastChild; if (last) last.focus();
    });
  }

  /* ---------- 홈 ---------- */
  function seg(key, options) {
    return '<div class="seg" data-setting="' + key + '">' + options.map(function (o) {
      return '<button type="button" data-val="' + esc(JSON.stringify(o[0])) + '" class="' + (settings[key] === o[0] ? 'on' : '') + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function home() {
    stopTick();
    exitFullscreen();
    var hist = store.get('history', []);
    var pending = store.get('session', null);
    var h = '<div class="page">' + pageHead('<button class="btn small ghost" style="color:#fff" data-act="about">시험 구성·근거</button>') + '<main class="page-body">';
    h += '<div class="hero"><div><h1>HMAT 인성·적성검사 모의고사</h1><p>온라인 HMAT 응시 흐름(영역별 독립 타이머, 영역 내 자유 이동, 이전 영역 복귀 불가, 도식 규칙 숙지 시간, 인성 Ⅰ·Ⅱ부)을 재현한 3회분 모의고사입니다.</p></div></div>';
    if (pending && !pending.finished) {
      var label = pending.kind === 'apt' ? '적성검사' : '인성검사';
      h += '<div class="notice info" style="margin-bottom:16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>진행 중인 응시가 있습니다: <b>제' + pending.set + '회 ' + label + '</b>. 남은 시간은 실제 시간 기준으로 계속 흐르고 있습니다.</span><span style="display:flex;gap:6px"><button class="btn small accent" data-act="resume">이어서 응시</button><button class="btn small" data-act="discard">응시 포기</button></span></div>';
    }
    h += '<div class="set-grid">';
    [1, 2, 3].forEach(function (n) {
      var v = VARIANTS[settings.variant];
      var ready = v.sections.filter(function (k) { return hasSection(n, k); }).length;
      var lastApt = hist.filter(function (r) { return r.kind === 'apt' && r.set === n; }).slice(-1)[0];
      var lastPers = hist.filter(function (r) { return r.kind === 'pers' && r.set === n; }).slice(-1)[0];
      h += '<div class="set-card"><h3>제' + n + '회 모의고사</h3>';
      h += '<div class="meta">적성 ' + v.sections.map(function (k) { return SECTION_META[k].name + ' ' + sectionItems(n, k).length; }).join(' · ') + '</div>';
      h += '<div class="meta">인성 Ⅰ부 ' + P.PART1_BLOCKS + '묶음(156진술) · Ⅱ부 300문항</div>';
      if (lastApt) h += '<div class="last">최근 적성: ' + lastApt.correct + ' / ' + lastApt.total + ' (' + new Date(lastApt.at).toLocaleDateString('ko-KR') + ') <a href="#" data-act="view-result" data-id="' + lastApt.uid + '">결과 보기</a></div>';
      if (lastPers) h += '<div class="last">최근 인성: 응답 ' + lastPers.answered + ' / ' + lastPers.total + ' <a href="#" data-act="view-result" data-id="' + lastPers.uid + '">결과 보기</a></div>';
      h += '<div class="actions"><button class="btn primary" data-act="start-apt" data-set="' + n + '"' + (ready < v.sections.length ? ' disabled title="문항 데이터가 없습니다"' : '') + '>적성검사 응시</button>';
      h += '<button class="btn" data-act="start-pers" data-set="' + n + '"' + ((HMAT.personalityBank || []).length < 300 ? ' disabled title="인성 문항 데이터가 없습니다"' : '') + '>인성검사 응시</button></div></div>';
    });
    h += '</div>';

    h += '<div class="card" style="margin-top:16px"><h2>응시 설정</h2><div class="settings-grid">';
    h += '<div class="setting"><label class="title">적성 유형</label>' + seg('variant', [['H2', '하반기형(도식)'], ['H1', '상반기형(공간)'], ['ALL', '5영역 전체']]) + '<div class="hint">' + esc(VARIANTS[settings.variant].desc) + '. 2026 하반기 실제 구성은 미확인입니다.</div></div>';
    h += '<div class="setting"><label class="title">모드</label>' + seg('mode', [['real', '실전'], ['practice', '연습']]) + '<div class="hint">실전: 사전점검·전체화면·이탈 경고·일시정지 불가. 연습: 일시정지와 문항별 정답 확인 가능.</div></div>';
    h += '<div class="setting"><label class="title">화면 계산기·메모장</label>' + seg('tools', [[false, '미제공'], [true, '제공']]) + '<div class="hint">제공 여부는 출처마다 다릅니다(2025 하반기 후기: 미제공, 연습장 사용).</div></div>';
    h += '<div class="setting"><label class="title">도식 규칙표(문항 풀이 중)</label>' + seg('rulesVisible', [[true, '참조 가능'], [false, '숨김(암기)']]) + '<div class="hint">규칙 숙지 4분 뒤 규칙표를 다시 볼 수 있는지는 확인되지 않았습니다.</div></div>';
    h += '<div class="setting"><label class="title">영역 안내 화면</label>' + seg('introTimer', [[0, '직접 시작'], [60, '60초 후 자동 시작']]) + '</div>';
    h += '<div class="setting"><label class="title">오답 감점</label>' + seg('penalty', [[false, '없음'], [true, '오답당 -0.25']]) + '<div class="hint">감점 여부는 비공식 정보입니다(대부분 영역 감점 없음).</div></div>';
    h += '<div class="setting"><label class="title">검토 표시(플래그)</label>' + seg('flag', [[true, '사용'], [false, '사용 안 함']]) + '</div>';
    h += '<div class="setting"><label class="title">감독 시뮬레이션</label>' + seg('proctorPause', [[false, '끔'], [true, '임의 환경 재점검']]) + '<div class="hint">실전 모드에서 시험 도중 한 번 감독관 재점검 화면이 나타납니다.</div></div>';
    h += '<div class="setting"><label class="title">인성 Ⅰ부 척도</label>' + seg('likert', [[5, '5점'], [7, '7점']]) + '<div class="hint">후기마다 5점/7점으로 엇갈립니다.</div></div>';
    h += '<div class="setting"><label class="title">인성 Ⅱ부 응답</label>' + seg('part2', [['yn', '예/아니오'], ['l4', '4점'], ['l5', '5점']]) + '</div>';
    h += '<div class="setting"><label class="title">인성 시간</label>' + seg('persTiming', [['split', '50분+45분'], ['total110', '합산 110분'], ['total80', '합산 80분']]) + '</div>';
    h += '<div class="setting"><label class="title">인성 페이지 제한시간</label>' + seg('pageTimer', [[true, '사용(Ⅰ ' + PAGE_SECONDS[0] + '초·Ⅱ ' + PAGE_SECONDS[1] + '초)'], [false, '사용 안 함']]) + '</div>';
    h += '</div><div class="center-actions" style="justify-content:flex-start"><button class="btn small" data-act="reset-settings">기본값으로</button><a class="btn small" href="print-sheet.html" target="_blank" rel="noopener">연습장 양식 인쇄</a>' + (hist.length ? '<button class="btn small" data-act="history">응시 기록 (' + hist.length + ')</button>' : '') + '</div></div>';

    h += '<div class="card"><h2>이용 전 알아둘 점</h2><ul class="rules-list small">';
    h += '<li>공개 응시 후기·교재 정보를 근거로 구성했으며, 실제 HMAT 화면과 문항 수·시간이 다를 수 있습니다. 근거 수준은 상단 <a href="#" data-act="about">시험 구성·근거</a>에서 확인하세요.</li>';
    h += '<li>실제 시험은 PC(크롬)에서 웹캠·휴대폰 카메라 감독 하에 치릅니다. 이 모의고사는 카메라 영상을 녹화하거나 전송하지 않습니다.</li>';
    h += '<li>자료해석 수치는 모두 가상의 수치입니다. 인성검사 결과는 규준이 없는 참고 지표이며 합격 여부를 예측하지 않습니다.</li>';
    h += '<li>응답·기록은 이 브라우저(localStorage)에만 저장됩니다.</li></ul></div>';
    h += '</main>' + footer() + '</div>';
    show(h);
  }

  function aboutModal() {
    var rows = [
      ['언어이해', '15문항 / 20분', 'm', '2025 하반기 상세 후기 1건(20문항 보고도 있음)'],
      ['논리판단', '10문항 / 15분', 'm', '2025 하반기 후기'],
      ['정보추론(자료해석)', '15문항 / 20분', 'm', '2025 하반기 후기'],
      ['도식이해', '규칙 숙지 4분 + 8문항 / 12분', 'l', '2025 하반기 단일 후기'],
      ['공간지각', '10문항 / 15분', 'l', '2026 상반기 후기(시간은 추정)'],
      ['인성검사', 'Ⅰ부 3진술 묶음(척도+가/멀) · Ⅱ부 300문항, 최대 110분', 'm', '가이드 다수, 척도·세부 시간은 출처 충돌'],
      ['영역별 독립 타이머·이전 영역 복귀 불가', '—', 'm', '후기 여러 건'],
      ['문항 팔레트·OMR 표기란·검토 표시 등 화면 배치', '—', 'l', '공개 스크린샷 없음, 국내 CBT 일반형으로 근사']
    ];
    var b = '<table class="info"><tr><th>항목</th><th>모의고사 설정</th><th>근거</th></tr>' + rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td><span class="conf ' + r[2] + '">' + { h: '상', m: '중', l: '하' }[r[2]] + '</span> ' + r[3] + '</td></tr>';
    }).join('') + '</table><p class="small muted">현대자동차는 HMAT 문항 수·시간·화면을 공식 공개하지 않습니다. 상세 조사 내용은 저장소의 docs/research-spec.md, docs/research-critic.md를 참고하세요.</p>';
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal" style="width:min(760px,100%)"><h3>시험 구성과 근거 수준</h3><div>' + b + '</div><div class="ma"><button class="btn primary">닫기</button></div></div>';
    back.querySelector('button').onclick = function () { back.remove(); };
    back.onclick = function (e) { if (e.target === back) back.remove(); };
    document.body.appendChild(back);
  }

  /* ---------- 적성검사: 세션 생성 ---------- */
  function newCandidate() {
    var d = new Date();
    return { name: store.get('name', ''), id: 'HM' + d.getFullYear() + '-' + String(Math.floor(100000 + Math.random() * 900000)) };
  }

  function startApt(setNo) {
    var v = VARIANTS[settings.variant];
    S = {
      uid: 'a' + now().toString(36),
      kind: 'apt', set: setNo, variant: settings.variant, settings: Object.assign({}, settings),
      candidate: newCandidate(),
      sections: v.sections.map(function (k) {
        return { key: k, ids: sectionItems(setNo, k).map(function (it) { return it.id; }), answers: {}, flags: {}, times: {}, status: 'pending', endAt: null, remain: null, studyEndAt: null };
      }),
      secIdx: 0, qIdx: 0, stage: settings.mode === 'real' ? 'precheck' : 'info',
      focusLoss: 0, createdAt: now(), finished: false
    };
    proctorFired = false;
    save();
    route();
  }

  function startPers(setNo) {
    var parts = P.build(setNo);
    S = {
      uid: 'p' + now().toString(36),
      kind: 'pers', set: setNo, settings: Object.assign({}, settings),
      candidate: newCandidate(),
      parts: parts, answers: {}, fc: {}, part: 0, page: 0, stage: 'info',
      partEndAt: null, totalEndAt: null, pageEndAt: null, createdAt: now(), finished: false, timedOutPages: 0
    };
    save();
    route();
  }

  /* ---------- 라우터 ---------- */
  function route() {
    if (!S) return home();
    if (S.kind === 'apt') {
      switch (S.stage) {
        case 'precheck': return precheck();
        case 'checkin': return checkin();
        case 'info': return candidateInfo();
        case 'rules': return generalRules();
        case 'intro': return sectionIntro();
        case 'study': return studyScreen();
        case 'question': return examScreen();
        case 'complete': return completeScreen();
        case 'results': return aptResults(S);
      }
    } else {
      switch (S.stage) {
        case 'info': return candidateInfo();
        case 'intro': return persIntro();
        case 'part': return persScreen();
        case 'between': return persBetween();
        case 'complete': return completeScreen();
        case 'results': return persResults(S);
      }
    }
    home();
  }

  function stepBar(cur) {
    var steps = S.settings.mode === 'real' ? [['precheck', '사전 점검'], ['checkin', '감독 확인'], ['info', '응시자 확인'], ['rules', '유의사항']] : [['info', '응시자 확인'], ['rules', '유의사항']];
    var idx = steps.map(function (s) { return s[0]; }).indexOf(cur);
    return '<div class="steps">' + steps.map(function (s, i) { return '<span class="' + (i === idx ? 'on' : i < idx ? 'done' : '') + '">' + (i + 1) + '. ' + s[1] + '</span>'; }).join('') + '</div>';
  }
  function titleOf() { return '제' + S.set + '회 ' + (S.kind === 'apt' ? '적성검사' : '인성검사'); }

  /* ---------- 사전 점검 ---------- */
  function precheck() {
    var ua = navigator.userAgent;
    var chrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
    var wide = window.screen && window.screen.width >= 1280;
    var fsOk = !!(document.documentElement.requestFullscreen);
    var items = [
      [chrome, '브라우저', chrome ? 'Chrome 브라우저입니다.' : 'Chrome 사용을 권장합니다(실제 시험 권장 환경).'],
      [wide, '화면 해상도', '현재 ' + (window.screen ? window.screen.width + '×' + window.screen.height : '알 수 없음') + ' (1280px 이상 권장)'],
      [fsOk, '전체화면', fsOk ? '전체화면 전환을 지원합니다.' : '전체화면을 지원하지 않습니다.'],
      [navigator.onLine !== false, '네트워크', '연결 상태 확인']
    ];
    var h = '<div class="page">' + pageHead(titleOf()) + '<main class="page-body">' + stepBar('precheck') + '<div class="card"><h2>사전 점검</h2><p class="muted small">실제 시험에서는 전날까지 PC 사양·접속 사전 테스트를 마쳐야 합니다. 이 화면은 그 과정을 간단히 흉내 냅니다.</p><ul class="checklist">';
    items.forEach(function (it) { h += '<li class="' + (it[0] ? 'ok' : 'ng') + '"><b style="min-width:92px">' + (it[0] ? '✔ ' : '! ') + it[1] + '</b><span>' + esc(it[2]) + '</span></li>'; });
    h += '</ul><h3>카메라 미리보기 (선택)</h3><p class="small muted">실제 시험은 웹캠과 휴대폰 카메라로 감독합니다. 아래 버튼은 이 기기에서만 미리보기를 보여 주며 영상은 저장·전송되지 않습니다.</p>';
    h += '<div class="form-row"><button class="btn small" data-act="cam">카메라 미리보기 켜기</button><video class="cam-preview hidden" autoplay muted playsinline></video></div>';
    h += '<div class="center-actions"><button class="btn" data-act="home">처음으로</button><button class="btn primary" data-act="goto" data-stage="checkin">다음</button></div></div></main>' + footer() + '</div>';
    show(h);
  }

  function checkin() {
    var list = [
      '신분증을 준비했습니다.',
      '휴대폰은 감독용 카메라로만 사용하며, 알림을 끄고 다른 앱은 종료했습니다.',
      '책상 위에는 PC, 신분증, 연습장(L자 투명파일에 넣은 인쇄 연습장)과 보드마카만 둡니다.',
      '응시 공간을 360도로 촬영해 주변에 다른 사람이나 자료가 없음을 보였습니다.',
      '연습장의 앞뒷면이 비어 있음을 카메라에 보였습니다.',
      '시험 중 자리를 비우거나 다른 창으로 전환하지 않습니다.'
    ];
    var h = '<div class="page">' + pageHead(titleOf()) + '<main class="page-body">' + stepBar('checkin') + '<div class="card"><h2>감독 환경 확인</h2><p class="muted small">실제 체크인은 약 1시간 동안 감독관과 진행된다고 알려져 있습니다(후기 기준). 여기서는 체크리스트로 대신합니다.</p><ul class="checklist">';
    list.forEach(function (t, i) { h += '<li><input type="checkbox" id="ck' + i + '" data-ck><label for="ck' + i + '">' + esc(t) + '</label></li>'; });
    h += '</ul><div class="center-actions"><button class="btn" data-act="goto" data-stage="precheck">이전</button><button class="btn" data-act="goto" data-stage="info">건너뛰기</button><button class="btn primary" id="ck-next" data-act="goto" data-stage="info" disabled>다음</button></div></div></main>' + footer() + '</div>';
    show(h);
  }

  function candidateInfo() {
    var h = '<div class="page">' + pageHead(titleOf()) + '<main class="page-body">' + (S.kind === 'apt' ? stepBar('info') : '') + '<div class="card"><h2>응시자 정보 확인</h2>';
    h += '<div class="form-row"><label>수험번호</label><span class="ro">' + esc(S.candidate.id) + '</span><span class="small muted">(모의 번호)</span></div>';
    h += '<div class="form-row"><label for="nm">성명</label><input type="text" id="nm" maxlength="20" placeholder="이름(선택)" value="' + esc(S.candidate.name) + '"></div>';
    h += '<div class="form-row"><label>검사</label><span>' + esc(titleOf()) + (S.kind === 'apt' ? ' · ' + (S.settings.blind ? '구성 비공개' : VARIANTS[S.variant].desc) : '') + '</span></div>';
    h += '<div class="center-actions"><button class="btn" data-act="home">처음으로</button><button class="btn primary" data-act="confirm-info">확인</button></div></div></main>' + footer() + '</div>';
    show(h);
  }

  function generalRules() {
    var secs = S.sections.map(function (s) { var m = SECTION_META[s.key]; return m.name + ' ' + s.ids.length + '문항 ' + m.minutes + '분' + (m.studyMinutes ? '(+규칙 숙지 ' + m.studyMinutes + '분)' : ''); });
    var h = '<div class="page">' + pageHead(titleOf()) + '<main class="page-body">' + stepBar('rules') + '<div class="card"><h2>적성검사 유의사항</h2><ol class="rules-list">';
    h += '<li>검사는 <b>' + secs.length + '개 영역</b>으로 구성되며 영역마다 제한시간이 따로 주어집니다.<br><span class="small muted">' + esc(secs.join(' → ')) + '</span></li>';
    h += '<li>영역 안에서는 문항을 자유롭게 이동하며 답을 고칠 수 있지만, <b>종료된 영역으로는 돌아갈 수 없습니다.</b></li>';
    h += '<li>제한시간이 끝나면 답안이 자동 제출되고 다음 영역으로 넘어갑니다. 남은 시간은 다음 영역으로 이월되지 않습니다.</li>';
    h += '<li>답은 문항의 선지를 누르거나 오른쪽 답안 표기란을 눌러 표시합니다. 같은 선지를 다시 누르면 선택이 해제됩니다.</li>';
    if (S.sections.some(function (s) { return s.key === 'diagram'; })) h += '<li>도식이해는 시작 전 <b>4분간 규칙을 숙지</b>한 뒤 문항이 시작됩니다' + (S.settings.rulesVisible ? '(문항 풀이 중 규칙표 참조 가능).' : '(문항 풀이 중 규칙표는 볼 수 없습니다).') + '</li>';
    h += '<li>' + (S.settings.tools ? '화면의 계산기와 메모장을 사용할 수 있습니다.' : '<b>계산기와 메모장은 제공되지 않습니다.</b> 인쇄한 연습장(보드마카)을 사용하세요.') + '</li>';
    h += '<li>' + (S.settings.penalty ? '오답은 문항당 0.25점 감점됩니다(모의 설정).' : '오답 감점은 없는 것으로 알려져 있습니다(비공식). 정답 수로 채점합니다.') + '</li>';
    if (S.settings.mode === 'real') h += '<li>실전 모드에서는 전체화면이 유지되어야 하며, 다른 창으로 전환하면 이탈 기록이 남습니다. 일시정지는 할 수 없습니다.</li>';
    else h += '<li>연습 모드에서는 일시정지와 문항별 정답 확인이 가능합니다.</li>';
    h += '</ol><div class="center-actions"><button class="btn" data-act="goto" data-stage="info">이전</button><button class="btn primary large" data-act="begin-apt">검사 시작</button></div></div></main>' + footer() + '</div>';
    show(h);
  }

  /* ---------- 영역 안내 · 규칙 숙지 ---------- */
  function cur() { return S.sections[S.secIdx]; }

  function sectionIntro() {
    var sec = cur(), m = SECTION_META[sec.key];
    var auto = S.settings.introTimer > 0;
    if (auto && !sec.introEndAt) { sec.introEndAt = now() + S.settings.introTimer * 1000; save(); }
    var h = '<div class="page">' + pageHead(titleOf() + ' · ' + esc(S.candidate.id)) + '<main class="page-body"><div class="card section-intro">';
    h += '<div class="order">영역 ' + (S.secIdx + 1) + ' / ' + S.sections.length + '</div><h2>' + m.name + (m.sub ? ' <span class="muted" style="font-size:18px">(' + m.sub + ')</span>' : '') + '</h2>';
    h += '<div class="spec"><span>문항 수 <b>' + sec.ids.length + '</b></span><span>제한시간 <b>' + m.minutes + '분</b></span>' + (m.studyMinutes ? '<span>규칙 숙지 <b>' + m.studyMinutes + '분</b></span>' : '') + '</div>';
    h += '<p class="muted">' + esc(m.desc) + '</p>';
    if (sec.key === 'diagram') h += '<p class="small">시작하면 규칙 숙지 화면이 ' + m.studyMinutes + '분간 표시되고, 시간이 끝나면 자동으로 문항이 시작됩니다.</p>';
    if (auto) h += '<div class="auto" id="intro-count">' + mmss(sec.introEndAt - now()) + ' 후 자동으로 시작합니다.</div>';
    if (!S.settings.blind) h += '<div class="section-progress">' + S.sections.map(function (s, i) { return '<span class="' + (i === S.secIdx ? 'cur' : i < S.secIdx ? 'done' : '') + '">' + SECTION_META[s.key].name + '</span>'; }).join('') + '</div>';
    h += '<div class="center-actions"><button class="btn primary large" data-act="start-section">시작하기</button></div></div></main>' + footer() + '</div>';
    show(h);
    if (auto) startTick(); else stopTick();
  }

  function beginSection() {
    var sec = cur(), m = SECTION_META[sec.key];
    sec.introEndAt = null;
    if (m.studyMinutes && sec.status === 'pending') {
      sec.status = 'study';
      sec.studyEndAt = now() + m.studyMinutes * 60000;
      S.stage = 'study';
    } else {
      activateSection();
    }
    save();
    enterFullscreen();
    route();
  }

  function activateSection() {
    var sec = cur(), m = SECTION_META[sec.key];
    sec.status = 'active';
    sec.endAt = now() + m.minutes * 60000;
    sec.startedAt = now();
    sec.studyEndAt = null;
    S.qIdx = 0;
    S.stage = 'question';
    scheduleProctor(sec, m.minutes * 60000);
  }

  function scheduleProctor(sec, dur) {
    if (!S.settings.proctorPause || S.settings.mode !== 'real' || proctorFired || S.proctorDone) return;
    if (S.secIdx === 0) return;
    if (Math.random() < 0.6) sec.proctorAt = now() + dur * (0.2 + Math.random() * 0.5);
  }

  function studyScreen() {
    var sec = cur(), rules = sectionRules(S.set, sec.key);
    var h = examHead('규칙 숙지', sec.studyEndAt - now(), '남은 숙지 시간');
    h += '<div class="exam-tools"><span class="qno-label">도식이해 규칙 숙지</span><span class="spacer"></span>' + (S.settings.mode === 'practice' ? '<button class="btn small" data-act="skip-study">바로 문항 시작</button>' : '<span class="small muted">숙지 시간이 끝나면 자동으로 문항이 시작됩니다.</span>') + '</div>';
    h += '<div class="exam-main"><div class="exam-content"><div class="pane single"><div class="study">' + R.ruleTableHtml(rules) + (S.settings.rulesVisible ? '' : '<p class="notice" style="margin-top:14px">문항 풀이 중에는 규칙표를 다시 볼 수 없습니다(암기 설정).</p>') + '</div></div></div></div>';
    h += '<div class="exam-foot"><span class="small muted">' + esc(S.candidate.id) + '</span><span class="spacer"></span></div>';
    showExam(h);
    startTick();
  }

  /* ---------- 문항 화면 ---------- */
  function examHead(secLabel, remainMs, timerLabel) {
    var who = esc(S.candidate.id) + (S.candidate.name ? '<br>' + esc(S.candidate.name) : '');
    return '<div class="mobile-banner">실제 시험은 PC 환경에서 응시합니다. 큰 화면을 권장합니다.</div><header class="exam-head"><div class="title">HMAT 모의고사<small>' + esc(titleOf()) + ' · 비공식</small></div><div class="sec">' + secLabel + '</div><div class="who">' + who + '</div><div class="timer" id="timer"><span class="lbl">' + (timerLabel || '남은 시간') + '</span><span class="val" id="timer-val">' + mmss(remainMs) + '</span></div></header>';
  }

  function showExam(html) {
    root.innerHTML = '<div class="exam' + (S.settings.mode === 'real' ? ' no-select' : '') + '" id="exam">' + html + '</div>';
  }

  function currentItem() {
    var sec = cur();
    return itemById(S.set, sec.key, sec.ids[S.qIdx]);
  }

  function examScreen() {
    var sec = cur(), m = SECTION_META[sec.key];
    var item = currentItem();
    if (!item) { show('<div class="page">' + pageHead() + '<main class="page-body"><div class="card"><h2>문항 데이터를 불러오지 못했습니다</h2><p>data 폴더의 문항 파일이 index.html에 포함되어 있는지 확인하세요.</p><button class="btn" data-act="home">처음으로</button></div></main></div>'); return; }
    var n = sec.ids.length;
    var answered = Object.keys(sec.answers).length;
    var remain = sec.remain != null ? sec.remain : sec.endAt - now();
    var h = examHead(m.name + '<span class="cnt">' + (S.qIdx + 1) + ' / ' + n + '</span>', remain);
    h += '<div class="exam-tools"><span class="qno-label">' + (S.qIdx + 1) + '번 문항</span>';
    if (S.settings.flag) h += '<button class="btn small" data-act="flag" id="flag-btn">' + (sec.flags[item.id] ? '★ 검토 표시 해제' : '☆ 검토 표시') + '</button>';
    h += '<span class="spacer"></span>';
    if (sec.key === 'diagram' && S.settings.rulesVisible) h += '<button class="btn small" data-act="rules-drawer">규칙표 보기</button>';
    if (S.settings.tools) h += '<button class="btn small" data-act="tool-memo">메모장</button><button class="btn small" data-act="tool-calc">계산기</button>';
    if (S.settings.mode === 'practice') h += '<button class="btn small" data-act="peek">정답 확인</button><button class="btn small" data-act="pause">일시정지</button>';
    h += '</div><div class="exam-main"><div class="exam-content" id="content">' + contentHtml(item, sec) + '</div>';
    h += '<aside class="omr"><div class="omr-head">답안 표기란<span class="cnt" id="omr-cnt">' + answered + ' / ' + n + '</span></div><div class="omr-body" id="omr-body">';
    sec.ids.forEach(function (id, i) {
      var a = sec.answers[id];
      h += '<div class="omr-row' + (i === S.qIdx ? ' cur' : '') + '" data-row="' + i + '"><button class="n' + (sec.flags[id] ? ' flag' : '') + '" data-act="goq" data-q="' + i + '">' + (i + 1) + '</button>';
      for (var c = 1; c <= 5; c++) h += '<button class="b' + (a === c ? ' on' : '') + '" data-act="omr" data-q="' + i + '" data-c="' + c + '" aria-label="' + (i + 1) + '번 ' + c + '">' + c + '</button>';
      h += '</div>';
    });
    h += '</div><div class="omr-foot"><div class="omr-legend"><span><i style="background:var(--navy)"></i>응답</span>' + (S.settings.flag ? '<span><i style="background:var(--flag);border-radius:0"></i>검토</span>' : '') + '</div><button class="btn danger" data-act="end-section">답안 제출(영역 종료)</button></div></aside></div>';
    h += '<footer class="exam-foot"><button class="btn" data-act="prev"' + (S.qIdx === 0 ? ' disabled' : '') + '>◀ 이전</button><div class="palette" id="palette">';
    sec.ids.forEach(function (id, i) {
      h += '<button class="' + (sec.answers[id] ? 'ans ' : '') + (i === S.qIdx ? 'cur ' : '') + (sec.flags[id] ? 'flag' : '') + '" data-act="goq" data-q="' + i + '">' + (i + 1) + '</button>';
    });
    h += '</div><button class="btn" data-act="next"' + (S.qIdx === n - 1 ? ' disabled' : '') + '>다음 ▶</button></footer>';
    var omrScroll = document.getElementById('omr-body') ? document.getElementById('omr-body').scrollTop : 0;
    var passScroll = document.querySelector('.pane.passage');
    var keepPassage = passScroll && S._lastGroup && item.group && S._lastGroup === item.group.id ? passScroll.scrollTop : 0;
    showExam(h);
    var ob = document.getElementById('omr-body'); if (ob) ob.scrollTop = omrScroll;
    var np = document.querySelector('.pane.passage'); if (np && keepPassage) np.scrollTop = keepPassage;
    S._lastGroup = item.group ? item.group.id : null;
    qShownAt = now();
    if (S.settings.mode === 'real') guardFullscreen();
    if (sec.remain != null) pauseOverlay();
    startTick();
  }

  function contentHtml(item, sec, reveal) {
    if (!item) return '<div class="pane single"><p>문항 데이터를 찾을 수 없습니다.</p></div>';
    var opts = { number: S.qIdx + 1, selected: sec.answers[item.id], interactive: true, reveal: !!reveal, answer: item.answer };
    if (R.hasPassage(item)) {
      return '<div class="pane passage">' + R.passageHtml(item) + '</div><div class="pane question">' + R.questionHtml(item, opts) + '</div>';
    }
    return '<div class="pane single">' + R.questionHtml(item, opts) + '</div>';
  }

  function refreshQuestionPane(reveal) {
    var sec = cur(), item = currentItem();
    var q = document.querySelector('.pane.question') || document.querySelector('.pane.single');
    if (!q) return;
    var opts = { number: S.qIdx + 1, selected: sec.answers[item.id], interactive: true, reveal: !!reveal, answer: item.answer };
    var st = q.scrollTop;
    q.innerHTML = R.questionHtml(item, opts);
    q.scrollTop = st;
  }

  function syncMarks() {
    var sec = cur();
    var n = sec.ids.length, answered = 0;
    sec.ids.forEach(function (id, i) {
      var a = sec.answers[id]; if (a) answered++;
      var row = document.querySelector('.omr-row[data-row="' + i + '"]');
      if (row) {
        row.querySelectorAll('.b').forEach(function (b) { b.classList.toggle('on', +b.dataset.c === a); });
        row.querySelector('.n').classList.toggle('flag', !!sec.flags[id]);
      }
      var p = document.querySelector('#palette button[data-q="' + i + '"]');
      if (p) { p.classList.toggle('ans', !!a); p.classList.toggle('flag', !!sec.flags[id]); }
    });
    var c = document.getElementById('omr-cnt'); if (c) c.textContent = answered + ' / ' + n;
    var fb = document.getElementById('flag-btn');
    if (fb) fb.textContent = sec.flags[sec.ids[S.qIdx]] ? '★ 검토 표시 해제' : '☆ 검토 표시';
  }

  function recordTime() {
    if (!S || S.kind !== 'apt' || S.stage !== 'question' || !qShownAt) return;
    var sec = cur(), id = sec.ids[S.qIdx];
    if (sec.remain != null) { qShownAt = now(); return; }
    sec.times[id] = (sec.times[id] || 0) + (now() - qShownAt);
    qShownAt = now();
  }

  function choose(qi, c) {
    var sec = cur(), id = sec.ids[qi];
    if (sec.answers[id] === c) delete sec.answers[id];
    else sec.answers[id] = c;
    save();
    if (qi === S.qIdx) refreshQuestionPane();
    syncMarks();
  }

  function goQ(i) {
    var sec = cur();
    if (i < 0 || i >= sec.ids.length || i === S.qIdx) return;
    recordTime();
    S.qIdx = i;
    save();
    examScreen();
  }

  function endSection(reason) {
    var sec = cur();
    recordTime();
    qShownAt = 0;
    sec.status = 'done';
    sec.endedAt = now();
    sec.used = Math.min(SECTION_META[sec.key].minutes * 60000, now() - (sec.startedAt || now()) - (sec.pausedMs || 0));
    sec.endReason = reason;
    sec.remain = null;
    closePanels();
    if (S.secIdx < S.sections.length - 1) {
      S.secIdx++;
      S.qIdx = 0;
      S.stage = 'intro';
    } else {
      S.stage = 'complete';
      S.finishedAt = now();
    }
    save();
    route();
  }

  async function confirmEnd() {
    var sec = cur();
    var un = sec.ids.length - Object.keys(sec.answers).length;
    var fl = Object.keys(sec.flags).filter(function (k) { return sec.flags[k]; }).length;
    var msg = '답안을 제출하고 <b>' + SECTION_META[sec.key].name + '</b> 영역을 종료하시겠습니까?\n종료한 영역으로는 돌아올 수 없으며, 남은 시간은 이월되지 않습니다.';
    if (un) msg += '\n\n<b style="color:var(--bad)">미응답 문항: ' + un + '개</b>';
    if (fl) msg += '\n검토 표시 문항: ' + fl + '개';
    var ok = await modal('영역 종료', msg, [{ label: '계속 풀기', value: false }, { label: '제출하고 종료', value: true, cls: 'danger' }]);
    if (ok && S && S.stage === 'question') endSection('submit');
  }

  /* ---------- 타이머 ---------- */
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }
  function startTick() { stopTick(); tick = setInterval(onTick, 250); onTick(); }

  function setTimerView(ms) {
    var el = document.getElementById('timer-val'); if (!el) return;
    el.textContent = mmss(ms);
    var t = document.getElementById('timer');
    if (t) { t.classList.toggle('warn', ms <= 5 * 60000 && ms > 60000); t.classList.toggle('crit', ms <= 60000); }
  }

  function onTick() {
    if (!S) return stopTick();
    if (S.kind === 'apt') {
      var sec = cur();
      if (S.stage === 'intro' && sec.introEndAt) {
        var left = sec.introEndAt - now();
        var ic = document.getElementById('intro-count');
        if (ic) ic.textContent = mmss(left) + ' 후 자동으로 시작합니다.';
        if (left <= 0) { stopTick(); beginSection(); }
        return;
      }
      if (S.stage === 'study') {
        var sl = sec.studyEndAt - now();
        setTimerView(sl);
        if (sl <= 0) { stopTick(); activateSection(); save(); route(); }
        return;
      }
      if (S.stage === 'question') {
        if (sec.remain != null) { setTimerView(sec.remain); return; }
        var rem = sec.endAt - now();
        setTimerView(rem);
        if (sec.proctorAt && now() >= sec.proctorAt) { sec.proctorAt = null; proctorFired = true; S.proctorDone = true; proctorPause(); return; }
        if (rem <= 60000 && rem > 0 && !sec.warned1) { sec.warned1 = true; save(); toast('종료 1분 전입니다.'); }
        if (rem <= 0) {
          stopTick();
          closeModals();
          endSection('timeout');
          modal('시간 종료', '제한시간이 끝나 답안이 자동 제출되었습니다.');
        }
      }
      return;
    }
    persTick();
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);background:var(--bad);color:#fff;padding:9px 18px;border-radius:8px;font-weight:700;z-index:120;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function closeModals() { document.querySelectorAll('.modal-back').forEach(function (m) { m.remove(); }); }

  /* 연습 모드 일시정지 */
  function pause() {
    var sec = cur();
    if (sec.remain != null) return;
    recordTime();
    sec.remain = sec.endAt - now();
    sec.pauseStart = now();
    save();
    pauseOverlay();
  }
  function pauseOverlay(msg) {
    var o = document.createElement('div');
    o.className = 'overlay-full';
    o.id = 'pause-ov';
    o.innerHTML = msg || '<h2>일시정지</h2><p>타이머가 멈췄습니다. 문항은 가려집니다.</p><button class="btn accent large" data-act="resume-pause">계속하기</button>';
    var old = document.getElementById('pause-ov'); if (old) old.remove();
    document.body.appendChild(o);
  }
  function resumePause() {
    var sec = cur();
    if (sec.remain == null) return;
    sec.endAt = now() + sec.remain;
    sec.pausedMs = (sec.pausedMs || 0) + (now() - (sec.pauseStart || now()));
    sec.remain = null;
    qShownAt = now();
    save();
    var o = document.getElementById('pause-ov'); if (o) o.remove();
  }
  function proctorPause() {
    var sec = cur();
    recordTime();
    sec.remain = sec.endAt - now();
    sec.pauseStart = now();
    save();
    pauseOverlay('<h2>감독관 요청: 응시 환경 재점검</h2><p>감독관이 응시 환경 재점검을 요청했습니다. 휴대폰 카메라로 책상 위와 주변을 다시 비춘 뒤 확인을 누르세요. 재점검 동안 타이머는 멈춥니다(모의).</p><button class="btn accent large" data-act="resume-pause">재점검 완료</button>');
  }

  /* ---------- 전체화면 · 이탈 감지 ---------- */
  function inExam() { return S && ((S.kind === 'apt' && (S.stage === 'question' || S.stage === 'study')) || (S.kind === 'pers' && S.stage === 'part')); }
  var fsBlocked = false; // iframe 등 전체화면이 불가능한 환경에서는 강제하지 않는다.
  function fsWanted() { return S && S.settings.mode === 'real' && S.settings.fullscreen && !fsBlocked && document.fullscreenEnabled !== false && !!document.documentElement.requestFullscreen; }
  function enterFullscreen() {
    if (!fsWanted()) return;
    var el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(guardFullscreen).catch(function () {
        fsBlocked = true;
        var ov = document.getElementById('fs-ov'); if (ov) ov.remove();
        toast('이 환경에서는 전체화면을 사용할 수 없어 일반 화면으로 진행합니다.');
      });
    }
  }
  function exitFullscreen() { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); }
  function guardFullscreen() {
    if (!fsWanted()) { var o2 = document.getElementById('fs-ov'); if (o2) o2.remove(); return; }
    var ov = document.getElementById('fs-ov');
    if (!document.fullscreenElement && inExam()) {
      if (!ov) {
        ov = document.createElement('div');
        ov.className = 'overlay-full'; ov.id = 'fs-ov';
        ov.innerHTML = '<h2>전체화면을 유지해 주세요</h2><p>실전 모드에서는 전체화면에서만 응시할 수 있습니다. 타이머는 계속 흐릅니다.</p><button class="btn accent large" data-act="fs-enter">전체화면으로 돌아가기</button>';
        document.body.appendChild(ov);
      }
    } else if (ov) ov.remove();
  }
  document.addEventListener('fullscreenchange', guardFullscreen);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && inExam() && S.settings.mode === 'real') {
      S.focusLoss = (S.focusLoss || 0) + 1; save();
      setTimeout(function () { modal('화면 이탈 감지', '시험 화면을 벗어난 기록이 남았습니다(누적 ' + S.focusLoss + '회).\n실제 시험에서는 부정행위로 간주될 수 있습니다.'); }, 50);
    }
  });
  ['contextmenu', 'copy', 'cut'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (inExam() && S.settings.mode === 'real') e.preventDefault(); });
  });

  /* ---------- 도구: 메모장 · 계산기 · 규칙표 ---------- */
  function closePanels() { document.querySelectorAll('.tool-panel,.drawer').forEach(function (p) { p.remove(); }); }
  function makePanel(id, title, inner, x, y) {
    var ex = document.getElementById(id); if (ex) { ex.remove(); return null; }
    var p = document.createElement('div');
    p.className = 'tool-panel'; p.id = id;
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.innerHTML = '<div class="th"><span>' + title + '</span><button aria-label="닫기">×</button></div>' + inner;
    p.querySelector('.th button').onclick = function () { p.remove(); };
    var th = p.querySelector('.th'), sx, sy, ox, oy;
    th.addEventListener('pointerdown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      sx = e.clientX; sy = e.clientY; ox = p.offsetLeft; oy = p.offsetTop; th.setPointerCapture(e.pointerId);
      th.onpointermove = function (ev) { p.style.left = Math.max(0, ox + ev.clientX - sx) + 'px'; p.style.top = Math.max(0, oy + ev.clientY - sy) + 'px'; };
      th.onpointerup = function () { th.onpointermove = null; };
    });
    document.body.appendChild(p);
    return p;
  }
  function openMemo() {
    var sec = cur();
    var p = makePanel('memo', '메모장', '<div class="memo"><textarea placeholder="메모를 입력하세요(영역이 끝나면 지워집니다)"></textarea></div>', 80, 120);
    if (!p) return;
    var ta = p.querySelector('textarea');
    ta.value = sec.memo || '';
    ta.oninput = function () { sec.memo = ta.value; save(); };
    ta.focus();
  }
  function openCalc() {
    var keys = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '='];
    var p = makePanel('calc', '계산기', '<div class="calc"><div class="disp"><div class="expr"></div><div class="res">0</div></div><div class="keys">' + keys.map(function (k) {
      return '<button data-k="' + k + '" class="' + (k === '=' ? 'eq' : /[÷×−+()]/.test(k) ? 'op' : '') + '">' + k + '</button>';
    }).join('') + '</div></div>', Math.max(20, window.innerWidth - 520), 120);
    if (!p) return;
    var expr = '', exEl = p.querySelector('.expr'), resEl = p.querySelector('.res');
    function evaluate(s) {
      var t = s.replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-');
      if (!/^[\d+\-*/().\s]*$/.test(t) || !t) return null;
      try { var v = Function('"use strict";return (' + t + ')')(); return isFinite(v) ? Math.round(v * 1e10) / 1e10 : null; } catch (e) { return null; }
    }
    function press(k) {
      if (k === 'C') expr = '';
      else if (k === '⌫') expr = expr.slice(0, -1);
      else if (k === '=') { var v = evaluate(expr); exEl.textContent = expr + ' ='; expr = v == null ? '' : String(v); resEl.textContent = v == null ? '오류' : v.toLocaleString('ko-KR', { maximumFractionDigits: 10 }); return; }
      else expr += k;
      exEl.textContent = expr;
      var pv = evaluate(expr); if (pv != null) resEl.textContent = pv.toLocaleString('ko-KR', { maximumFractionDigits: 10 });
    }
    p.querySelector('.keys').onclick = function (e) { var k = e.target.dataset && e.target.dataset.k; if (k) press(k); };
    p.tabIndex = 0;
    p.addEventListener('keydown', function (e) {
      var map = { '/': '÷', '*': '×', '-': '−', 'Enter': '=', 'Backspace': '⌫', 'Escape': 'C' };
      var k = map[e.key] || e.key;
      if (/^[\d.+()]$/.test(k) || ['÷', '×', '−', '=', '⌫', 'C'].indexOf(k) >= 0) { e.preventDefault(); e.stopPropagation(); press(k); }
    });
    p.focus();
  }
  function rulesDrawer() {
    var ex = document.querySelector('.drawer'); if (ex) { ex.remove(); return; }
    var d = document.createElement('div');
    d.className = 'drawer';
    d.innerHTML = '<div class="dh">도식 규칙표<button class="btn small" aria-label="닫기">닫기</button></div><div class="db">' + R.ruleTableHtml(sectionRules(S.set, cur().key)) + '</div>';
    d.querySelector('.dh button').onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }

  /* ---------- 종료 ---------- */
  function completeScreen() {
    stopTick();
    exitFullscreen();
    var h = '<div class="page">' + pageHead(titleOf()) + '<main class="page-body"><div class="card section-intro"><h2>응시가 완료되었습니다</h2><p class="muted">수고하셨습니다. 실제 시험에서는 결과가 공개되지 않으며, 종료 후 감독관 앞에서 연습장을 지우는 절차가 있는 것으로 알려져 있습니다.</p>';
    if (S.kind === 'apt') h += '<ul class="checklist" style="max-width:520px;margin:18px auto 0;text-align:left"><li><input type="checkbox" id="erase" data-ck><label for="erase">연습장(L자 파일)의 필기를 카메라 앞에서 모두 지웠습니다. (모의)</label></li></ul>';
    h += '<div class="center-actions"><button class="btn primary large" id="ck-next" data-act="to-results"' + (S.kind === 'apt' ? ' disabled' : '') + '>모의 결과 보기</button></div></div></main>' + footer() + '</div>';
    show(h);
  }

  function finalizeApt(sess) {
    var total = 0, correct = 0, wrong = 0;
    sess.sections.forEach(function (sec) {
      sec.ids.forEach(function (id) {
        var it = itemById(sess.set, sec.key, id); if (!it) return;
        total++;
        var a = sec.answers[id];
        if (a === it.answer) correct++; else if (a) wrong++;
      });
    });
    return { total: total, correct: correct, wrong: wrong };
  }

  function archive(sess) {
    var hist = store.get('history', []);
    if (hist.some(function (h) { return h.uid === sess.uid; })) return;
    var entry = { uid: sess.uid, kind: sess.kind, set: sess.set, at: now(), session: sess };
    if (sess.kind === 'apt') { var f = finalizeApt(sess); entry.correct = f.correct; entry.total = f.total; entry.variant = sess.variant; }
    else { var sc = P.score(sess); entry.answered = sc.answered; entry.total = sc.total; }
    hist.push(entry);
    while (hist.length > 30) hist.shift();
    store.set('history', hist);
  }

  /* ---------- 적성 결과 ---------- */
  function aptResults(sess, tab, filter) {
    stopTick();
    tab = tab || 'summary';
    var f = finalizeApt(sess);
    var penalty = sess.settings.penalty ? 0.25 : 0;
    var h = '<div class="page">' + pageHead('<button class="btn small" data-act="home">처음으로</button>') + '<main class="page-body">';
    h += '<div class="hero"><div><h1>제' + sess.set + '회 적성검사 모의 결과</h1><p>' + esc(VARIANTS[sess.variant].name) + ' · ' + new Date(sess.finishedAt || sess.createdAt).toLocaleString('ko-KR') + (sess.focusLoss ? ' · 화면 이탈 ' + sess.focusLoss + '회' : '') + '</p></div><div style="display:flex;gap:8px"><button class="btn" data-act="retry" data-set="' + sess.set + '">다시 응시</button></div></div>';
    h += '<div class="tabs">' + [['summary', '요약'], ['table', '문항별 결과'], ['review', '해설 보기']].map(function (t) { return '<button class="' + (tab === t[0] ? 'on' : '') + '" data-act="res-tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';

    if (tab === 'summary') {
      h += '<div class="score-grid"><div class="score-tile"><div class="k">전체 정답</div><div class="v">' + f.correct + ' <small>/ ' + f.total + '</small></div><div class="bar"><div style="width:' + (100 * f.correct / Math.max(1, f.total)).toFixed(1) + '%"></div></div>' + (penalty ? '<div class="small muted">감점 반영 ' + (f.correct - penalty * f.wrong).toFixed(2) + '점</div>' : '') + '</div>';
      sess.sections.forEach(function (sec) {
        var m = SECTION_META[sec.key], c = 0, w = 0;
        sec.ids.forEach(function (id) { var it = itemById(sess.set, sec.key, id); var a = sec.answers[id]; if (it && a === it.answer) c++; else if (a) w++; });
        h += '<div class="score-tile"><div class="k">' + m.name + '</div><div class="v">' + c + ' <small>/ ' + sec.ids.length + '</small></div><div class="bar"><div style="width:' + (100 * c / Math.max(1, sec.ids.length)).toFixed(1) + '%"></div></div><div class="small muted">소요 ' + fmtDur(sec.used || 0) + ' / ' + m.minutes + '분' + (sec.endReason === 'timeout' ? ' · 시간 종료' : '') + ' · 미응답 ' + (sec.ids.length - Object.keys(sec.answers).length) + '</div></div>';
      });
      h += '</div>';
      h += '<div class="card" style="margin-top:16px"><h2>유형별 정답률</h2><table class="res-table"><thead><tr><th>영역</th><th>유형</th><th>정답 / 문항</th><th>정답률</th><th>평균 소요</th></tr></thead><tbody>';
      sess.sections.forEach(function (sec) {
        var by = {};
        sec.ids.forEach(function (id) {
          var it = itemById(sess.set, sec.key, id); if (!it) return;
          var k = it.subtype || '기타';
          var b = by[k] || (by[k] = { n: 0, c: 0, t: 0 });
          b.n++; if (sec.answers[id] === it.answer) b.c++; b.t += sec.times[id] || 0;
        });
        Object.keys(by).forEach(function (k) {
          var b = by[k];
          h += '<tr><td>' + SECTION_META[sec.key].name + '</td><td class="l">' + esc(k) + '</td><td>' + b.c + ' / ' + b.n + '</td><td>' + Math.round(100 * b.c / b.n) + '%</td><td>' + Math.round(b.t / b.n / 1000) + '초</td></tr>';
        });
      });
      h += '</tbody></table><p class="small muted" style="margin-top:10px">합격선·과락선은 공개된 적이 없어 표시하지 않습니다. 문항별 소요시간은 화면에 표시된 시간을 기준으로 합니다.</p></div>';
    } else if (tab === 'table') {
      h += '<div class="card"><table class="res-table"><thead><tr><th>영역</th><th>번호</th><th>유형</th><th>내 답</th><th>정답</th><th>결과</th><th>소요</th>' + (sess.settings.flag ? '<th>검토</th>' : '') + '</tr></thead><tbody>';
      sess.sections.forEach(function (sec, si) {
        sec.ids.forEach(function (id, i) {
          var it = itemById(sess.set, sec.key, id); if (!it) return;
          var a = sec.answers[id], ok = a === it.answer;
          h += '<tr class="click" data-act="review-one" data-sec="' + si + '" data-q="' + i + '"><td>' + SECTION_META[sec.key].name + '</td><td>' + (i + 1) + '</td><td class="l">' + esc(it.subtype || '') + '</td><td>' + (a ? CIRC[a - 1] : '-') + '</td><td>' + CIRC[it.answer - 1] + '</td><td><span class="ox ' + (ok ? 'o' : 'x') + '">' + (ok ? 'O' : 'X') + '</span></td><td>' + Math.round((sec.times[id] || 0) / 1000) + '초</td>' + (sess.settings.flag ? '<td>' + (sec.flags[id] ? '★' : '') + '</td>' : '') + '</tr>';
        });
      });
      h += '</tbody></table></div>';
    } else {
      filter = filter || 'all';
      h += '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">' + [['all', '전체'], ['wrong', '틀린 문항·미응답'], ['flag', '검토 표시']].map(function (x) { return '<button class="btn small' + (filter === x[0] ? ' primary' : '') + '" data-act="res-filter" data-f="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
      sess.sections.forEach(function (sec, si) {
        var rules = sectionRules(sess.set, sec.key);
        var shownRules = false;
        sec.ids.forEach(function (id, i) {
          var it = itemById(sess.set, sec.key, id); if (!it) return;
          var a = sec.answers[id], ok = a === it.answer;
          if (filter === 'wrong' && ok) return;
          if (filter === 'flag' && !sec.flags[id]) return;
          if (rules && !shownRules) { shownRules = true; h += '<details class="card" style="margin-bottom:14px"><summary><b>제' + sess.set + '회 도식 규칙표</b></summary>' + R.ruleTableHtml(rules) + '</details>'; }
          var two = R.hasPassage(it);
          h += '<div class="review-item" id="rv-' + si + '-' + i + '"><div class="rh"><b>' + SECTION_META[sec.key].name + ' ' + (i + 1) + '번</b><span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '정답' : a ? '오답' : '미응답') + '</span><span class="tag">' + esc(it.subtype || '') + '</span><span class="small muted">' + Math.round((sec.times[id] || 0) / 1000) + '초</span></div>';
          h += '<div class="rb' + (two ? '' : ' one') + '">' + (two ? '<div>' + R.passageHtml(it) + '</div>' : '') + '<div>' + R.questionHtml(it, { number: i + 1, selected: a, reveal: true, answer: it.answer }) + '</div></div></div>';
        });
      });
    }
    h += '</main>' + footer() + '</div>';
    show(h);
    root.dataset.resultUid = sess.uid;
  }

  /* ---------- 인성검사 ---------- */
  function persTimingCfg(sess) { return PERS_TIMING[sess.settings.persTiming] || PERS_TIMING.split; }
  function persPages(sess, part) {
    var per = part === 0 ? PART1_PER_PAGE : PART2_PER_PAGE;
    var n = part === 0 ? sess.parts.blocks.length : sess.parts.items.length;
    return Math.ceil(n / per);
  }
  function scaleLabels(max) {
    if (max === 2) return ['예', '아니오'];
    if (max === 4) return ['전혀 아니다', '아니다', '그렇다', '매우 그렇다'];
    if (max === 5) return ['전혀 아니다', '아니다', '보통이다', '그렇다', '매우 그렇다'];
    return ['전혀 아니다', '아니다', '약간 아니다', '보통이다', '약간 그렇다', '그렇다', '매우 그렇다'];
  }
  function part2Max(sess) { return sess.settings.part2 === 'yn' ? 2 : sess.settings.part2 === 'l4' ? 4 : 5; }

  function persIntro() {
    var cfg = persTimingCfg(S), lk = S.settings.likert;
    var tm = cfg.parts ? 'Ⅰ부 ' + cfg.parts[0] + '분, Ⅱ부 ' + cfg.parts[1] + '분' : '합산 ' + cfg.total + '분(Ⅰ·Ⅱ부 공유)';
    var h = '<div class="page">' + pageHead(titleOf()) + '<main class="page-body"><div class="card"><h2>인성검사 안내</h2><ol class="rules-list">';
    h += '<li>인성검사는 적성검사와 별도로, 정해진 응시 기간(약 3일) 안에 카메라 감독 없이 응시하는 방식으로 알려져 있습니다.</li>';
    h += '<li><b>Ⅰ부</b>: 진술문 3개가 한 묶음입니다. 각 진술에 ' + lk + '점 척도로 답한 뒤, 묶음 안에서 나와 <b>가장 가까운 것(가)</b>과 <b>가장 먼 것(멀)</b>을 하나씩 고릅니다. 총 ' + S.parts.blocks.length + '묶음.</li>';
    h += '<li><b>Ⅱ부</b>: 단문 진술 ' + S.parts.items.length + '개에 ' + (part2Max(S) === 2 ? '예/아니오' : part2Max(S) + '점 척도') + '로 답합니다.</li>';
    h += '<li>시간: ' + tm + (S.settings.pageTimer ? '. 페이지마다 제한시간(Ⅰ부 ' + PAGE_SECONDS[0] + '초, Ⅱ부 ' + PAGE_SECONDS[1] + '초)이 있으며, 시간이 지나면 응답하지 않은 채로 다음 페이지로 넘어갑니다.' : '.') + '</li>';
    h += '<li>이전 페이지로 돌아갈 수 없습니다. 너무 오래 고민하지 말고 평소 모습대로 솔직하게 응답하세요.</li></ol>';
    h += '<h3>예시 (Ⅰ부 1묶음)</h3>' + persBlockHtml(-1, ['예시) 나는 일을 시작하기 전에 순서를 정해 둔다.', '예시) 처음 보는 사람과도 쉽게 대화를 시작한다.', '예시) 예상치 못한 일이 생겨도 금방 침착해진다.'], true);
    h += '<p class="small muted">세부 형식(척도 점수, Ⅱ부 응답 방식, 페이지 시간)은 출처마다 달라 홈 화면 설정에서 바꿀 수 있습니다.</p>';
    h += '<div class="center-actions"><button class="btn" data-act="home">처음으로</button><button class="btn primary large" data-act="begin-pers">인성검사 시작</button></div></div></main>' + footer() + '</div>';
    show(h);
  }

  function persBlockHtml(bi, texts, demo) {
    var lk = S.settings.likert, labels = scaleLabels(lk);
    var map = demo ? null : P.bankMap();
    var ids = demo ? texts.map(function (_, i) { return 'demo' + i; }) : S.parts.blocks[bi];
    var f = demo ? (S._demoFc || {}) : (S.fc[bi] || {});
    var h = '<div class="pers-block"><div class="bh">' + (demo ? '예시 묶음' : '묶음 ' + (bi + 1)) + '</div><table class="pers-table"><thead><tr><th style="text-align:left;padding-left:12px">진술</th>';
    labels.forEach(function (l, i) { h += '<th>' + (i + 1) + (lk <= 5 || i === 0 || i === lk - 1 || i === 3 ? '<br>' + l : '') + '</th>'; });
    h += '<th class="sep">가깝다<br>(가)</th><th>멀다<br>(멀)</th></tr></thead><tbody>';
    ids.forEach(function (id, k) {
      var text = demo ? texts[k] : (map[id] ? map[id].text : id);
      var v = demo ? (S._demo || {})[id] : S.answers[id];
      h += '<tr><td class="stmt"><span class="no">' + String.fromCharCode(65 + k) + '</span>' + esc(text) + '</td>';
      for (var c = 1; c <= lk; c++) h += '<td><button class="lk' + (v === c ? ' on' : '') + '" data-act="lk" data-id="' + id + '" data-v="' + c + '"' + (demo ? ' data-demo="1"' : '') + '>' + c + '</button></td>';
      h += '<td class="sep"><button class="fc near' + (f.near === id ? ' on' : '') + '" data-act="fc" data-b="' + bi + '" data-id="' + id + '" data-w="near"' + (demo ? ' data-demo="1"' : '') + '>가</button></td>';
      h += '<td><button class="fc far' + (f.far === id ? ' on' : '') + '" data-act="fc" data-b="' + bi + '" data-id="' + id + '" data-w="far"' + (demo ? ' data-demo="1"' : '') + '>멀</button></td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function persPart2Html(ids, startNo) {
    var max = part2Max(S), labels = scaleLabels(max), map = P.bankMap();
    var h = '<div class="pers-block"><table class="pers-table"><thead><tr><th style="text-align:left;padding-left:12px">문항</th>';
    labels.forEach(function (l, i) { h += '<th>' + (max === 2 ? '' : (i + 1) + '<br>') + l + '</th>'; });
    h += '</tr></thead><tbody>';
    ids.forEach(function (id, k) {
      var v = S.answers[id];
      h += '<tr><td class="stmt"><span class="no">' + (startNo + k) + '</span>' + esc(map[id] ? map[id].text : id) + '</td>';
      for (var c = 1; c <= max; c++) {
        h += max === 2 ? '<td><button class="yn' + (v === c ? ' on' : '') + '" data-act="lk" data-id="' + id + '" data-v="' + c + '">' + labels[c - 1] + '</button></td>'
          : '<td><button class="lk' + (v === c ? ' on' : '') + '" data-act="lk" data-id="' + id + '" data-v="' + c + '">' + c + '</button></td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function persPageIds() {
    if (S.part === 0) {
      var b0 = S.page * PART1_PER_PAGE;
      var bs = []; for (var i = b0; i < Math.min(b0 + PART1_PER_PAGE, S.parts.blocks.length); i++) bs.push(i);
      return bs;
    }
    var s0 = S.page * PART2_PER_PAGE;
    return S.parts.items.slice(s0, s0 + PART2_PER_PAGE);
  }

  function persPageComplete() {
    if (S.part === 0) {
      return persPageIds().every(function (bi) {
        var f = S.fc[bi] || {};
        return f.near && f.far && S.parts.blocks[bi].every(function (id) { return S.answers[id] != null; });
      });
    }
    return persPageIds().every(function (id) { return S.answers[id] != null; });
  }

  function persRemain() {
    var cfg = persTimingCfg(S);
    return cfg.parts ? S.partEndAt - now() : S.totalEndAt - now();
  }

  function persProgress() {
    var done = Object.keys(S.answers).length, total = S.parts.blocks.length * 3 + S.parts.items.length;
    var bar = document.getElementById('pers-bar'), lab = document.getElementById('pers-count');
    if (bar) bar.style.width = (100 * done / total).toFixed(1) + '%';
    if (lab) lab.textContent = '전체 응답 ' + done + ' / ' + total;
  }

  function persScreen() {
    var pages = persPages(S, S.part);
    var answeredAll = Object.keys(S.answers).length;
    var totalStmts = S.parts.blocks.length * 3 + S.parts.items.length;
    var h = examHead('인성검사 ' + (S.part === 0 ? 'Ⅰ' : 'Ⅱ') + '부<span class="cnt">' + (S.page + 1) + ' / ' + pages + ' 페이지</span>', persRemain(), persTimingCfg(S).parts ? (S.part === 0 ? 'Ⅰ부 남은 시간' : 'Ⅱ부 남은 시간') : '남은 시간');
    h += '<div class="exam-tools"><div style="flex:1;max-width:420px"><div class="pers-progress"><div id="pers-bar" style="width:' + (100 * answeredAll / totalStmts).toFixed(1) + '%"></div></div><div class="small muted" id="pers-count" style="margin-top:2px">전체 응답 ' + answeredAll + ' / ' + totalStmts + '</div></div><span class="spacer"></span>' + (S.settings.pageTimer ? '<span class="page-timer">이 페이지 남은 시간 <b id="page-timer">' + mmss(S.pageEndAt - now()) + '</b></span>' : '') + '</div>';
    h += '<div class="exam-main"><div class="exam-content"><div class="pane single"><div class="pers-wrap">';
    if (S.part === 0) {
      h += '<p class="small muted" style="margin-top:0">각 진술에 ' + S.settings.likert + '점 척도로 답하고, 묶음마다 나와 가장 가까운 것(가)과 가장 먼 것(멀)을 하나씩 고르세요.</p>';
      persPageIds().forEach(function (bi) { h += persBlockHtml(bi); });
    } else {
      h += '<p class="small muted" style="margin-top:0">각 문항이 자신에게 해당하는 정도를 고르세요.</p>';
      h += persPart2Html(persPageIds(), S.page * PART2_PER_PAGE + 1);
    }
    h += '</div></div></div></div>';
    h += '<footer class="exam-foot"><span class="small muted">이전 페이지로 돌아갈 수 없습니다.</span><span class="spacer"></span><button class="btn primary" id="pers-next" data-act="pers-next"' + (persPageComplete() ? '' : ' disabled') + '>' + (S.page === pages - 1 ? (S.part === 0 ? 'Ⅰ부 제출' : '검사 제출') : '다음 페이지 ▶') + '</button></footer>';
    showExam(h);
    if (S.settings.mode === 'real') guardFullscreen();
    var pane = document.querySelector('.pane.single'); if (pane) pane.scrollTop = 0;
    startTick();
  }

  function persTick() {
    if (S.stage !== 'part') return;
    var rem = persRemain();
    setTimerView(rem);
    if (S.settings.pageTimer) {
      var pl = S.pageEndAt - now();
      var pt = document.getElementById('page-timer'); if (pt) pt.textContent = mmss(pl);
      if (pl <= 0 && rem > 0) { S.timedOutPages = (S.timedOutPages || 0) + 1; persAdvance(true); return; }
    }
    if (rem <= 0) {
      stopTick();
      var cfg = persTimingCfg(S);
      if (cfg.parts && S.part === 0) { S.part = 1; S.page = 0; S.stage = 'between'; save(); route(); modal('시간 종료', 'Ⅰ부 제한시간이 끝났습니다.'); }
      else { S.stage = 'complete'; S.finishedAt = now(); save(); route(); modal('시간 종료', '인성검사 제한시간이 끝나 자동 제출되었습니다.'); }
    }
  }

  function persAdvance(timeout) {
    var pages = persPages(S, S.part);
    if (S.page < pages - 1) {
      S.page++;
      S.pageEndAt = now() + PAGE_SECONDS[S.part] * 1000;
      save();
      persScreen();
      if (timeout) toast('페이지 제한시간이 지나 다음 페이지로 넘어갔습니다.');
      return;
    }
    stopTick();
    if (S.part === 0) { S.part = 1; S.page = 0; S.stage = 'between'; }
    else { S.stage = 'complete'; S.finishedAt = now(); }
    save();
    route();
  }

  function persBetween() {
    stopTick();
    var cfg = persTimingCfg(S);
    var h = '<div class="page">' + pageHead(titleOf()) + '<main class="page-body"><div class="card section-intro"><div class="order">Ⅰ부 종료</div><h2>인성검사 Ⅱ부</h2><div class="spec"><span>문항 수 <b>' + S.parts.items.length + '</b></span><span>' + (cfg.parts ? '제한시간 <b>' + cfg.parts[1] + '분</b>' : '남은 시간 <b>' + mmss(S.totalEndAt - now()) + '</b>') + '</span></div><p class="muted">단문 진술에 ' + (part2Max(S) === 2 ? '예/아니오' : part2Max(S) + '점 척도') + '로 답합니다.' + (cfg.parts ? '' : ' 합산 타이머는 계속 흐르고 있습니다.') + '</p><div class="center-actions"><button class="btn primary large" data-act="begin-part2">Ⅱ부 시작</button></div></div></main>' + footer() + '</div>';
    show(h);
    if (!cfg.parts) startTick();
  }

  function persResults(sess) {
    stopTick();
    var sc = P.score(sess);
    var h = '<div class="page">' + pageHead('<button class="btn small" data-act="home">처음으로</button>') + '<main class="page-body">';
    h += '<div class="hero"><div><h1>제' + sess.set + '회 인성검사 참고 지표</h1><p>규준(norm) 집단이 없는 모의 지표입니다. 실제 HMAT 인성 결과·합격 여부와 무관합니다.</p></div></div>';
    function tile(k, v, sub) { return '<div class="score-tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="small muted">' + sub + '</div>' : '') + '</div>'; }
    h += '<div class="score-grid">';
    h += tile('응답 완료', sc.answered + ' <small>/ ' + sc.total + '</small>', '무응답 ' + sc.missing + (sess.timedOutPages ? ' · 시간 초과 페이지 ' + sess.timedOutPages : ''));
    h += tile('일관성 지수', sc.consistency == null ? '-' : sc.consistency + ' <small>/ 100</small>', '같은 내용 문항 ' + sc.pairCount + '쌍 · 크게 어긋난 쌍 ' + sc.bigGaps);
    h += tile('가/멀 선택과 척도 모순', sc.fcConflict + ' <small>/ ' + sc.fcTotal + '묶음</small>', '"가"로 고른 진술의 척도 점수가 "멀"보다 낮은 경우');
    h += tile('극단 응답 비율', sc.extremeRate + '<small>%</small>', '척도 양 끝(1점·최고점) 선택 비율');
    h += tile('과장 응답 경향', sc.lieHigh + ' <small>/ ' + sc.lieTotal + '</small>', '비현실적으로 바람직한 문항에 "그렇다"');
    h += '</div>';
    var warn = [];
    if (sc.consistency != null && sc.consistency < 75) warn.push('같은 내용을 묻는 문항에 대한 응답이 자주 어긋났습니다. 실제 검사에서는 응답 신뢰도 문제로 해석될 수 있습니다.');
    if (sc.lieTotal && sc.lieHigh / sc.lieTotal >= 0.4) warn.push('지나치게 바람직한 방향으로 응답하는 경향이 보입니다. 꾸미기보다 평소 모습대로 일관되게 답하는 것이 안전합니다.');
    if (sc.fcTotal && sc.fcConflict / sc.fcTotal > 0.15) warn.push('Ⅰ부에서 가/멀 선택과 척도 응답이 서로 맞지 않는 묶음이 많습니다.');
    if (sc.missing > sc.total * 0.05) warn.push('무응답이 많습니다. 실제 검사에서도 무응답이 많으면 결과 해석이 어려워질 수 있습니다.');
    if (sc.extremeRate > 60) warn.push('극단 응답 비율이 높습니다.');
    h += '<div class="card" style="margin-top:16px"><h2>응답 패턴 점검</h2>' + (warn.length ? '<ul class="rules-list">' + warn.map(function (w) { return '<li>' + w + '</li>'; }).join('') + '</ul>' : '<p>특이한 응답 패턴이 발견되지 않았습니다.</p>') + '<p class="small muted">위 기준값(75점, 40% 등)은 이 모의고사가 임의로 정한 참고선입니다.</p></div>';
    h += '<div class="card"><h2>차원별 응답 프로파일</h2><p class="small muted">각 차원 문항에 대한 응답 평균(역문항 반영)을 0~100으로 환산했습니다. 높고 낮음에 좋고 나쁨은 없으며 타인과 비교한 점수가 아닙니다.</p>';
    sc.profile.forEach(function (p) {
      h += '<div class="profile-row"><span>' + p.name + '</span><div class="track"><div style="width:' + (p.score || 0) + '%"></div></div><b>' + (p.score == null ? '-' : p.score) + '</b></div>';
    });
    h += '</div></main>' + footer() + '</div>';
    show(h);
  }

  /* ---------- 이벤트 ---------- */
  root.addEventListener('change', function (e) {
    if (e.target.matches('[data-ck]')) {
      var all = Array.prototype.every.call(document.querySelectorAll('[data-ck]'), function (c) { return c.checked; });
      var nx = document.getElementById('ck-next'); if (nx) nx.disabled = !all;
      var li = e.target.closest('li'); if (li) li.classList.toggle('ok', e.target.checked);
    }
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-setting] button');
    if (!t) return;
    var segEl = t.closest('[data-setting]');
    if (segEl && !t.dataset.act) {
      settings[segEl.dataset.setting] = JSON.parse(t.dataset.val);
      store.set('settings', settings);
      home();
      return;
    }
    var act = t.dataset.act;
    if (t.tagName === 'A') e.preventDefault();
    switch (act) {
      case 'home': leaveToHome(); break;
      case 'about': aboutModal(); break;
      case 'reset-settings': settings = Object.assign({}, DEFAULTS); store.set('settings', settings); home(); break;
      case 'start-apt': case 'retry': { var sn = +t.dataset.set; confirmDiscard().then(function (ok) { if (ok) startApt(sn); }); break; }
      case 'start-pers': { var sp = +t.dataset.set; confirmDiscard().then(function (ok) { if (ok) startPers(sp); }); break; }
      case 'resume': S = store.get('session', null); proctorFired = !!(S && S.proctorDone); resumeSession(); break;
      case 'discard': store.del('session'); S = null; home(); break;
      case 'goto': S.stage = t.dataset.stage; save(); route(); break;
      case 'cam': startCam(t); break;
      case 'confirm-info': {
        var nm = document.getElementById('nm');
        S.candidate.name = nm ? nm.value.trim() : '';
        store.set('name', S.candidate.name);
        S.stage = S.kind === 'apt' ? 'rules' : 'intro'; save(); route(); break;
      }
      case 'begin-apt': S.secIdx = 0; S.stage = 'intro'; save(); enterFullscreen(); route(); break;
      case 'start-section': stopTick(); beginSection(); break;
      case 'skip-study': stopTick(); activateSection(); save(); route(); break;
      case 'prev': goQ(S.qIdx - 1); break;
      case 'next': goQ(S.qIdx + 1); break;
      case 'goq': goQ(+t.dataset.q); break;
      case 'omr': choose(+t.dataset.q, +t.dataset.c); break;
      case 'flag': { var sec = cur(), id = sec.ids[S.qIdx]; sec.flags[id] = !sec.flags[id]; if (!sec.flags[id]) delete sec.flags[id]; save(); syncMarks(); break; }
      case 'end-section': confirmEnd(); break;
      case 'peek': refreshQuestionPane(true); break;
      case 'pause': pause(); break;
      case 'resume-pause': resumePause(); break;
      case 'fs-enter': enterFullscreen(); break;
      case 'tool-memo': openMemo(); break;
      case 'tool-calc': openCalc(); break;
      case 'rules-drawer': rulesDrawer(); break;
      case 'to-results': S.finished = true; archive(S); var done = S; store.del('session'); S = null; done.kind === 'apt' ? aptResults(done) : persResults(done); break;
      case 'res-tab': case 'res-filter': case 'review-one': {
        var r = findResult(root.dataset.resultUid);
        if (!r) break;
        if (act === 'res-tab') aptResults(r, t.dataset.tab);
        else if (act === 'res-filter') aptResults(r, 'review', t.dataset.f);
        else { aptResults(r, 'review', 'all'); var el = document.getElementById('rv-' + t.dataset.sec + '-' + t.dataset.q); if (el) el.scrollIntoView({ block: 'start' }); }
        break;
      }
      case 'view-result': { var rr = findResult(t.dataset.id); if (rr) rr.kind === 'apt' ? aptResults(rr) : persResults(rr); break; }
      case 'history': historyModal(); break;
      case 'begin-pers': beginPers(); break;
      case 'begin-part2': beginPart2(); break;
      case 'lk': persLikert(t); break;
      case 'fc': persFc(t); break;
      case 'pers-next': if (persPageComplete()) persAdvance(false); break;
    }
    // 선지 클릭
  });

  root.addEventListener('click', function (e) {
    var c = e.target.closest('.choice[data-choice]');
    if (!c || !S || S.kind !== 'apt' || S.stage !== 'question') return;
    if (c.closest('.review-item')) return;
    choose(S.qIdx, +c.dataset.choice);
  });

  document.addEventListener('keydown', function (e) {
    if (!S || S.kind !== 'apt' || S.stage !== 'question') return;
    if (e.target.closest && e.target.closest('textarea,input,.tool-panel')) return;
    if (document.querySelector('.modal-back,#pause-ov')) return;
    if (/^[1-5]$/.test(e.key)) { choose(S.qIdx, +e.key); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { goQ(S.qIdx + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { goQ(S.qIdx - 1); e.preventDefault(); }
  });

  function started(sess) {
    if (!sess || sess.finished) return false;
    if (sess.kind === 'apt') return sess.sections.some(function (x) { return x.status !== 'pending'; });
    return sess.stage === 'part' || sess.stage === 'between' || sess.stage === 'complete';
  }
  function leaveToHome() {
    if (S && !S.finished) {
      if (started(S)) { recordTime(); save(); } else store.del('session');
    }
    S = null;
    closePanels();
    var ov = document.getElementById('fs-ov'); if (ov) ov.remove();
    home();
  }
  function confirmDiscard() {
    var pending = store.get('session', null);
    if (!pending || pending.finished || !started(pending)) { store.del('session'); return Promise.resolve(true); }
    return modal('진행 중인 응시', '이어서 응시할 수 있는 기록이 있습니다. 새로 시작하면 이전 응시 기록은 삭제됩니다.', [{ label: '취소', value: false }, { label: '새로 시작', value: true, cls: 'danger' }]).then(function (ok) {
      if (ok) store.del('session');
      return ok;
    });
  }

  function findResult(uid) {
    var h = store.get('history', []);
    for (var i = 0; i < h.length; i++) if (h[i].uid === uid) return h[i].session;
    return null;
  }

  function historyModal() {
    var hist = store.get('history', []).slice().reverse();
    var b = '<table class="res-table"><thead><tr><th>일시</th><th>회차</th><th>검사</th><th>결과</th><th></th></tr></thead><tbody>' + hist.map(function (r) {
      return '<tr><td>' + new Date(r.at).toLocaleString('ko-KR') + '</td><td>' + r.set + '회</td><td>' + (r.kind === 'apt' ? '적성(' + (VARIANTS[r.variant] ? VARIANTS[r.variant].name : '') + ')' : '인성') + '</td><td>' + (r.kind === 'apt' ? r.correct + '/' + r.total : '응답 ' + r.answered + '/' + r.total) + '</td><td><a href="#" data-act="view-result" data-id="' + r.uid + '">보기</a></td></tr>';
    }).join('') + '</tbody></table>';
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal" style="width:min(720px,100%)"><h3>응시 기록</h3><div style="max-height:60vh;overflow:auto">' + b + '</div><div class="ma"><button class="btn" data-x="clear">기록 삭제</button><button class="btn primary" data-x="close">닫기</button></div></div>';
    back.addEventListener('click', function (e) {
      if (e.target === back || (e.target.dataset && e.target.dataset.x === 'close') || (e.target.dataset && e.target.dataset.act === 'view-result')) back.remove();
      if (e.target.dataset && e.target.dataset.x === 'clear') { store.del('history'); back.remove(); home(); }
    });
    document.body.appendChild(back);
  }

  function startCam(btn) {
    var v = document.querySelector('.cam-preview');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { modal('카메라', '이 브라우저에서는 카메라 미리보기를 사용할 수 없습니다.'); return; }
    navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(function (stream) {
      v.srcObject = stream; v.classList.remove('hidden'); btn.disabled = true;
      var stop = function () { stream.getTracks().forEach(function (tr) { tr.stop(); }); };
      window.addEventListener('hmat-route', stop, { once: true });
      setTimeout(stop, 60000);
    }).catch(function () { modal('카메라', '카메라 권한이 없거나 장치를 찾을 수 없습니다. 모의고사 진행에는 지장이 없습니다.'); });
  }

  function beginPers() {
    var cfg = persTimingCfg(S);
    S.part = 0; S.page = 0; S.stage = 'part';
    if (cfg.parts) S.partEndAt = now() + cfg.parts[0] * 60000;
    else S.totalEndAt = now() + cfg.total * 60000;
    S.pageEndAt = now() + PAGE_SECONDS[0] * 1000;
    save();
    enterFullscreen();
    route();
  }
  function beginPart2() {
    var cfg = persTimingCfg(S);
    S.part = 1; S.page = 0; S.stage = 'part';
    if (cfg.parts) S.partEndAt = now() + cfg.parts[1] * 60000;
    S.pageEndAt = now() + PAGE_SECONDS[1] * 1000;
    save();
    enterFullscreen();
    route();
  }
  function persLikert(t) {
    var id = t.dataset.id, v = +t.dataset.v;
    if (t.dataset.demo) { S._demo = S._demo || {}; S._demo[id] = v; }
    else { S.answers[id] = v; save(); }
    var row = t.closest('tr');
    row.querySelectorAll('[data-act="lk"]').forEach(function (b) { b.classList.toggle('on', b === t); });
    var nx = document.getElementById('pers-next'); if (nx) nx.disabled = !persPageComplete();
    if (!t.dataset.demo) persProgress();
  }
  function persFc(t) {
    var bi = t.dataset.b, id = t.dataset.id, w = t.dataset.w, other = w === 'near' ? 'far' : 'near';
    var f;
    if (t.dataset.demo) f = S._demoFc = S._demoFc || {};
    else f = S.fc[bi] = S.fc[bi] || {};
    f[w] = id;
    if (f[other] === id) delete f[other];
    if (!t.dataset.demo) save();
    var block = t.closest('.pers-block');
    block.querySelectorAll('[data-act="fc"]').forEach(function (b) { b.classList.toggle('on', f[b.dataset.w] === b.dataset.id); });
    var nx = document.getElementById('pers-next'); if (nx) nx.disabled = !persPageComplete();
  }

  function resumeSession() {
    if (!S) return home();
    if (S.kind === 'apt') {
      // 흐른 시간 반영: 진행 중 영역이 이미 끝났으면 종료 처리
      var sec = cur();
      if (S.stage === 'question' && sec.remain == null && sec.endAt <= now()) { endSection('timeout'); return; }
      if (S.stage === 'study' && sec.studyEndAt <= now()) { activateSection(); save(); }
    } else if (S.stage === 'part') {
      var cfg = persTimingCfg(S);
      var rem = cfg.parts ? S.partEndAt - now() : S.totalEndAt - now();
      if (rem <= 0) { if (cfg.parts && S.part === 0) { S.part = 1; S.page = 0; S.stage = 'between'; } else { S.stage = 'complete'; S.finishedAt = now(); } save(); }
      else if (S.settings.pageTimer && S.pageEndAt <= now()) { S.pageEndAt = now() + PAGE_SECONDS[S.part] * 1000; save(); }
    }
    enterFullscreen();
    route();
  }

  window.addEventListener('beforeunload', function () { recordTime(); save(); });

  /* 테스트·디버그용 훅 */
  window.HMATApp = {
    state: function () { return S; },
    settings: function () { return settings; },
    home: home,
    _advanceClock: function (ms) {
      if (!S) return;
      if (S.kind === 'apt') { var sec = cur(); ['endAt', 'studyEndAt', 'introEndAt'].forEach(function (k) { if (sec[k]) sec[k] -= ms; }); }
      else { ['partEndAt', 'totalEndAt', 'pageEndAt'].forEach(function (k) { if (S[k]) S[k] -= ms; }); }
      save();
    }
  };

  home();
})();
