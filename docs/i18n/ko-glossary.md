# 한국어(ko) 번역 용어집

`src/i18n/ko.ts`를 번역할 때 따르는 기준입니다. 번역 원문은 `en.ts`이고, 용어를 고를 때는 `ja.ts`를 참고합니다.
이 문서에서 정한 용어를 바꿀 때는 `ko.ts` 전체에 같은 변경을 반영합니다.

## 0. 규칙을 고르는 순서

1. 이 문서에 **키 이름으로 명시한 예외** (예: `settings.searchIndex.rebuild` → 색인 다시 만들기)
2. 표의 **문맥별 용어** (예: Sources가 생성에 쓴 노트·자료이면 '원본 자료')
3. 표의 **일반 대응어** (예: Rebuild → 재구성)
4. 표에 없으면 키 이름과 그 키를 쓰는 코드를 확인한 뒤 고르고, 자주 나오는 경우 이 문서에 추가합니다

## 1. 문체와 표기 원칙

### 문체

| 항목 | 규칙 | 예 |
|---|---|---|
| 안내·오류·설명 문장 | **합니다체** | 저장하지 못했습니다. 다시 시도해 주세요. |
| 버튼·메뉴·탭·열 이름 | 명사형 또는 `~하기` | 저장, 새 노트 열기, 지식 베이스에 추가 |
| 동작 이름형 툴팁 | 명사구, 마침표 없음 | 새 노트 열기 |
| 조건·제한·결과를 설명하는 툴팁 | 합니다체 문장 | 노트를 숨기지만 링크는 유지합니다. 언제든 복원할 수 있습니다. |
| 확인 질문 | 합니다체 의문문 | 이 노트를 삭제하시겠습니까? |
| 외래어 | 일본어판이 가타카나로 쓴 용어는 한국어도 외래어로 씁니다 (아래 표 기준) | 스텝, 인풋, 토픽 |

### 플레이스홀더와 조사

- `{name}` 같은 플레이스홀더는 **이름과 출현 횟수를 그대로** 유지합니다(테스트가 en과의 일치를 검사합니다).
- 번역 함수에는 받침에 따라 조사를 고르는 기능이 없습니다. 조사가 붙는 자리는 다음 순서로 처리합니다.
  1. 대상의 종류가 키에서 확실하면 명사를 보충합니다. 예: `'{name}' 노트를 삭제하시겠습니까?`
  2. 종류가 불확실하거나 여러 종류일 수 있으면 콜론이나 주제형으로 문장을 바꿉니다. 예: `모델: {name}`, `처리 중: {name}`, `먼저 되돌릴 작업: {name}`
- `'{name}'을(를)` 같은 병기는 쓰지 않습니다.

### 단복수 쌍 키

- 한국어는 단복수를 구분하지 않으므로 쌍을 이루는 키(`history.revisions` / `history.revisionsOne`, `version.count` / `version.countOne`, `version.editGroup` / `version.editGroupOne` 등)에 **같은 한국어 값**을 넣습니다.
- 키의 플레이스홀더 구성은 en과 같게 유지합니다. 숫자를 호출부가 앞에 붙이는 **조각 문자열**(예: `{n} revisions`의 `revisions`)에는 `{count}`를 새로 넣지 않습니다. 반드시 해당 키를 쓰는 코드를 확인합니다.
  - 조각 문자열 예: `history.revisions` → `건의 편집 기록` (호출부가 숫자 뒤에 공백을 넣으므로 화면은 `3 건의 편집 기록`. 붙여 쓰려면 번역이 아니라 UI 코드를 바꿔야 합니다)
  - 완성 문자열 예: `편집 {count}건`

### 기호·코드·서식

| 항목 | 규칙 |
|---|---|
| UI 요소 이름 인용 | 작은따옴표 `'…'` (일본어판의 「」, 영어판의 "…"에 해당) |
| 보존 대상 | 코드 문법·함수 표기(`col("table", "column")`), 함수명, 실제 경로(`_imported/`), URL, 파일 확장자, 식별자, 단축키(⌘⇧H), 화살표 등 기호는 **원문 그대로** 둡니다. 따옴표 통일도 하지 않습니다 |
| 줄바꿈·공백 | `\n`, 구분자, 문자열 앞뒤 공백은 쓰임을 확인하지 않고 지우거나 더하지 않습니다 |
| 진행 상태 말줄임 | `…`로 통일합니다 (원문은 `...`과 `…`가 섞여 있음). 예: 저장 중… |
| 라벨 괄호 | 원문의 `[ ]`를 유지합니다. 예: [스텝] |
| 고유명사·제품명 | 번역하지 않습니다: Graphium, PROV-DM, PROV-JSON-LD, MCP, Copilot, Markdown, PDF, CSV |

번역하지 않고 영어와 같은 값을 둘 때(브랜드명 등)도 `ko.ts`에 키와 값을 넣습니다. '영어와 같은 값' 허용 목록은 출시 검사와 함께 PR 1-c에서 도입합니다. 그 전까지는 해당 줄 끝에 `// 영어 유지` 주석을 달고, PR 1-c에서 이 주석이 달린 키를 목록으로 옮깁니다.

## 2. 지식 베이스

| 영어 | 일본어판 | 한국어 | 비고 |
|---|---|---|---|
| Knowledge (사이드바·영역 이름) | ナレッジ | **지식 베이스** | |
| Knowledge (설정 탭) | ナレッジ管理 | 지식 베이스 관리 | |
| knowledge (일반 명사, 출처 그룹 등) | 知識 | 지식 | |
| Claim | 知見 | **지견** | 노트·자료에서 뽑은 **진술 단위**입니다. 검증된 사실이라는 뜻이 아니며, 추측·질문·해석도 포함합니다 |
| Insight | 洞察 | **인사이트** | 지견들로부터 만드는 상위 종류. '통찰'로 쓰지 않습니다. 더 확실한 사실이라는 뜻은 아닙니다 |
| Topic | トピック | 토픽 | `話題`로 번역된 곳도 토픽으로 통일 |
| Summary | 要約 | 요약 | |
| Idea (synthesis) | 発想 | 아이디어 | |
| Q&A (answer) | 問答（Q&A） | 문답(Q&A) | |
| Answer | 回答 | 답변 | |
| Add to Knowledge | ナレッジに追加 | 지식 베이스에 추가 | |
| Ingest (노트·자료를 지식으로 만드는 처리) | 取り込み | **지식 베이스에 추가** | 처리 내용을 설명할 때는 '지견 추출·토픽 생성'. '반영'은 이미 설명된 처리의 결과를 가리킬 때만 씁니다. 예: Auto-apply on Ingest → 지식 베이스에 추가할 때 자동 적용 |
| Regenerate | 再生成 | 재생성 | |
| Rebuild | 再構築 | 재구성 | |
| Merge | 統合 | 통합 | |
| Check (lint 실행) | 点検 | 점검 | |
| Upkeep / Maintenance (유지관리 전체) | ナレッジ管理 / 手入れ | 유지관리 | 점검은 검사 실행, 유지관리는 통합·아카이브·재구성 등 전체 |
| Operation (유지관리 문맥) | 操作 | 작업 | `panel.prov.operations`(계획에 속한 작업 노트)도 '작업' |
| Proposal | 提案 | 제안 | |

### 지견의 역할 (claimRole)

| 영어 | 일본어판 | 한국어 |
|---|---|---|
| Finding | 発見・観察 | 발견·관찰 |
| Decision | 決定・選択 | 결정·선택 |
| Anomaly | 予期せぬ事象 | 예상 밖의 현상 |
| Question | 残された問い | 남은 질문 |
| Setup | 設定・条件 | 설정·조건 |
| Interpretation | 解釈 | 해석 |
| Issue | 課題・問題 | 과제·문제 |

## 3. PROV 라벨·내력

외래어 혼용 방침입니다. 일본어판이 한자어로 쓴 라벨(計画, 結果)은 한국어도 한자어로 씁니다.
외래어 라벨은 **라벨 키에만** 씁니다. 일반 UI의 입력란·출력 형식 등은 입력·출력으로 씁니다.

| 영어 | 일본어판 | 한국어 | 비고 |
|---|---|---|---|
| Step | ステップ | **스텝** | |
| Input (used / material 라벨) | インプット | **인풋** | |
| Output (라벨) | アウトプット | **아웃풋** | |
| Parameter (attribute 라벨) | パラメータ | **파라미터** | |
| Tool (라벨) | ツール | **툴** | |
| Plan | 計画 | 계획 | |
| Result | 結果 | 결과 | |
| Prior step | 前ステップ | 이전 스텝 | |
| Planned / In progress / Done / Skipped | 予定 / 進行中 / 完了 / スキップ | 예정 / 진행 중 / 완료 / 건너뜀 | |
| Manual / Machine (executor) | 手動 / 機械 | 수동 / 기계 | |
| Entity / Activity (PROV 개념) | エンティティ / アクティビティ | 엔티티 / 활동 | |
| Provenance | 来歴 | **내력** | 누가·언제·어떤 출처로 만들었는지와 파생 관계. 편집 이력(History)과 구분 |
| Lineage (패널 이름) | 来歴 | 내력 | 상류(원본 쪽)를 거슬러 올라가며 보는 트리 |
| Genealogy | 系譜 | 계보 | 단계별로 이어지는 파생 흐름 |
| Derived / derived from | ここから作った / 元にした | 파생 / 파생 원본 | 예: Derived notes → 여기서 파생한 노트 |
| Neighbors | 近傍 | 이웃 | |

자유 라벨: Purpose 목적, Discussion 고찰, Question 질문, Evidence 증거, Background 배경, Reference 참고, Impression 소감

## 4. 노트·자료·보관·표

| 영어 | 일본어판 | 한국어 | 비고 |
|---|---|---|---|
| Note | ノート | 노트 | |
| Memo | メモ | 메모 | |
| Materials / asset | 素材 | 자료 | |
| Media | メディア | 미디어 | |
| Template | テンプレート | 템플릿 | |
| Folder | フォルダ | 폴더 | |
| Library | ライブラリ | 라이브러리 | |
| Repository (사이드바 그룹) | 保管庫 | 보관함 | |
| Trash | ゴミ箱 | 휴지통 | |
| Archive | アーカイブ | 아카이브 | 보관함과 혼용하지 않습니다 |
| Restore | 復元 | 복원 | |
| Bring in files | ファイル取り込み | 파일 가져오기 | |
| Import | 取り込む | 가져오기 | |
| Export | 書き出す | 내보내기 | |
| History (편집 기록) | 履歴 | **편집 이력** | 짧은 탭 이름에서는 '이력' |
| Version | バージョン | 버전 | |
| Undo | 元に戻す / 取り消し | 되돌리기 | |
| Read-only | 読み取り専用 | 읽기 전용 | '수정 불가'와 혼용하지 않습니다 |
| Label | ラベル | 라벨 | |
| Page (지식 페이지·노트 페이지) | ページ | 페이지 | 노트와 동의어로 바꿔 쓰지 않습니다 |
| Page (PDF 등 문서의 쪽 번호) | ページ / 頁 | 쪽 | 예: Page {page} → {page}쪽 |
| Link / Linked | リンク | 링크 / 연결됨 | Outgoing / Incoming → 나가는 링크 / 들어오는 링크. 설정의 Connect(연결)와 구분 |
| Table | テーブル / 表 | 표 | 직접 편집하는 일반 표 |
| Data table | データテーブル | 데이터 표 | CSV 등 자료를 참조하며 셀을 직접 편집하지 않는 표 |
| Row / Column / Cell | 行 / 列 / セル | 행 / 열 / 셀 | 함수 표기·코드 인자는 원문 유지 |
| Chart | チャート | 차트 | |
| Calculation (calc) | 計算 | 계산 | |
| Block | ブロック | 블록 | |

## 5. 출처·검증

| 영어 | 일본어판 | 한국어 | 비고 |
|---|---|---|---|
| Source check | 出典照合 | 출처 대조 | 출처가 실제로 그렇게 말하는지 확인하는 기능. 진술의 진위 판단이 아닙니다 |
| Source (인용 출처) | 出典 / 引用元 | 출처 | 문맥에 따라: 제공처(template source), 참조 대상(chart source) |
| Sources (서지 목록) | 参考文献 | 참고 문헌 | 예: wikiBanner.worldSources |
| Sources (생성에 쓴 노트·자료) | 生成元 / 取り込み元 | 원본 자료 | 개수 열은 '원본 수' |
| Citation | 引用 | 인용 | |
| Evidence (근거) | 根拠 | 근거 | 자유 라벨 [Evidence]는 '증거' |
| Grounding (채팅 참조 범위) | 渡す範囲 | 참조 범위 | External 외부 참조 / Internal 내부 참조 / This note **노트 내 참조** (이 노트가 인용한 자료만 쓰고 전체 검색은 하지 않음) |
| Grounding data (설정 탭) | 照合データ | 대조 데이터 | |
| World grounding | 世界モデル照合 | **일반 지식 대조** | 축적된 대조 데이터를 먼저 보고, 없으면 모델의 지식으로 판단합니다. 대조 데이터는 사용자의 분야에 맞춰 쌓이므로 '일반'을 '상식'으로 좁혀 설명하지 않습니다. 사실 확정이 아닙니다. 사용자의 '지식 베이스'와 혼동하지 않도록 '기존 지식'이라는 표현은 쓰지 않습니다 |
| World (판정 열 이름, `wikiList.colWorldVerdict`) | 世界 | 일반 지식 대조 | 판정 결과 열이라는 것이 드러나게 합니다 |
| knowledge base (world grounding용 저장소) | KB | 대조 데이터 | 영역 이름 '지식 베이스'와 구분합니다 |

## 6. 음성 노트

| 영어 | 일본어판 | 한국어 | 비고 |
|---|---|---|---|
| Voice note | 音声ノート | 음성 노트 | |
| Recording | 録音 | 녹음 | |
| Transcript (결과물) | 文字起こし | **녹취록** | Transcript (original) → 녹취록(원본) |
| Transcribe (동작) | 文字起こし | 텍스트로 변환 | 진행 중: 텍스트로 변환 중… / 실시간 옵션: 녹음 중 텍스트로 변환 |
| Clean copy | 清書 | 정리본 | |
| Summary | 要約 | 요약 | |
| Write out (상위 메뉴) | 書き出す | 내보내기 | 하위 목적지: To this note 이 노트에 추가 / To a new note 새 노트로 / To the minutes note 회의록 노트로 / Markdown·Text 파일로 저장 |
| Minutes | 議事録 | 회의록 | |

## 7. AI·설정·화면

| 영어 | 일본어판 | 한국어 | 비고 |
|---|---|---|---|
| Settings | 設定 | 설정 | |
| Chat | チャット | 채팅 | |
| Ask | 質問 | 질문 | |
| Skill | スキル | 스킬 | |
| Model | モデル | 모델 | |
| Provider | プロバイダー | 프로바이더 | |
| Connect | 接続 | 연결 | |
| Storage | ストレージ | 스토리지 | |
| Sync | 同期 | 동기화 | |
| Search index | 検索インデックス / 索引 | 검색 색인 | '인덱스'와 혼용하지 않습니다. Rebuild index → 색인 다시 만들기, Rebuilding… → 다시 만드는 중…, Updating index → 색인 업데이트 중, indexed → 색인됨 |
| Embedding | 埋め込み | 임베딩 | |
| Global Graph | 全体グラフ | 전체 그래프 | |
| Island | 島 | 섬 | |
| Share / Shared | 共有 / 共有済み | 공유 / 공유됨 | |
| Team | チーム | 팀 | |
| Sidebar | サイドバー | 사이드바 | |

## 8. 판정·확실성

판정 결과를 '사실로 확인됨'처럼 옮기지 않습니다. 출처 대조는 **출처와의 일치 여부**, 일반 지식 대조는 **대조 데이터·모델 지식과의 정합성**만 말합니다.

| 키 | 영어 | 한국어 |
|---|---|---|
| `sourceCheck.verdict.supported` | Found in source | 출처에 있음 |
| `sourceCheck.verdict.contradicted` | Differs from source | 출처와 다름 |
| `sourceCheck.verdict.not-in-source` | Not in source | 출처에 없음 |
| `sourceCheck.verdict.unclear` | Couldn't tell | 판단 불가 |
| `sourceCheck.verdict.source-missing` | Source unavailable | 출처를 열 수 없음 |
| `wikiBanner.worldVerdict.established` | Aligned with established | 정설과 부합 |
| `wikiBanner.worldVerdict.supported` | Aligned with supported | 뒷받침된 지식과 부합 |
| `wikiBanner.worldVerdict.weak` | KB sees as weakly-grounded | 대조 데이터상 근거가 약함 |
| `wikiBanner.worldVerdict.contested` | KB has counter-evidence | 대조 데이터에 반례가 있음 |
| `wikiTypes.epistemicStatus.*` | Speculation / Interpretation / Observation / Established | 추측 / 해석 / 관찰 / 정설 |
| confidence | Confidence | 확신도 (생성 시 AI의 자기 평가. '신뢰도'로 쓰지 않습니다) |

## 9. 수량·단위·범위·시간

- **번역이 숫자와 단위를 모두 갖는 완성 문자열**(`{n}`, `{count}` 등이 들어 있음)은 숫자에 단위를 붙여 씁니다: `노트 {count}개`, `{n}건`, `{page}쪽`.
- **호출부가 숫자를 붙이는 조각 문자열**은 1장 '단복수 쌍 키' 규칙을 따릅니다(숫자와 번역 사이의 공백은 코드가 정합니다).
- 단위 명사: 노트·자료·파일 → 개, 처리·결과·기록·변경 → 건, 페이지 번호 → 쪽, 단락 번호 → 번째 단락.
- 범위: `{page}–{pageEnd}`처럼 원문의 범위 기호를 유지합니다. 예: `Pages {page}–{pageEnd}` → `{page}–{pageEnd}쪽`
- 상대 시간: `just now` 방금, `{n}m ago` {n}분 전, `{n}h ago` {n}시간 전, `yesterday` 어제, `{n}d ago` {n}일 전, `{n}w ago` {n}주 전, `{n}mo ago` {n}개월 전.
- 목록 구분: 영어의 `·`, `,`는 그대로 쓰되, 일본어판의 `、`·`・`는 쓰지 않습니다(코드의 목록 구분자는 ko에서 `, `).

## 10. 주의

- 일본어판 안에서도 같은 영어 단어가 문맥별로 다르게 번역된 경우(Source, Sources, Table, Label, Page 등)가 있습니다. 위 표의 구분을 따르고, 표에 없는 문맥이면 키 이름과 쓰는 코드를 확인한 뒤 고릅니다.
- 같은 한국어가 서로 다른 개념에 겹치지 않게 합니다: 보관함(Repository) ≠ 아카이브(Archive), 편집 이력(History) ≠ 내력(Provenance), 지식 베이스(사용자 영역) ≠ 대조 데이터(world grounding용).
