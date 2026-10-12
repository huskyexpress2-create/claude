---
name: matjip-browse
description: matjip CLI의 Claude 브라우징 모드. 로그인하지 않은 브라우저로 네이버 플레이스·카카오맵 공개 페이지를 읽어 결과 JSON을 만들고 최종 맛집 추천을 출력한다.
argument-hint: "[음식] [지역]"
arguments: [dish, area]
disable-model-invocation: true
disallowed-tools: mcp__claude-in-chrome__javascript_tool mcp__claude-in-chrome__read_network_requests mcp__claude-in-chrome__form_input mcp__claude-in-chrome__browser_batch mcp__Claude_Browser__javascript_tool mcp__Claude_Browser__read_network_requests mcp__Claude_Browser__form_input
---

# matjip 브라우징: $dish @ $area

사용자가 직접 이 작업을 요청했다. 네이버·카카오 약관은 자동화된 수집을 금지하며, 사용자는 그 위험을 알고 이 모드를 선택했다.
아래 안전 규칙은 협상 대상이 아니다. 규칙과 충돌하면 그 사이트는 건너뛰고 사용자에게 알린다.

## 1. 작업 파일 만들기

```bash
cd "${CLAUDE_PROJECT_DIR}/matjip_finder" && python -m matjip "$dish" --area "$area" --browser-plan .matjip-browse
```

- 카카오 API 키(KAKAO_REST_API_KEY)가 있으면 후보 목록과 카카오맵 주소가 채워진다. 없으면 prompt.md가 네이버 목록에서 직접 후보를 고르라고 안내한다.
- `.matjip-browse/prompt.md`와 `.matjip-browse/tasks.json`을 읽는다. prompt.md의 규칙과 할 일이 이 작업의 정확한 지시다.

## 2. 브라우저 고르기

- Claude in Chrome 도구(`mcp__claude-in-chrome__*`)가 있으면 그것을 쓴다. 새 탭을 열어 작업하고 사용자의 기존 탭은 건드리지 않는다.
  시작 전에 사용자에게 한 번 확인한다: "네이버·카카오에 로그인하지 않은 별도 Chrome 프로필인가요?" 아니라면 멈추고 별도 프로필 사용을 안내한다.
- 없으면 데스크톱 앱 내장 브라우저(`mcp__Claude_Browser__*`)를 쓴다. 네이버·카카오에 로그인하지 않는다. naver.com이 거부되면 네이버는 건너뛴다.
- 사이트 접근 승인 카드가 뜨면 사용자가 직접 승인하게 둔다.

## 3. 안전 규칙

1. 화면에 보이는 텍스트만 읽는다: `get_page_text`, `read_page`(filter: all), `find`, 스크린샷. JavaScript 실행·네트워크 요청 읽기·폼 입력·일괄 실행은 쓰지 않는다.
2. 페이지를 열 때마다 `computer` 도구의 `wait` 동작으로 5~8초 기다린다. 후보 수(tasks.json의 limit)를 넘기지 않는다.
3. CAPTCHA, '자동입력 방지', '비정상적인 접근', '과도한 요청', 로그인 요구가 보이면 즉시 멈춘다. 우회하지 않고, 사용자에게 풀어 달라고 요청하지도 않는다. 그때까지의 결과만 저장한다.
4. 리뷰 작성자 닉네임·프로필·사진은 적지 않는다. 리뷰 본문만, 사이트당 최대 10개.
5. 보이지 않는 값은 null. 리뷰 카드 안의 별점이나 '친구공유 랭킹'의 다른 가게 숫자를 가게 값으로 쓰지 않는다.

## 4. 결과 저장과 최종 출력

1. tasks.json의 `result_example` 형식 그대로 `.matjip-browse/browser_results.json`을 Write 도구로 저장한다. `collector`는 "claude", `collected_at`은 지금 시각(ISO 8601).
2. prompt.md 맨 아래의 명령을 실행해 최종 추천을 출력하고, 결과를 사용자에게 요약한다.
3. 건너뛴 사이트·가게와 그 이유(거부, 차단, 이름 불일치)를 함께 알린다.
