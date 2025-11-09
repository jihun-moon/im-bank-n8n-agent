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
