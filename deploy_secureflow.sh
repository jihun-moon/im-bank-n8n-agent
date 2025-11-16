#!/bin/bash

# 에러 시 중단
set -e

echo "== SecureFlow 전체 재배포 시작 =="

PROJECT_ROOT="/root/im-bank-n8n-agent"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo "[1] PM2 프로세스 정리 (secureflow-*)"
pm2 delete secureflow-backend  >/dev/null 2>&1 || true
pm2 delete secureflow-frontend >/dev/null 2>&1 || true
pm2 delete secureflow-n8n      >/dev/null 2>&1 || true

# ❌ 더 이상 로그/KB 초기화 안 함
# echo "[2] 로그/KB 데이터 파일 초기화"
# mkdir -p "$BACKEND_DIR/data"
# rm -f "$BACKEND_DIR/data/logs.json" "$BACKEND_DIR/data/kb.json"

echo "[2] 백엔드 의존성 설치"
cd "$BACKEND_DIR"
npm install --production

echo "[3] 프론트엔드 의존성 설치 및 빌드"
cd "$FRONTEND_DIR"
npm install
npm run build

echo "[4] PM2로 백엔드/프론트/n8n 실행 (ecosystem.config.js)"
cd "$PROJECT_ROOT"
pm2 start ecosystem.config.js

echo "[5] PM2 프로세스 리스트 저장"
pm2 save

echo
echo "== 배포 완료 =="
echo " Backend : http://211.188.58.62:3001"
echo " Frontend: http://211.188.58.62:3000"
echo " n8n     : http://211.188.58.62:5678"
echo
pm2 status
