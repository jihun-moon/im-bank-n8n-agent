# SecureFlow

보안 로그를 받아서 개인정보를 지우고, 위험도를 매기고, 쓸 만한 건만 골라 지식베이스에 쌓는 파이프라인입니다.

2025 대구울산경북 AI Agent 해커톤 출품작이고 결선 최우수상을 받았습니다. 팀 AIM (AI + IM).

<p>
  <img src="https://img.shields.io/badge/n8n-EA4B71?style=flat-square&logo=n8n&logoColor=white"/>
  <img src="https://img.shields.io/badge/Node.js_20-339933?style=flat-square&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/Express_5-000000?style=flat-square&logo=express&logoColor=white"/>
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white"/>
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black"/>
  <img src="https://img.shields.io/badge/Upstage_Solar_Pro_2-7C3AED?style=flat-square"/>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"/>
</p>

> 이 저장소의 데이터는 전부 합성 로그입니다. `logs.env` 값이 12,458건 모두 `lab` 입니다.
> 실제 금융기관 로그를 쓴 적은 없고, 아래 숫자는 실험 환경에서 26시간 돌린 기록입니다.

<br/>

## 1. 풀려던 문제

보안 로그는 사람이 다 못 봅니다. 그렇다고 전부 LLM에 넣으면 비용이 안 맞고, 개인정보가 그대로 외부 모델로 나갑니다.

그래서 두 가지를 같이 만족시켜야 했습니다.

1. 개인정보는 모델에 닿기 전에 없어야 한다
2. 볼 가치가 없는 로그는 모델까지 가지도 않아야 한다

이 두 개가 설계를 거의 다 결정했습니다.

<br/>

## 2. 어떻게 돌아가나

```
      외부 시스템
          │ Webhook
          ▼
  ┌───────────────────────────────────────────────┐
  │  n8n : SecurityFlow Full Auto Analysis        │
  │                                               │
  │   1. Raw Queue 적재                           │
  │   2. 룰 기반 선분류   (쓰레기면 여기서 끝)     │
  │   3. 정규식 PII 탐지                          │
  │   4. 원본 로그 마스킹                         │
  │   5. LLM 위험도 판정  Solar Pro 2 → Gemini    │
  │   6. 유사 사례 조회   (Security KB)           │
  │   7. 학습 대상 판단                           │
  └───────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
   POST /api/logs             POST /security-kb
          │                          │
  ┌───────────────────────────────────────────────┐
  │  Express 5 + better-sqlite3                   │
  │  logs (27컬럼) · kb_items                     │
  │  라우트 20개 · SSE /events                    │
  └───────────────────────────────────────────────┘
          │ SSE
          ▼
   React 19 대시보드
          │
          └── High 위험도면 Slack 알림
```

`n8n-workflows/securityflow-full-auto-analysis.json` 에 실제 워크플로 내보내기를 넣어 뒀습니다.
노드 43개인데 그중 21개는 워크플로 안에 직접 써 둔 설명 노트입니다.
발표 시연용 변형이라 이름에 Demo 가 붙어 있고 LLM 응답을 흉내 내는 노드가 하나 들어 있습니다.
자격증명은 n8n 인스턴스에 저장되고 파일에는 참조 이름만 남습니다.

<br/>

## 3. 설계에서 고민한 것

### 정규식 마스킹을 LLM 앞에 둔 이유

순서를 바꾸면 개인정보가 외부 API로 나갑니다. 그래서 마스킹은 반드시 LLM 호출보다 앞입니다.

패턴은 다섯 개입니다.

| 종류 | 정규식 | 치환 |
|---|---|---|
| 이메일 | `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` | `[EMAIL]` |
| 전화번호 | `\b0\d{1,2}-?\d{3,4}-?\d{4}\b` | `[PHONE]` |
| 주민등록번호 | `\b\d{6}[- ]?\d{7}\b` | `[RRN]` |
| 카드번호 | `\b(?:\d[ -]*?){13,16}\b` | `[CARD]` |
| IP 주소 | `\b\d{1,3}(?:\.\d{1,3}){3}\b` | `[IP]` |

원본을 덮어쓰지 않고 `redactedLog` 라는 별도 필드에 마스킹본을 만듭니다.
대시보드와 백엔드는 마스킹본만 봅니다. 400자로 자른 `redactedSnippet` 도 같이 만들어서
목록 화면이 긴 로그를 통째로 들고 오지 않게 했습니다.

### IP를 민감정보에서 뺀 이유

IP를 개인정보로 세면 거의 모든 로그가 개인정보 포함으로 잡힙니다. 그러면 학습에 쓸 게 남지 않습니다.

그래서 IP는 마스킹은 하되 위험도 판단과 학습 제외 기준에서는 뺐습니다.
코드에서 `ip_hits` 를 따로 세고 `pii_regex_found` 에는 넣지 않습니다.
실제로 마스킹된 것 중 IP가 가장 많았습니다.

### 룰 기반 선분류를 앞에 둔 이유

돌려 보니 로그의 **43.3%(12,458건 중 5,398건)** 가 볼 필요 없는 것이었습니다.

| 사유 | 건수 |
|---|---|
| 헬스체크/상태 확인 로그 | 5,015 |
| 테스트/디버그 로그 | 383 |

소스별로도 세어 봤습니다.

| 소스 | 건수 |
|---|---|
| SYSTEM_AUDIT (시스템 배치/감사) | 5,015 |
| WEB_APP (웹 애플리케이션) | 3,014 |
| FILE_SERVER (파일 서버) | 2,624 |
| LOGIN_GATEWAY (로그인 게이트웨이) | 586 |
| OBJECT_STORAGE (오브젝트 스토리지) | 475 |

`SYSTEM_AUDIT` 5,015건과 헬스체크 쓰레기 5,015건이 정확히 같습니다.
소스 하나가 통째로 노이즈였다는 뜻입니다.
이걸 보고 나서는 로그를 한 건씩 판정하는 것보다 소스 단위로 먼저 자르는 게 훨씬 싸다는 걸 알았습니다.

### Solar Pro 2 를 주 모델로 쓰고 Gemini 를 뒤에 둔 이유

한국어 보안 로그를 다루니까 응답이 한국어로 안정적으로 나와야 했습니다.
Solar Pro 2 를 주 모델로 쓰고, 호출이 실패할 때를 대비해 Gemini 를 같은 체인 안에 폴백으로 붙였습니다.
모델 하나에 묶여 있으면 그 API가 흔들릴 때 파이프라인 전체가 멈춥니다.

### 학습에 넣은 것과 뺀 것

지식베이스에 넣는 조건을 두 개로 정했습니다.

1. 정규식 PII가 하나도 안 잡힌 로그만
2. 위험도가 High 또는 Medium 인 것만

Safe 를 넣으면 KB가 평범한 로그로 가득 차서 유사 사례 조회가 쓸모없어집니다.
PII가 잡힌 것은 마스킹을 했더라도 넣지 않았습니다. 정규식이 놓친 게 있을 수 있어서입니다.

그 결과 12,458건 중 **4,678건(37.6%)** 이 학습 대상이 됐고 4,656건이 완료됐습니다.
남은 22건은 워커가 처리하기 전에 관측을 끝낸 분량입니다.

<br/>

## 4. 26시간 돌린 결과

2025-11-18 14:36 부터 11-19 16:35 까지의 기록입니다.
아래 숫자는 저장소에 들어 있는 `backend/data/secureflow.db` 를 직접 집계한 값이라 그대로 재현됩니다.

**처리량과 판정**

| 항목 | 값 |
|---|---|
| 처리 로그 | 12,458건 (log_id 중복 0) |
| 위험도 | Safe 7,483 · Medium 3,850 · High 1,125 |
| 사고 유형 | monitoring 8,038 · exfiltration 3,476 · credential_abuse 629 · misconfiguration 312 |
| PII 탐지 | 290건 (2.3%) |
| 학습 반영 | 4,656건 |

PII가 잡힌 290건의 조합은 `EMAIL,PHONE` 154건과 `PHONE,RRN,CARD` 136건 두 가지였습니다.

**처리 시간**

| 구간 | 값 |
|---|---|
| p50 | 0.2초 |
| p75 | 1.6초 |
| p90 | 2.2초 |
| p95 | 2.5초 |
| p99 | 182.4초 |
| 최대 | 243.5초 |
| 평균 | 4.1초 |

p95까지 2.5초인데 p99가 182초입니다.
평균 4.1초는 상위 1%가 만들어 낸 숫자라서 평균만 보고 있었으면 문제를 못 봤을 겁니다.
워커를 하나만 돌리고 있어서 앞에 무거운 게 걸리면 뒤가 통째로 밀립니다.
순서를 보장하려고 하나로 뒀던 건데, 지금 다시 만든다면 소스별로 큐를 나눌 것 같습니다.

<br/>

## 5. 돌려 보고 나서 찾은 것

### LLM이 정해 준 값 밖으로 나갔다

사고 유형은 네 개 중 하나로 받기로 했는데 집계해 보니 셋이 밖에 있었습니다.

| 값 | 건수 | 무엇 |
|---|---|---|
| `exfiltration \| misconfiguration` | 1 | 둘 중 못 고르고 파이프로 붙여서 반환 |
| `exfilteration` | 1 | 철자 틀림 |
| `account_abuse` | 1 | 없는 유형을 지어냄 |

12,458건 중 3건이라 비율로는 0.024%입니다.
그런데 이걸 그대로 두면 대시보드 필터에서 조용히 빠지고, 집계 화면에서 사라진 걸 아무도 모릅니다.
프롬프트로 형식을 지정하는 것만으로는 부족하고, 받는 쪽에서 값을 검증하고
벗어난 것은 따로 모아 둬야 한다는 걸 여기서 배웠습니다.

### 재배포가 데이터를 지우고 있었다

`deploy_secureflow.sh` 에 로그와 KB를 지우고 시작하는 단계가 있었습니다.
처음엔 깨끗하게 시작하려고 넣은 건데, 운영 중에 재배포하면 그때까지 쌓인 게 다 사라졌습니다.
PM2 의 `watch` 옵션도 같은 사고를 냈습니다. 파일이 바뀔 때마다 재시작하면서 데이터를 날렸습니다.

지금은 초기화 단계를 빼고 `watch: false` 로 박아 뒀습니다. 지운 자리에 주석을 남겨 놨습니다.

### 큐를 앞에 두기 전에는 유실이 있었다

처음에는 웹훅이 들어오면 바로 분석까지 이어서 돌렸습니다.
LLM 호출이 느려지면 뒤에 들어온 요청이 그냥 사라졌습니다.
웹훅은 받아서 큐에 넣는 것만 하고 워커가 따로 꺼내 가도록 나눈 뒤로는 유실이 없어졌습니다.

<br/>

## 6. 마스킹이 실제로 먹었는지 확인

저장소에 들어 있는 백업 CSV 15개(약 27MB, 고유 log_id 18,669건)와
`backend/data/secureflow.db` 의 텍스트 컬럼 전체를 훑어서
주민번호, 카드번호, 전화번호, 이메일 패턴을 찾아봤습니다.

```bash
cat sf_backups/*.csv | grep -ohE '[0-9]{6}-[1-4][0-9]{6}|[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{4}|01[0-9]-[0-9]{3,4}-[0-9]{4}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
```

결과는 0건입니다. 같은 정규식에 값을 일부러 넣어서 잡히는 것도 확인했습니다.
저장된 텍스트에는 `[IP]` `[PHONE]` `[EMAIL]` `[RRN]` `[CARD]` 치환 토큰만 남아 있습니다.

처음에는 CSV 만 보고 0건이라고 적었는데, 나중에 DB 를 따로 열어 보니
`meta_json` 컬럼에 원본 페이로드가 마스킹 없이 남아 있었습니다.
전화번호 290건, 이메일 308건, 주민번호 형태 136건이었습니다.
원본을 따로 보관하는 설계였는데 그 컬럼이 마스킹 대상에서 빠져 있었던 것입니다.
지금은 같은 규칙으로 마스킹해서 0건이고, 집계 수치는 그대로입니다.
**어디까지 확인했는지를 안 적으면 0건이라는 말이 거짓이 된다**는 걸 여기서 배웠습니다.

<br/>

## 7. 저장소 구조

```
im-bank-n8n-agent/
├── n8n-workflows/
│   └── securityflow-full-auto-analysis.json   워크플로 내보내기 (노드 43개)
├── backend/
│   ├── server-sqlite.js                       1,017줄, 라우트 20개
│   └── data/secureflow.db                     26시간 구동 기록 12,458건
├── frontend/                                  React 19 (차트 라이브러리는 넣어만 두고 안 씀)
├── sf_backups/                                CSV 백업 15개
├── ecosystem.config.js                        PM2 3프로세스
└── deploy_secureflow.sh                       재배포
```

`logs` 테이블은 컬럼이 27개입니다. 운영하면서 필요한 게 생길 때마다 붙였고
`ALTER TABLE ... ADD COLUMN` 을 try 로 감싼 인라인 마이그레이션이 11개 들어 있습니다.
마이그레이션 도구를 안 쓰고 이렇게 한 건 기간이 짧아서였는데,
컬럼이 20개를 넘어가면서부터는 이 방식이 관리가 안 된다는 걸 느꼈습니다.

주요 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/logs` | 분석 결과 저장 (log_id upsert) |
| GET | `/api/logs` | 목록 조회 |
| PUT | `/api/logs/:id` | 갱신 |
| PATCH | `/api/logs/:id/learn-complete` | 학습 완료 표시 |
| POST | `/security-kb` | 지식베이스 등록 |
| GET | `/security-kb/examples` | 유사 사례 조회 |
| GET | `/events` | SSE 실시간 스트림 |
| GET | `/metrics` | 큐와 처리량 지표 |
| GET | `/kb/export`, `/kb/export-ndjson` | 내보내기 |

<br/>

## 8. 실행

```bash
# 백엔드
cd backend && npm ci && node server-sqlite.js
```

```bash
# 프런트
cd frontend && npm ci && npm start
```

```bash
# 전체 (n8n 5678 + backend 3001 + frontend 3000)
pm2 start ecosystem.config.js
```

n8n 화면에서 `n8n-workflows/securityflow-full-auto-analysis.json` 을 Import 하고
Upstage 와 Google Gemini 자격증명을 각각 등록하면 됩니다. 키는 저장소에 없습니다.

<br/>

## 9. 지금 상태와 한계

- 데이터가 전부 합성입니다. 실환경 로그의 분포는 이것과 다를 것입니다
- 워커가 하나라서 p99가 182초입니다. 소스별로 큐를 나누는 게 다음 과제입니다
- 유사 사례 조회가 텍스트 매칭입니다. 임베딩으로 바꾸면 더 잘 찾을 겁니다
- LLM 응답의 값 검증이 없습니다. 3건이 새어 나갔습니다
- 백엔드 테스트가 없습니다. CI는 `npm test --if-present` 라 사실상 통과만 하고 있습니다

<br/>

## 10. 팀과 역할

팀 AIM. 제가 맡은 부분입니다.

- n8n 파이프라인 설계와 구현 (마스킹, 선분류, LLM 체인, 학습 루프)
- Express 백엔드와 SQLite 스키마
- PM2 배포 구성과 재배포 스크립트
- 백업과 정리 자동화

발표 자료와 시연 대본은 팀에서 같이 만들었습니다.

<br/>

## 관련 문서

- [Notion Knowledge Hub](https://www.notion.so/My-Knowledge-Hub-27772d9f979f80569662de9c2e49399d?source=copy_link)
- 취약점 신고는 [SECURITY.md](SECURITY.md)

MIT License
