// ==========================================================
// 🧠 SecureFlow / im-bank-n8n-agent Backend Server (완성본)
// ==========================================================
// - n8n → 로그 분석 결과 수신 (POST /api/logs)
// - React Dashboard → 실시간 로그 표시 (SSE /events)
// - Security KB 관리 및 예시 조회 (/security-kb, /api/kb)
// - 학습 상태 반영 (PATCH /api/logs/:id/learn-complete)
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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "logs.json");
const KB_FILE = path.join(DATA_DIR, "kb.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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
let logs = loadJson(LOG_FILE, []); // [{ id: "LOG-...", ... }]
let logIndex = new Map(logs.map((l, i) => [l.id, i]));

let kbItems = loadJson(KB_FILE, []); // [{ id, risk, text, meta, ... }]

// 요약 정보 계산 유틸 (대시보드 & 디버그 공용)
function getSummary() {
  const total = logs.length;
  const high = logs.filter((l) => l.risk === "High").length;
  const learnQueue = logs.filter(
    (l) => l.ai_learn_enabled && !l.ai_learn_completed
  ).length;
  const learned = logs.filter((l) => l.ai_learn_completed).length;

  return {
    total,
    high,
    learnQueue,
    learned,
    kbCount: kbItems.length,
  };
}

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

// 🔂 15초마다 heartbeat 전송
setInterval(() => {
  const payload = JSON.stringify({
    type: "heartbeat",
    ts: new Date().toISOString(),
  });
  for (const res of clients) {
    res.write(`event: heartbeat\ndata: ${payload}\n\n`);
  }
}, 15000);

// ==========================================================
// 🧱 기본 라우트
// ==========================================================
app.get("/", (req, res) => {
  res.send("✅ im-bank-n8n-agent backend running (SSE enabled)");
});

// ==========================================================
// 🚀 [1] n8n → 로그 저장 (신규/갱신)
//     - n8n Data Table → HTTP Request(POST /api/logs)에서 호출
// ==========================================================
app.post("/api/logs", (req, res) => {
  const log = req.body || {};

  // n8n에서 id / log_id 둘 중 하나만 올 수도 있으니 보정
  if (!log.id && log.log_id) {
    log.id = log.log_id;
  }

  if (!log.id) {
    return res.status(400).json({ ok: false, error: "id가 없는 로그입니다." });
  }

  // 기본 플래그 디폴트 (undefined 방지)
  if (typeof log.ai_learn_enabled !== "boolean") {
    log.ai_learn_enabled = false;
  }
  if (typeof log.ai_learn_completed !== "boolean") {
    log.ai_learn_completed = false;
  }

  const idx = logIndex.get(log.id);

  if (idx !== undefined) {
    // 기존 로그 전체 갱신
    logs[idx] = {
      ...logs[idx],
      ...log,
      updatedAt: new Date().toISOString(),
    };
    console.log(
      `[LOG UPSERT] UPDATE ${log.id} | ${log.risk || "?"} | ${
        log.summary || ""
      }`
    );
  } else {
    // 새 로그 추가
    logs.push({
      ...log,
      createdAt: new Date().toISOString(),
    });
    logIndex.set(log.id, logs.length - 1);
    console.log(
      `[LOG UPSERT] INSERT ${log.id} | ${log.risk || "?"} | ${
        log.summary || ""
      }`
    );
  }

  saveJson(LOG_FILE, logs);

  // SSE 구독 중인 모든 클라이언트에 최신 로그 배열 전송
  broadcastLogs();

  return res.json({ ok: true, summary: getSummary() });
});

// ==========================================================
// 📜 [2] 로그 조회 / 일반 상태 업데이트 (프론트 + n8n 공용)
// ==========================================================
app.get("/api/logs", (req, res) => {
  res.json(logs);
});

app.get("/api/logs/:id", (req, res) => {
  const { id } = req.params;
  const idx = logIndex.get(id);

  if (idx === undefined) {
    return res.status(404).json({ ok: false, error: `Log ${id} not found` });
  }

  res.json(logs[idx]);
});

app.put("/api/logs/:id", (req, res) => {
  const { id } = req.params;
  const update = req.body || {};

  const idx = logIndex.get(id);
  if (idx === undefined) {
    return res.status(404).json({ ok: false, error: `Log ${id} not found` });
  }

  logs[idx] = {
    ...logs[idx],
    ...update,
    updatedAt: new Date().toISOString(),
  };

  saveJson(LOG_FILE, logs);
  broadcastLogs();

  console.log(`[LOG UPDATE] ${id} ←`, update);

  res.json({ ok: true, log: logs[idx], summary: getSummary() });
});

// ==========================================================
// 🎓 [2-1] 학습 상태 전용 업데이트 (학습 워커용)
//     - PATCH /api/logs/:id/learn-complete
// ==========================================================
app.patch("/api/logs/:id/learn-complete", (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  // URL과 body 중 뭘 보내든, 결국 URL 기준으로 맞춰줌
  const logId = id || body.id;

  const idx = logIndex.get(logId);
  if (idx === undefined) {
    return res
      .status(404)
      .json({ ok: false, error: `Log ${logId} not found (learn-complete)` });
  }

  const prev = logs[idx];

  const patch = {
    ai_learn_enabled:
      typeof body.ai_learn_enabled === "boolean"
        ? body.ai_learn_enabled
        : prev.ai_learn_enabled,
    ai_learn_completed:
      typeof body.ai_learn_completed === "boolean"
        ? body.ai_learn_completed
        : true,
    status: body.status || prev.status || "학습 완료",
    final_risk_for_learning:
      body.final_risk_for_learning || prev.final_risk_for_learning,
    updatedAt: new Date().toISOString(),
  };

  logs[idx] = {
    ...prev,
    ...patch,
  };

  saveJson(LOG_FILE, logs);
  broadcastLogs();

  console.log(
    `[LEARN COMPLETE] ${logId} : enabled=${logs[idx].ai_learn_enabled}, completed=${logs[idx].ai_learn_completed}`
  );

  res.json({ ok: true, log: logs[idx], summary: getSummary() });
});

// ==========================================================
// 🧠 [3] Security KB 학습 데이터 추가
// ==========================================================
function handleAddKb(req, res) {
  const item = req.body || {};
  if (!item.text) {
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

  res.json({ ok: true, item: kbItem });
}

app.post("/security-kb", handleAddKb);
app.post("/api/kb", handleAddKb);

// ==========================================================
// 📚 [3-1] KB 예시 조회 (유사 학습 사례)
// ==========================================================
function handleGetKbExamples(req, res) {
  const { category, risk, limit = 3 } = req.query;
  let filtered = kbItems;

  if (category) {
    filtered = filtered.filter(
      (k) =>
        k.category === category ||
        (k.meta && k.meta.incident_category === category)
    );
  }

  if (risk) {
    filtered = filtered.filter((k) => k.risk === risk);
  }

  filtered = filtered.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  res.json(filtered.slice(0, Number(limit) || 3));
}

app.get("/security-kb/examples", handleGetKbExamples);
app.get("/api/kb/examples", handleGetKbExamples);

// ==========================================================
// 📊 [4] 대시보드 요약 / 디버그
// ==========================================================
app.get("/api/summary", (req, res) => {
  res.json(getSummary());
});

// 전체 로그 / KB 간단 디버그
app.get("/debug/logs", (req, res) => {
  res.json({
    summary: getSummary(),
    count: logs.length,
    ids: logs.map((l) => l.id),
  });
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

// 🔍 학습 후보(Queue) 상세 확인용
app.get("/debug/learn-queue", (req, res) => {
  const queue = logs.filter(
    (l) => l.ai_learn_enabled && !l.ai_learn_completed
  );
  res.json({
    count: queue.length,
    items: queue.map((l) => ({
      id: l.id,
      log_id: l.log_id,
      risk: l.risk,
      status: l.status,
      ai_learn_enabled: l.ai_learn_enabled,
      ai_learn_completed: l.ai_learn_completed,
    })),
  });
});

// 개별 로그 디버그
app.get("/debug/logs/:id", (req, res) => {
  const { id } = req.params;
  const idx = logIndex.get(id);
  if (idx === undefined) {
    return res.status(404).json({ ok: false, error: `Log ${id} not found` });
  }
  res.json(logs[idx]);
});

// ==========================================================
// 🚦 서버 시작
// ==========================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SecureFlow backend listening on http://0.0.0.0:${PORT}`);
});
