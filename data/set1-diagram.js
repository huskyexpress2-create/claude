/* 자동 생성 파일 — node tools/gen-diagram.mjs (seed 20261001). 직접 고치지 말고 생성기를 고쳐 다시 실행할 것. */
HMAT.add(1, 'diagram', {
 "rules": {
  "title": "도식 규칙",
  "intro": "각 기호는 4자리 문자열(알파벳 대문자와 숫자)을 아래 규칙에 따라 바꾼다. 도식에서는 화살표 방향을 따라 기호를 하나씩 차례대로 적용한다.",
  "symbols": [
   {
    "key": "A",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"40\" height=\"40\" fill=\"#ffffff\"/><polygon points=\"20,5.4 23.9,15.9 35,16.3 26.3,23.2 29.3,33.9 20,27.8 10.7,33.9 13.7,23.2 5,16.3 16.1,15.9\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/></svg>",
    "name": "검은 별",
    "desc": "모든 문자를 다음 순서로 한 칸씩 옮긴다. (A→B, Z→A, 0→1, 9→0)",
    "example": "AZ09 → BA10"
   },
   {
    "key": "B",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"40\" height=\"40\" fill=\"#ffffff\"/><circle cx=\"20\" cy=\"20\" r=\"12.9\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/></svg>",
    "name": "흰 원",
    "desc": "문자의 순서를 거꾸로 뒤집는다.",
    "example": "AB12 → 21BA"
   },
   {
    "key": "C",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"40\" height=\"40\" fill=\"#ffffff\"/><polygon points=\"20,5.8 35,31.7 5,31.7\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/></svg>",
    "name": "회색 삼각형",
    "desc": "첫째와 둘째 자리를 맞바꾸고, 셋째와 넷째 자리를 맞바꾼다.",
    "example": "ABCD → BADC"
   },
   {
    "key": "D",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"40\" height=\"40\" fill=\"#ffffff\"/><rect x=\"8.3\" y=\"8.3\" width=\"23.4\" height=\"23.4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/></svg>",
    "name": "흰 사각형",
    "desc": "맨 앞 문자를 맨 뒤로 보낸다.",
    "example": "ABCD → BCDA"
   },
   {
    "key": "E",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"40\" height=\"40\" fill=\"#ffffff\"/><polygon points=\"35,20 27.5,32.7 12.5,32.7 5,20 12.5,7.3 27.5,7.3\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/></svg>",
    "name": "검은 육각형",
    "desc": "홀수 번째(첫째·셋째) 자리의 문자만 다음 순서로 두 칸씩 옮긴다.",
    "example": "Y28K → A20K"
   }
  ],
  "note": "※ 자리는 왼쪽부터 첫째·둘째·셋째·넷째로 센다. ※ 알파벳은 Z 다음이 A, 숫자는 9 다음이 0으로 순환한다. ※ 숫자 0·1과 헷갈리지 않도록 문항의 문자열에는 알파벳 I와 O가 나오지 않는다(알파벳 순서 자체는 26자 그대로다)."
 },
 "items": [
  {
   "id": "S1-DI-01",
   "subtype": "순방향 변환",
   "stem": "다음 도식에서 '?'에 들어갈 문자열로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 370 72\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"370\" height=\"72\" fill=\"#ffffff\"/><text x=\"58\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"10\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"59\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">CN30</text><line x1=\"106\" y1=\"42\" x2=\"125\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"132,42 124,46.5 124,37.5\" fill=\"#222\"/><circle cx=\"152\" cy=\"42\" r=\"14.6\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"172\" y1=\"42\" x2=\"191\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"198,42 190,46.5 190,37.5\" fill=\"#222\"/><polygon points=\"235,42 226.5,56.4 209.5,56.4 201,42 209.5,27.6 226.5,27.6\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"238\" y1=\"42\" x2=\"257\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"264,42 256,46.5 256,37.5\" fill=\"#222\"/><text x=\"312\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"264\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"312\" y=\"51\" font-size=\"26\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text></svg>",
    "caption": ""
   },
   "choices": [
    "2N5C",
    "05NE",
    "23PC",
    "03NC",
    "GN70"
   ],
   "answer": 3,
   "explanation": "<b>풀이</b> CN30 → (흰 원: 역순) → 03NC → (검은 육각형: 홀수 자리 +2) → 23PC<br>따라서 '?'에 들어갈 문자열은 23PC(③)이다.<br><b>오답</b> ①은 흰 원을 첫째·넷째 자리만 맞바꾸는 것으로 착각한 결과이다. ②는 흰 원과 검은 육각형의 순서를 바꿔 적용한 결과이다. ④는 검은 육각형을 빠뜨린 결과이다. ⑤는 흰 원 대신 검은 육각형을 적용한 결과이다."
  },
  {
   "id": "S1-DI-02",
   "subtype": "순방향 변환",
   "stem": "다음 도식에서 '?'에 들어갈 문자열로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 436 72\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"436\" height=\"72\" fill=\"#ffffff\"/><text x=\"58\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"10\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"59\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">K6SD</text><line x1=\"106\" y1=\"42\" x2=\"125\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"132,42 124,46.5 124,37.5\" fill=\"#222\"/><rect x=\"138.7\" y=\"28.7\" width=\"26.5\" height=\"26.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"172\" y1=\"42\" x2=\"191\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"198,42 190,46.5 190,37.5\" fill=\"#222\"/><polygon points=\"218,25.5 222.4,37.3 235,37.8 225.1,45.7 228.5,57.8 218,50.8 207.5,57.8 210.9,45.7 201,37.8 213.6,37.3\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"238\" y1=\"42\" x2=\"257\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"264,42 256,46.5 256,37.5\" fill=\"#222\"/><polygon points=\"284,25.9 301,55.3 267,55.3\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"304\" y1=\"42\" x2=\"323\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"330,42 322,46.5 322,37.5\" fill=\"#222\"/><text x=\"378\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"330\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"378\" y=\"51\" font-size=\"26\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text></svg>",
    "caption": ""
   },
   "choices": [
    "7TEL",
    "EL7T",
    "8MFU",
    "T7LE",
    "7LET"
   ],
   "answer": 4,
   "explanation": "<b>풀이</b> K6SD → (흰 사각형: 맨 앞 → 맨 뒤) → 6SDK → (검은 별: 모든 문자 +1) → 7TEL → (회색 삼각형: 1·2, 3·4 자리 교환) → T7LE<br>따라서 '?'에 들어갈 문자열은 T7LE(④)이다.<br><b>오답</b> ①은 회색 삼각형을 빠뜨린 결과이다. ②는 회색 삼각형을 앞 두 자리와 뒤 두 자리를 통째로 맞바꾸는 것으로 착각한 결과이다. ③은 흰 사각형 대신 검은 별을 적용한 결과이다. ⑤는 흰 사각형을 빠뜨린 결과이다."
  },
  {
   "id": "S1-DI-03",
   "subtype": "순방향 변환",
   "stem": "다음 도식에서 '?'에 들어갈 문자열로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 436 72\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"436\" height=\"72\" fill=\"#ffffff\"/><text x=\"58\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"10\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"59\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">37C5</text><line x1=\"106\" y1=\"42\" x2=\"125\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"132,42 124,46.5 124,37.5\" fill=\"#222\"/><polygon points=\"152,25.5 156.4,37.3 169,37.8 159.1,45.7 162.5,57.8 152,50.8 141.5,57.8 144.9,45.7 135,37.8 147.6,37.3\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"172\" y1=\"42\" x2=\"191\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"198,42 190,46.5 190,37.5\" fill=\"#222\"/><polygon points=\"218,25.9 235,55.3 201,55.3\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"238\" y1=\"42\" x2=\"257\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"264,42 256,46.5 256,37.5\" fill=\"#222\"/><circle cx=\"284\" cy=\"42\" r=\"14.6\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"304\" y1=\"42\" x2=\"323\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"330,42 322,46.5 322,37.5\" fill=\"#222\"/><text x=\"378\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"330\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"378\" y=\"51\" font-size=\"26\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text></svg>",
    "caption": ""
   },
   "choices": [
    "D648",
    "846D",
    "C537",
    "5C73",
    "B426"
   ],
   "answer": 1,
   "explanation": "<b>풀이</b> 37C5 → (검은 별: 모든 문자 +1) → 48D6 → (회색 삼각형: 1·2, 3·4 자리 교환) → 846D → (흰 원: 역순) → D648<br>따라서 '?'에 들어갈 문자열은 D648(①)이다.<br><b>오답</b> ②는 흰 원을 빠뜨린 결과이다. ③은 검은 별을 빠뜨린 결과이다. ④는 검은 별 대신 회색 삼각형을 적용한 결과이다. ⑤는 검은 별을 앞 순서(−1)로 옮긴 결과이다."
  },
  {
   "id": "S1-DI-04",
   "subtype": "순방향 변환",
   "stem": "다음 도식에서 '?'에 들어갈 문자열로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 502 72\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"502\" height=\"72\" fill=\"#ffffff\"/><text x=\"58\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"10\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"59\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">0D9G</text><line x1=\"106\" y1=\"42\" x2=\"125\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"132,42 124,46.5 124,37.5\" fill=\"#222\"/><polygon points=\"152,25.9 169,55.3 135,55.3\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"172\" y1=\"42\" x2=\"191\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"198,42 190,46.5 190,37.5\" fill=\"#222\"/><rect x=\"204.7\" y=\"28.7\" width=\"26.5\" height=\"26.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"238\" y1=\"42\" x2=\"257\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"264,42 256,46.5 256,37.5\" fill=\"#222\"/><polygon points=\"301,42 292.5,56.4 275.5,56.4 267,42 275.5,27.6 292.5,27.6\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"304\" y1=\"42\" x2=\"323\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"330,42 322,46.5 322,37.5\" fill=\"#222\"/><polygon points=\"350,25.5 354.4,37.3 367,37.8 357.1,45.7 360.5,57.8 350,50.8 339.5,57.8 342.9,45.7 333,37.8 345.6,37.3\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"370\" y1=\"42\" x2=\"389\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"396,42 388,46.5 388,37.5\" fill=\"#222\"/><text x=\"444\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"396\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"444\" y=\"51\" font-size=\"26\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text></svg>",
    "caption": ""
   },
   "choices": [
    "3E2H",
    "3H2E",
    "1H0E",
    "2H1E",
    "1J0G"
   ],
   "answer": 2,
   "explanation": "<b>풀이</b> 0D9G → (회색 삼각형: 1·2, 3·4 자리 교환) → D0G9 → (흰 사각형: 맨 앞 → 맨 뒤) → 0G9D → (검은 육각형: 홀수 자리 +2) → 2G1D → (검은 별: 모든 문자 +1) → 3H2E<br>따라서 '?'에 들어갈 문자열은 3H2E(②)이다.<br><b>오답</b> ①은 흰 사각형 대신 회색 삼각형을 적용한 결과이다. ③은 검은 육각형을 빠뜨린 결과이다. ④는 검은 육각형에서 두 칸이 아니라 한 칸만 옮긴 결과이다. ⑤는 흰 사각형과 검은 육각형의 순서를 바꿔 적용한 결과이다."
  },
  {
   "id": "S1-DI-05",
   "subtype": "빠진 기호 추론",
   "stem": "다음 도식에서 '?'에 들어갈 기호로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 436 72\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"436\" height=\"72\" fill=\"#ffffff\"/><text x=\"58\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"10\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"59\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">J34W</text><line x1=\"106\" y1=\"42\" x2=\"125\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"132,42 124,46.5 124,37.5\" fill=\"#222\"/><rect x=\"138.7\" y=\"28.7\" width=\"26.5\" height=\"26.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"172\" y1=\"42\" x2=\"191\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"198,42 190,46.5 190,37.5\" fill=\"#222\"/><circle cx=\"218\" cy=\"42\" r=\"14.6\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"238\" y1=\"42\" x2=\"257\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"264,42 256,46.5 256,37.5\" fill=\"#222\"/><circle cx=\"284\" cy=\"42\" r=\"18\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"1.8\" stroke-dasharray=\"4 3\"/><text x=\"284\" y=\"49\" font-size=\"20\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text><line x1=\"304\" y1=\"42\" x2=\"323\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"330,42 322,46.5 322,37.5\" fill=\"#222\"/><text x=\"378\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"330\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"379\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">LW63</text></svg>",
    "caption": ""
   },
   "choiceSvgs": [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><polygon points=\"55,10.5 59.7,23 73,23.6 62.5,31.9 66.1,44.7 55,37.4 43.9,44.7 47.5,31.9 37,23.6 50.3,23\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">검은 별</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><circle cx=\"55\" cy=\"28\" r=\"15.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">흰 원</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><polygon points=\"55,10.9 73,42 37,42\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">회색 삼각형</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><rect x=\"41\" y=\"14\" width=\"28.1\" height=\"28.1\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">흰 사각형</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><polygon points=\"73,28 64,43.3 46,43.3 37,28 46,12.7 64,12.7\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">검은 육각형</text></svg>"
   ],
   "answer": 5,
   "explanation": "<b>풀이</b> 입력 J34W에 '?' 앞의 기호를 적용하면 J34W → (흰 사각형: 맨 앞 → 맨 뒤) → 34WJ → (흰 원: 역순) → JW43이다. '?'를 지난 결과가 곧 출력 LW63이다. 따라서 '?'는 JW43을 LW63으로 바꾸는 기호, 곧 <b>검은 육각형</b>(홀수 자리 +2, ⑤)이다.<br><b>오답</b> 다른 기호를 넣으면 출력이 달라진다. 검은 별 → KX54, 흰 원 → 34WJ, 회색 삼각형 → WJ34, 흰 사각형 → W43J."
  },
  {
   "id": "S1-DI-06",
   "subtype": "빠진 기호 추론",
   "stem": "다음 도식에서 '?'에 들어갈 기호로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 502 72\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"502\" height=\"72\" fill=\"#ffffff\"/><text x=\"58\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"10\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"59\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">4AW7</text><line x1=\"106\" y1=\"42\" x2=\"125\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"132,42 124,46.5 124,37.5\" fill=\"#222\"/><circle cx=\"152\" cy=\"42\" r=\"18\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"1.8\" stroke-dasharray=\"4 3\"/><text x=\"152\" y=\"49\" font-size=\"20\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text><line x1=\"172\" y1=\"42\" x2=\"191\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"198,42 190,46.5 190,37.5\" fill=\"#222\"/><rect x=\"204.7\" y=\"28.7\" width=\"26.5\" height=\"26.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"238\" y1=\"42\" x2=\"257\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"264,42 256,46.5 256,37.5\" fill=\"#222\"/><circle cx=\"284\" cy=\"42\" r=\"14.6\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"304\" y1=\"42\" x2=\"323\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"330,42 322,46.5 322,37.5\" fill=\"#222\"/><polygon points=\"350,25.9 367,55.3 333,55.3\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"370\" y1=\"42\" x2=\"389\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"396,42 388,46.5 388,37.5\" fill=\"#222\"/><text x=\"444\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"396\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"445\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">85BX</text></svg>",
    "caption": ""
   },
   "choiceSvgs": [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><polygon points=\"55,10.5 59.7,23 73,23.6 62.5,31.9 66.1,44.7 55,37.4 43.9,44.7 47.5,31.9 37,23.6 50.3,23\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">검은 별</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><circle cx=\"55\" cy=\"28\" r=\"15.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">흰 원</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><polygon points=\"55,10.9 73,42 37,42\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">회색 삼각형</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><rect x=\"41\" y=\"14\" width=\"28.1\" height=\"28.1\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">흰 사각형</text></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 110 74\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"110\" height=\"74\" fill=\"#ffffff\"/><polygon points=\"73,28 64,43.3 46,43.3 37,28 46,12.7 64,12.7\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><text x=\"55\" y=\"66\" font-size=\"13\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">검은 육각형</text></svg>"
   ],
   "answer": 1,
   "explanation": "<b>풀이</b> '?'에는 입력 4AW7이 그대로 들어간다. 출력 85BX에서 '?' 뒤의 기호를 거꾸로 되돌리면 85BX → (회색 삼각형 되돌리기: 1·2, 3·4 자리 교환) → 58XB → (흰 원 되돌리기: 역순) → BX85 → (흰 사각형 되돌리기: 맨 뒤 → 맨 앞) → 5BX8이다. 따라서 '?'는 4AW7을 5BX8로 바꾸는 기호, 곧 <b>검은 별</b>(모든 문자 +1, ①)이다.<br><b>오답</b> 다른 기호를 넣으면 출력이 달라진다. 흰 원 → 47WA, 회색 삼각형 → WA47, 흰 사각형 → 4AW7, 검은 육각형 → 76AY."
  },
  {
   "id": "S1-DI-07",
   "subtype": "역방향 추론",
   "stem": "다음 도식의 출력이 19N5일 때, '?'에 들어갈 입력으로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 436 72\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"436\" height=\"72\" fill=\"#ffffff\"/><text x=\"58\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"10\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"58\" y=\"51\" font-size=\"26\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text><line x1=\"106\" y1=\"42\" x2=\"125\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"132,42 124,46.5 124,37.5\" fill=\"#222\"/><rect x=\"138.7\" y=\"28.7\" width=\"26.5\" height=\"26.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"172\" y1=\"42\" x2=\"191\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"198,42 190,46.5 190,37.5\" fill=\"#222\"/><polygon points=\"218,25.5 222.4,37.3 235,37.8 225.1,45.7 228.5,57.8 218,50.8 207.5,57.8 210.9,45.7 201,37.8 213.6,37.3\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"238\" y1=\"42\" x2=\"257\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"264,42 256,46.5 256,37.5\" fill=\"#222\"/><polygon points=\"284,25.9 301,55.3 267,55.3\" fill=\"#9a9a9a\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"304\" y1=\"42\" x2=\"323\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"330,42 322,46.5 322,37.5\" fill=\"#222\"/><text x=\"378\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"330\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"379\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">19N5</text></svg>",
    "caption": ""
   },
   "choices": [
    "8M40",
    "M804",
    "408M",
    "04M8",
    "804M"
   ],
   "answer": 2,
   "explanation": "<b>풀이</b> 출력 19N5에서 기호를 뒤에서부터 거꾸로 되돌린다: 19N5 → (회색 삼각형 되돌리기: 1·2, 3·4 자리 교환) → 915N → (검은 별 되돌리기: 모든 문자 −1) → 804M → (흰 사각형 되돌리기: 맨 뒤 → 맨 앞) → M804.<br>검산: M804 → (흰 사각형: 맨 앞 → 맨 뒤) → 804M → (검은 별: 모든 문자 +1) → 915N → (회색 삼각형: 1·2, 3·4 자리 교환) → 19N5. 따라서 입력은 M804(②)이다.<br><b>오답</b> ①은 회색 삼각형을 되돌릴 때 앞 두 자리와 뒤 두 자리를 통째로 맞바꾼 값으로, 넣어 보면 출력이 5N91이 된다. ③은 되돌릴 때 회색 삼각형을 빠뜨린 값으로, 넣어 보면 출력이 915N이 된다. ④는 되돌리는 순서를 거꾸로(첫 기호부터) 한 값으로, 넣어 보면 출력이 N519가 된다. ⑤는 되돌릴 때 흰 사각형을 빠뜨린 값으로, 넣어 보면 출력이 519N이 된다."
  },
  {
   "id": "S1-DI-08",
   "subtype": "복합 변환",
   "stem": "두 도식 (가), (나)의 ㉠은 같은 기호이다. (나)의 '?'에 들어갈 문자열로 알맞은 것은?",
   "figure": {
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 470 156\" font-family=\"Pretendard, 'Noto Sans KR', sans-serif\"><rect x=\"0\" y=\"0\" width=\"470\" height=\"156\" fill=\"#ffffff\"/><text x=\"20\" y=\"47\" font-size=\"15\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">(가)</text><text x=\"92\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"44\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"93\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">C01L</text><line x1=\"140\" y1=\"42\" x2=\"159\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"166,42 158,46.5 158,37.5\" fill=\"#222\"/><circle cx=\"186\" cy=\"42\" r=\"18\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"1.8\" stroke-dasharray=\"4 3\"/><text x=\"186\" y=\"48.5\" font-size=\"18\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">㉠</text><line x1=\"206\" y1=\"42\" x2=\"225\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"232,42 224,46.5 224,37.5\" fill=\"#222\"/><polygon points=\"269,42 260.5,56.4 243.5,56.4 235,42 243.5,27.6 260.5,27.6\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"272\" y1=\"42\" x2=\"291\" y2=\"42\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"298,42 290,46.5 290,37.5\" fill=\"#222\"/><text x=\"346\" y=\"15\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"298\" y=\"22\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"347\" y=\"49.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">N12C</text><line x1=\"8\" y1=\"76\" x2=\"404\" y2=\"76\" stroke=\"#bbbbbb\" stroke-width=\"1\" stroke-dasharray=\"3 3\"/><text x=\"20\" y=\"127\" font-size=\"15\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">(나)</text><text x=\"92\" y=\"95\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">입력</text><rect x=\"44\" y=\"102\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"93\" y=\"129.5\" font-size=\"21\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\" letter-spacing=\"2\">5H3K</text><line x1=\"140\" y1=\"122\" x2=\"159\" y2=\"122\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"166,122 158,126.5 158,117.5\" fill=\"#222\"/><rect x=\"172.7\" y=\"108.7\" width=\"26.5\" height=\"26.5\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"206\" y1=\"122\" x2=\"225\" y2=\"122\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"232,122 224,126.5 224,117.5\" fill=\"#222\"/><circle cx=\"252\" cy=\"122\" r=\"18\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"1.8\" stroke-dasharray=\"4 3\"/><text x=\"252\" y=\"128.5\" font-size=\"18\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">㉠</text><line x1=\"272\" y1=\"122\" x2=\"291\" y2=\"122\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"298,122 290,126.5 290,117.5\" fill=\"#222\"/><polygon points=\"335,122 326.5,136.4 309.5,136.4 301,122 309.5,107.6 326.5,107.6\" fill=\"#222222\" stroke=\"#222\" stroke-width=\"2\" stroke-linejoin=\"round\"/><line x1=\"338\" y1=\"122\" x2=\"357\" y2=\"122\" stroke=\"#222\" stroke-width=\"1.8\"/><polygon points=\"364,122 356,126.5 356,117.5\" fill=\"#222\"/><text x=\"412\" y=\"95\" font-size=\"12\" font-weight=\"400\" fill=\"#555\" text-anchor=\"middle\">출력</text><rect x=\"364\" y=\"102\" width=\"96\" height=\"40\" rx=\"4\" fill=\"#ffffff\" stroke=\"#222\" stroke-width=\"2\"/><text x=\"412\" y=\"131\" font-size=\"26\" font-weight=\"700\" fill=\"#222\" text-anchor=\"middle\">?</text></svg>",
    "caption": ""
   },
   "choices": [
    "5M3J",
    "M3J5",
    "7K5H",
    "K4N6",
    "5H7K"
   ],
   "answer": 3,
   "explanation": "<b>풀이</b> [1단계] (가)에서 ㉠ 찾기: 출력 N12C에서 검은 육각형을 되돌리면(홀수 자리 −2) L10C이다. 입력 C01L을 L10C로 바꾸는 기호는 <b>흰 원</b>(역순)뿐이다.<br>[2단계] (나)에 적용: 5H3K → (흰 사각형: 맨 앞 → 맨 뒤) → H3K5 → (흰 원: 역순) → 5K3H → (검은 육각형: 홀수 자리 +2) → 7K5H. 따라서 정답은 7K5H(③)이다.<br><b>오답</b> ①은 (나)에서 흰 원과 검은 육각형의 순서를 바꿔 적용한 결과이다. ②는 (나)에서 흰 사각형을 빠뜨린 결과이다. ④는 ㉠을 검은 별로 잘못 찾은 결과이다. ⑤는 ㉠을 회색 삼각형으로 잘못 찾은 결과이다."
  }
 ]
});
