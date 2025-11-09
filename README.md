# 🧠 im-bank-n8n-agent

**AI 기반 개인정보 유출 탐지 및 자동 대응 시스템 (SecureFlow Prototype)**  
2025 AI Agent 해커톤 출품작 — **로우코드 워크플로 툴 _n8n_** 과  
**AI 모델 Upstage Solar Pro 2**를 결합해  
IM뱅크 내부 보안 로그에서 발생하는  
**PII 유출, 데이터 외부 전송, 계정 악용 사고**를 자동으로 탐지하고 분류하며,  
AI가 실시간으로 **학습/조치 상태를 관리하는 보안 오토메이션 파이프라인**입니다.

---

## 📦 프로젝트 구조

```bash
im-bank-n8n-agent/
├── backend/        # Express 기반 백엔드 서버 (API, SSE, JSON 로그 관리)
│   ├── server.js   # 핵심 서버 로직 (로그 저장, KB 동기화, 학습 상태 관리)
│   ├── data/       # 로그 및 지식베이스 저장소 (logs.json, kb.json)
│   └── ...
│
├── frontend/       # React 기반 실시간 보안 대시보드
│   ├── src/        # UI 및 통계 시각화 코드
│   ├── public/
│   └── ...
│
├── .github/workflows/  # 자동 배포 / CI 설정
├── README.md
└── .gitignore
````

---

## ⚙️ 주요 기능

| 기능 영역                            | 설명                                            |
| -------------------------------- | --------------------------------------------- |
| 🔍 **PII / 유출 탐지**               | 정규식 + AI 분석 결합으로 이메일, 전화번호, RRN, 카드정보 등 자동 탐지 |
| 🧩 **n8n AI Agent**              | “학습 후보 / 유사 사례 검색 / KB 동기화” 요청을 자연어로 처리       |
| 🧠 **Security KB (보안 지식베이스)**    | 과거 인시던트를 저장하고 유사 패턴을 검색                       |
| 🔄 **학습 상태 자동 동기화**              | KB에 등록된 로그만 ‘학습 완료’ 상태로 업데이트                  |
| 📊 **React 대시보드**                | 전체 로그, 위험도 통계, PII 탐지 현황을 실시간으로 표시 (SSE 기반)   |
| ☁️ **AI 분석 백엔드 (Upstage Solar)** | 로그 요약, 위험도 판단, PII 감지 및 유사 사례 검색에 활용          |

---

## 🔗 주요 엔드포인트 (Backend API)

| Method | Endpoint                        | 설명                            |
| ------ | ------------------------------- | ----------------------------- |
| `POST` | `/api/logs`                     | n8n → 로그 수신 및 저장              |
| `GET`  | `/api/logs`                     | 전체 로그 조회                      |
| `POST` | `/api/logs/sync-learning-state` | 학습 상태 동기화                     |
| `GET`  | `/security-kb/examples`         | 보안 사례 조회 (category / risk 기반) |
| `POST` | `/security-kb`                  | 보안 지식베이스 항목 추가                |

---

## 🧰 기술 스택

| 구분                  | 사용 기술                                |
| ------------------- | ------------------------------------ |
| **Backend**         | Node.js (Express), JSON Storage, SSE |
| **Frontend**        | React + Tailwind, Chart.js           |
| **Automation / AI** | n8n, Upstage Solar Pro 2             |
| **Infra**           | Naver Cloud, Docker (포트 3001 / 5173) |

---

## 🧑‍💻 실행 방법

```bash
# 1. 백엔드 실행
cd backend
npm install
node server.js

# 2. 프론트엔드 실행
cd ../frontend
npm install
npm run dev
```

대시보드 접속: [http://localhost:5173](http://localhost:5173)
API 서버: [http://localhost:3001](http://localhost:3001)

---

## 🚀 팀 및 목표

**팀명:** IM-BANK AI SECURITY TEAM

**핵심 목표:**

* 내부 보안 로그에서 PII 유출 및 계정 악용을 자동 탐지
* AI 기반 위험도 판단 → 학습 → 조치 루프 자동화
* 사람이 직접 검토하지 않아도 “탐지 → 분석 → 학습 완료” 순환 시스템 구현

---

© 2025 IM-BANK AI Security Team. All Rights Reserved.

```
