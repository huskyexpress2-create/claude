/* 문항 레지스트리: 각 data/*.js 파일이 HMAT.add(...)로 문항을 등록한다. 형식은 docs/SCHEMA.md 참고. */
(function (g) {
  var HMAT = g.HMAT || {};
  HMAT.sets = HMAT.sets || {};
  HMAT.personalityBank = HMAT.personalityBank || [];
  HMAT.add = function (setNo, section, payload) {
    var s = HMAT.sets[setNo] || (HMAT.sets[setNo] = { id: setNo, sections: {} });
    s.sections[section] = payload;
  };
  HMAT.addPersonalityBank = function (list) {
    HMAT.personalityBank = HMAT.personalityBank.concat(list);
  };
  g.HMAT = HMAT;
})(typeof window !== 'undefined' ? window : globalThis);
