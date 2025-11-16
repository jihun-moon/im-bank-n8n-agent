# 🧠 AIM SECURITYFLOW  
## _Aim the Security of Finance_  
### **AI 기반 금융 보안 로그 자율 분석·학습 파이프라인**

**2025 AI Agent 해커톤 출품작 – AIM 팀(AI + IM)**  
SecureFlow는 금융·기업 보안 환경에서 발생하는 로그를  
**AI가 스스로 수집 → 분석 → 판단 → 학습 → 대응하는**  
AI 보안 자동화 파이프라인입니다.

---

# 🚀 SecureFlow Overview

SecureFlow는 아래 기능을 전자동으로 수행하는 **PII 유출 탐지 및 AI 보안 분석 시스템**입니다.

- 정규식 기반 PII 탐지 및 완전 마스킹
- Upstage Solar Pro 2 / Gemini 기반 위험도·카테고리 분석
- n8n 기반 AI 자동화 파이프라인
- Express 기반 백엔드 API + JSON 데이터 저장소
- React 실시간 대시보드 (SSE 실시간 스트림)
- Security KB 자동 학습 및 패턴 고도화
- High Risk 자동 경보(Slack/Email)

---

# 🧩 시스템 아키텍처

```

외부 시스템 → n8n → Upstage Solar / Gemini → Express Backend
→ Security KB (kb.json) → React Dashboard(SSE)

```

---

# 📦 프로젝트 구조

```

im-bank-n8n-agent/
├── backend/                # Express API 서버
│   ├── server.js           # 핵심 로직
│   └── data/
│       ├── logs.json       # 보안 로그 저장소
│       └── kb.json         # 학습 지식베이스
│
├── frontend/               # React 실시간 대시보드
│   ├── src/App.js
│   ├── src/App.css
│
├── n8n-workflows/          # 전체 자동화 파이프라인 (.json)
└── README.md

````

---

# ⚙️ 핵심 기능 정리

| 기능 | 설명 |
|------|------|
| 🔍 **PII 탐지 및 마스킹** | 이메일·전화·주민번호·카드번호 탐지 후 `[EMAIL]`, `[PHONE]` 등으로 마스킹 |
| 🧠 **AI 위험도 분석** | Solar Pro 2 / Gemini로 High·Medium·Safe 분류 |
| 🔄 **AI 엔드-투-엔드 자동화 파이프라인** | Webhook → 분석 → 저장 → 학습 → 상태 자동 전파 |
| 📚 **Security KB 자동 학습** | 마스킹된 데이터만 학습, 개인정보 절대 저장 없음 |
| 📊 **React 실시간 대시보드** | SSE 기반 실시간 로그 Feed |
| 🚨 **High Risk 경보** | Slack 또는 Email 자동 발송 |
| 🧼 **12시간 주기 로그 백업** | Sanitizer → XLSX 변환 → 메일 발송 / 내부 저장 |

---

# 🔗 주요 API 엔드포인트

| Method | Endpoint | 설명 |
|--------|-----------|------|
| `POST` | `/api/logs` | n8n이 보낸 분석 로그 저장 |
| `GET` | `/api/logs` | 모든 로그 조회 |
| `PUT` | `/api/logs/:id` | 학습 완료 상태 업데이트 |
| `POST` | `/security-kb` | 보안 KB 저장 |
| `GET` | `/security-kb/examples` | 유사 사례 조회 |
| `GET` | `/events` | SSE 실시간 스트림 |

---

# 🧰 기술 스택

| 영역 | 사용 기술 |
|------|------------|
| Backend | Node.js (Express), SSE, 파일 기반 JSON DB |
| Frontend | React, TailwindCSS, Chart.js |
| AI 분석 | Upstage Solar Pro 2, Gemini 1.5 Flash |
| Automation | n8n Workflow Engine |
| Infra | Naver Cloud, Docker |
| Data Store | logs.json, kb.json |

---

# 🧩 전체 파이프라인 흐름

```mermaid
flowchart TD
    A[Webhook 수집] --> B[PII 탐지 및 마스킹]
    B --> C[AI 위험도 분석]
    C --> D[백엔드 저장]
    D --> E{High Risk?}
    E -->|Yes| F[Slack/Email 경보]
    C --> G{학습 대상?}
    G -->|Yes| H[학습 텍스트 생성]
    H --> I[Security KB 저장]
    I --> J[로그 상태 업데이트]
    D --> K[React Dashboard SSE 반영]
````

---

# 🧬 ERD

```mermaid
erDiagram
    LOGS {
        string id PK
        string redactedLog
        string summary
        string risk_l1
        string risk_l2
        string bot_risk_final
        boolean pii_regex_found
        string[] pii_regex_types
        boolean ai_learn_enabled
        boolean ai_learn_completed
        string incident_category
        datetime occurred_at
    }

    KB {
        string id PK
        string category
        string risk
        string text
        json meta
        datetime createdAt
    }

    LOGS ||--|{ KB : "학습 기반"
```

---

# 🧼 12시간 자동 백업 (Sanitized Backup)

워크플로:

1. 조건(IF): 최근 12시간 범위 로그 조회
2. Sanitizer: redactedLog 기반 PII 제거
3. Convert to File: XLSX 변환
4. Send Email: 암호화 TLS SMTP로 관리자에게 전송
5. Read/Write Files: 내부 `/sf_backups/` 저장

✔ **원본 PII 절대 백업하지 않음(정책적 리스크 제거)**
✔ **메일로 나가는 파일도 완전 마스킹됨**

---

# 💻 실행 방법

```bash
# Backend
cd backend
npm install
node server.js

# Frontend
cd ../frontend
npm install
npm run dev
```

* Dashboard: `http://<SERVER_IP>:5173`
* Backend API: `http://<SERVER_IP>:3001`

---

# 🧠 심사위원 Q&A 대비 포인트

### 🔹 Q: “원본 개인정보를 학습시키나요?”

**A: 절대 NO.**
정규식 + 마스킹 → redactedLog만 사용.
PII 포함 로그는 학습 대상에서 즉시 제외됩니다.

### 🔹 Q: “실제 금융 보안 환경에 적용 가능한가요?”

네.

* 비동기 Queue → Worker 구조
* LLM 기반 동적 판단
* 자동화 파이프라인(n8n)
* 실시간 스트림(SSE)
  으로 실제 SOC 구조와 유사합니다.

### 🔹 Q: “학습은 어떻게 이뤄지나요?”

* 분석된 로그에서 **PII 제거된 요약 텍스트를 생성**
* Security KB(kb.json)에 저장
* 향후 유사 로그 판단 시 벡터 검색 기반 비교

### 🔹 Q: “어떤 가치를 제공하나요?”

* 보안팀의 반복 작업 제거
* AI의 지속적 학습으로 탐지 정확도 증가
* 실시간 시각화 + 자동 경보로 대응 시간 단축
* 완전 로우코드 기반 운영 비용 절감

---

# 👥 팀 AIM 소개

| 항목  | 내용                                  |
| --- | ----------------------------------- |
| 팀명  | AIM (AI + IM)                       |
| 슬로건 | *Aim the Security of Finance*       |
| 역할  | Backend / n8n / AI / Frontend 통합 개발 |
| 목표  | “AI가 보안로그를 읽고, 이해하고, 학습한다.”         |

---

# © 2025 AIM SecurityFlow Team

*Aim the Security of Finance.*
