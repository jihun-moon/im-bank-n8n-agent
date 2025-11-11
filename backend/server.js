// ==========================================================
// 🧠 SecureFlow / im-bank-n8n-agent Backend Server
// ==========================================================
// - n8n → 로그 분석 결과 수신 (POST /api/logs)
// - React Dashboard → 실시간 로그 표시 (SSE /events)
// - Security KB 관리 및 요약(/api/summary)
// - 💾 JSON 파일 기반 로컬 스토리지 (logs.json, kb.json)
// ==========================================================

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// ==========================================================
// 📁 데이터 디렉토리 설정
// ==========================================================
const DATA_DIR = path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "logs.json");
const KB_FILE = path.join(DATA_DIR, "kb.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ----------------------------------------------------------
// JSON 읽기/쓰기 유틸
// ----------------------------------------------------------
function saveJson(filePath, data) {
  fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
    if (err) console.error("[SAVE ERROR]", filePath, err);
  });
}

function loadJson(filePath, def = []) {
  if (!fs.existsSync(filePath)) return def;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("[LOAD ERROR]", filePath, e);
    return def;
  }
}

// ==========================================================
// 🧩 미들웨어
// ==========================================================
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ==========================================================
// 💾 메모리 캐시 (실시간 반영)
// ==========================================================
let logs = loadJson(LOG_FILE, []); // [{ id, risk, ... }]
let logIndex = new Map(logs.map((l, i) => [l.id, i]));
let kbItems = loadJson(KB_FILE, []);

// ==========================================================
// 🔥 SSE (Server-Sent Events) – 실시간 스트리밍
// ==========================================================
let clients = [];

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.push(res);
  console.log(`[SSE] 클라이언트 연결됨 (${clients.length}명)`);

  // 연결 종료 시 클라이언트 제거
  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
    console.log(`[SSE] 연결 종료 (남은 ${clients.length}명)`);
  });
});

// 모든 클라이언트에 로그 전송
function broadcastLogs() {
  const payload = JSON.stringify(logs);
  for (const res of clients) {
    res.write(`data: ${payload}\n\n`);
  }
}

// ==========================================================
// 🧱 기본 라우트
// ==========================================================
app.get("/", (req, res) => {
  res.send("✅ im-bank-n8n-agent backend running (SSE enabled)");
});

// ==========================================================
// 🚀 [1] n8n → 로그 저장 (신규/갱신)  ★ API는 n8n, 실시간은 여기서 담당
// ==========================================================
app.post("/api/logs", (req, res) => {
  const log = req.body;
  if (!log || !log.id) {
    return res.status(400).json({ ok: false, error: "id가 없는 로그입니다." });
  }

  const idx = logIndex.get(log.id);
  if (idx !== undefined) {
    logs[idx] = log;
  } else {
    logs.push(log);
    logIndex.set(log.id, logs.length - 1);
  }

  saveJson(LOG_FILE, logs);
  console.log(
    `[NEW LOG] ${log.id} | ${log.risk || "?"} | ${log.summary || ""}`
  );

  // SSE 전송
  broadcastLogs();
  return res.json({ ok: true });
});

// ==========================================================
// 📜 [2] 프론트 → 로그 전체 조회 / 상태 업데이트
// ==========================================================
// 👉 이 부분은 이제 n8n Webhook에서 처리하므로 서버에서는 제거.
//    (React는 /webhook/api/logs, /webhook/api/logs/:id 로 요청)
// ----------------------------------------------------------
// app.get("/api/logs", (req, res) => { ... });
// app.put("/api/logs/:id", (req, res) => { ... });

// ==========================================================
// 🧠 [3] Security KB 학습 데이터 추가
// ==========================================================
app.post("/security-kb", (req, res) => {
  const item = req.body;
  if (!item || !item.text) {
    return res.status(400).json({ ok: false, error: "text가 없습니다." });
  }

  const kbItem = {
    id: kbItems.length + 1,
    createdAt: new Date().toISOString(),
    ...item,
  };

  kbItems.push(kbItem);
  saveJson(KB_FILE, kbItems);

  console.log(
    `[KB ADD] id=${kbItem.id}, risk=${kbItem.risk || "?"}, log=${
      kbItem.meta?.log_id || "N/A"
    }`
  );
  res.json({ ok: true });
});

// ==========================================================
// 📚 [3-1] KB 예시 조회
// ==========================================================
app.get("/security-kb/examples", (req, res) => {
  const { category, risk, limit = 3 } = req.query;
  let filtered = kbItems;

  if (category) {
    filtered = filtered.filter(
      (k) =>
        k.category === category ||
        (k.meta && k.meta.incident_category === category)
    );
  }

  if (risk) filtered = filtered.filter((k) => k.risk === risk);

  filtered = filtered.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  res.json(filtered.slice(0, Number(limit) || 3));
});

// ==========================================================
// 📊 [4] 대시보드 요약 / 디버그
//     (로그 원본은 n8n에도 있지만, SSE용 메모리 캐시 기반으로 계산)
// ==========================================================
app.get("/api/summary", (req, res) => {
  const total = logs.length;
  const high = logs.filter((l) => l.risk === "High").length;
  const learnQueue = logs.filter(
    (l) => l.ai_learn_enabled && !l.ai_learn_completed
  ).length;
  const learned = logs.filter((l) => l.ai_learn_completed).length;

  res.json({
    total,
    high,
    learnQueue,
    learned,
    kbCount: kbItems.length,
  });
});

app.get("/debug/logs", (req, res) => {
  res.json({ count: logs.length, ids: logs.map((l) => l.id) });
});

app.get("/debug/kb", (req, res) => {
  res.json({
    count: kbItems.length,
    items: kbItems.map((k) => ({
      id: k.id,
      risk: k.risk,
      createdAt: k.createdAt,
      log_id: k.meta?.log_id,
    })),
  });
});

// ==========================================================
// 🚦 서버 시작
// ==========================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `✅ SecureFlow backend listening on http://0.0.0.0:${PORT}`
  );
});
