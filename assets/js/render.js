/* 문항 렌더링: 지문, 자료(표·그래프·글), 발문, 보기 상자, 선지 */
(function (g) {
  var CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
  var ALLOWED = /&lt;(\/?)(b|u|br|sup|sub|i|em|strong)\s*\/?&gt;/g;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 신뢰된 데이터라도 허용 태그만 살린다.
  function rich(s) {
    return esc(s).replace(ALLOWED, function (_, slash, tag) { return '<' + slash + tag + '>'; });
  }
  function paragraphs(text, cls) {
    return String(text || '').split(/\n\s*\n/).map(function (p) {
      var t = p.trim();
      if (!t) return '';
      var noIndent = /^(\(|\[|<|※|-|·|•|[0-9]+\.|[ㄱ-ㅎ]\.|[가-하]\.)/.test(t) || /^&lt;/.test(esc(t));
      return '<p' + (noIndent ? ' class="no-indent"' : '') + '>' + rich(t).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function isNum(v) { return typeof v === 'number' || (typeof v === 'string' && /^-?[\d,]+(\.\d+)?%?$/.test(v.trim())); }
  function cell(v) {
    if (typeof v === 'number') return HMATCharts.fmt(v);
    return rich(v);
  }

  function material(m) {
    var h = '<div class="mat">';
    if (m.title) h += '<div class="mat-title">' + rich(m.title) + '</div>';
    if (m.unit && m.kind !== 'text') h += '<div class="mat-unit">(' + rich(String(m.unit).replace(/^\(|\)$/g, '')) + ')</div>';
    if (m.kind === 'table') {
      h += '<div class="mat-scroll"><table class="mat-table"><thead><tr>';
      (m.columns || []).forEach(function (c) { h += '<th>' + rich(c) + '</th>'; });
      h += '</tr></thead><tbody>';
      (m.rows || []).forEach(function (r) {
        h += '<tr>';
        (r || []).forEach(function (v, i) { h += '<td' + (i > 0 && isNum(v) ? ' class="num"' : '') + '>' + cell(v) + '</td>'; });
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    } else if (m.kind === 'chart') {
      h += HMATCharts.render(m, { width: 560, height: m.type === 'pie' ? 260 : 300 });
    } else if (m.kind === 'text') {
      h += '<div class="mat-text">' + paragraphs(m.body) + '</div>';
    }
    if (m.note) h += '<div class="mat-note">' + rich(m.note) + '</div>';
    return h + '</div>';
  }

  function hasPassage(item) {
    return !!(item.passage || (item.materials && item.materials.length));
  }

  function passageHtml(item) {
    var h = '';
    if (item.group && item.group.label) h += '<div class="group-label">' + rich(item.group.label) + '</div>';
    if (item.passageTitle) h += '<div class="passage-title">' + rich(item.passageTitle) + '</div>';
    if (item.passage) h += '<div class="passage-text">' + paragraphs(item.passage) + '</div>';
    (item.materials || []).forEach(function (m) { h += material(m); });
    return h;
  }

  function boxHtml(box) {
    if (!box || !box.items || !box.items.length) return '';
    var h = '<div class="q-box"><span class="box-title">&lt;' + esc(box.title || '보기') + '&gt;</span><ul>';
    box.items.forEach(function (it) { h += '<li>' + rich(it) + '</li>'; });
    return h + '</ul></div>';
  }

  /* opts: { number, selected, reveal (bool), answer, interactive (bool) } */
  function questionHtml(item, opts) {
    opts = opts || {};
    var h = '<div class="q-wrap">';
    h += '<p class="q-stem"><span class="q-num">' + opts.number + '.</span>' + rich(item.stem) + '</p>';
    if (item.figure && item.figure.svg) {
      h += '<div class="q-figure">' + item.figure.svg + (item.figure.caption ? '<div class="cap">' + rich(item.figure.caption) + '</div>' : '') + '</div>';
    }
    h += boxHtml(item.box);
    h += choicesHtml(item, opts);
    if (opts.reveal) h += explainHtml(item, opts.selected);
    return h + '</div>';
  }

  function choiceState(i, opts) {
    var n = i + 1, cls = '';
    if (opts.reveal) {
      if (n === opts.answer) cls = ' correct';
      else if (n === opts.selected) cls = ' wrong';
    } else if (n === opts.selected) cls = ' on';
    return cls;
  }

  function choicesHtml(item, opts) {
    var dis = opts.interactive ? '' : ' tabindex="-1"';
    if (item.choiceCharts || item.choiceSvgs) {
      var visuals = item.choiceCharts
        ? item.choiceCharts.map(function (c) { return (c.title ? '<div class="mat-title" style="font-size:12px">' + rich(c.title) + '</div>' : '') + HMATCharts.render(c, { width: 340, height: c.type === 'pie' ? 210 : 230 }); })
        : item.choiceSvgs;
      var wide = item.choiceSvgs && !item.choiceCharts;
      var h = '<div class="choice-grid' + (wide ? ' five-wide' : ' charts') + '">';
      visuals.forEach(function (v, i) {
        h += '<button type="button" class="choice' + choiceState(i, opts) + '" data-choice="' + (i + 1) + '"' + dis + '><span class="mk">' + (i + 1) + '</span><div class="vis">' + v + '</div></button>';
      });
      return h + '</div>';
    }
    var out = '<ul class="choices">';
    (item.choices || []).forEach(function (c, i) {
      out += '<li><button type="button" class="choice' + choiceState(i, opts) + '" data-choice="' + (i + 1) + '"' + dis + '><span class="mk">' + (i + 1) + '</span><span>' + rich(c) + '</span></button></li>';
    });
    return out + '</ul>';
  }

  function explainHtml(item, selected) {
    var ok = selected === item.answer;
    var h = '<div class="explain"><div class="head">정답 ' + CIRCLED[item.answer - 1];
    if (selected) h += ' <span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '정답' : '오답 · 내 답 ' + CIRCLED[selected - 1]) + '</span>';
    else h += ' <span class="tag bad">미응답</span>';
    if (item.subtype) h += ' <span class="tag">' + esc(item.subtype) + '</span>';
    h += '</div><div class="body">' + rich(item.explanation || '') + '</div></div>';
    return h;
  }

  function ruleTableHtml(rules) {
    if (!rules) return '';
    var h = '';
    if (rules.intro) h += '<p style="margin:0 0 10px">' + rich(rules.intro) + '</p>';
    h += '<table class="rule-table"><thead><tr><th>기호</th><th>이름</th><th>규칙</th><th>예시</th></tr></thead><tbody>';
    (rules.symbols || []).forEach(function (s) {
      h += '<tr><td class="ic">' + (s.svg || esc(s.key)) + '</td><td>' + esc(s.name || '') + '</td><td>' + rich(s.desc || '') + '</td><td class="ex">' + (s.exampleSvg ? s.exampleSvg : esc(s.example || '')) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (rules.note) h += '<p class="small muted" style="margin:8px 0 0">' + rich(rules.note) + '</p>';
    return h;
  }

  g.HMATRender = {
    esc: esc, rich: rich, paragraphs: paragraphs, hasPassage: hasPassage, passageHtml: passageHtml,
    questionHtml: questionHtml, explainHtml: explainHtml, ruleTableHtml: ruleTableHtml, CIRCLED: CIRCLED
  };
})(window);
