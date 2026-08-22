// ==========================================================
// 🧠 SecureFlow / im-bank-n8n-agent Backend Server (SQLite + Metrics)
// ==========================================================
// - n8n → 로그 분석 결과 수신 (POST /api/logs)
// - React Dashboard → 실시간 로그 표시 (SSE /events)
// - Security KB 관리 및 예시 조회 (/security-kb, /api/kb, /security-kb/examples)
// - 학습 상태 반영 (PATCH /api/logs/:id/learn-complete)
// - 💾 로그: SQLite(secureflow.db / logs 테이블)
// - 💾 KB  : SQLite(secureflow.db / kb_items 테이블)
// - 📤 KB Export: /kb/export, /kb/export-ndjson (전체 재학습용)
// - 📈 운영 지표: /metrics (최근 N분 처리량, Garbage 비율, 평균 처리시간 등)
// ==========================================================

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3001;

// ==========================================================
// 📁 데이터 디렉토리 / 파일 설정
// ==========================================================
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "secureflow.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==========================================================
// 로그 출력용 문자열 정리
// ==========================================================
// 외부에서 받은 값을 그대로 console 에 찍으면 개행을 섞어 없는 로그 줄을
// 만들어 넣거나 터미널 제어문자를 흘려보낼 수 있다. 여긴 보안 로그를
// 모으는 자리라 로그가 위조되면 조사 기록 자체를 못 믿게 된다.
// 개행과 제어문자를 지우고 길이도 잘라서 한 줄로만 남긴다.
const LOG_MAX_LEN = 500;

function safeLog(value) {
  let text;

  if (value === null || value === undefined) {
    text = String(value);
  } else if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch (e) {
      text = "[직렬화 불가]";
    }
  } else {
    text = String(value);
  }

  if (typeof text !== "string") text = "";

  return text
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .slice(0, LOG_MAX_LEN);
}

// ==========================================================
// 💾 SQLite 초기화 (logs / kb_items 테이블)
// ==========================================================
const db = new Database(DB_FILE);

// ----------------------------------------------------------
// logs 테이블 (운영 모니터링 + 위험도/권고 텍스트 컬럼 포함)
// ----------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id TEXT UNIQUE,
    source TEXT,
    system TEXT,
    env TEXT,

    risk TEXT,
    incident_category TEXT,
    title TEXT,
    text TEXT,
    summary TEXT,
    pii_regex_summary TEXT,
    log_detail TEXT,
    redacted_log TEXT,

    risk_reason_l1 TEXT,
    risk_reason_l2 TEXT,
    recommendation_l1 TEXT,
    recommendation_l2 TEXT,

    pii_regex_found INTEGER,
    pii_regex_types TEXT,

    ai_learn_enabled INTEGER,
    ai_learn_completed INTEGER,
    final_risk_for_learning TEXT,

    meta_json TEXT,

    processing_time_ms INTEGER,
    is_garbage INTEGER,
    garbage_reason TEXT,

    created_at TEXT,
    updated_at TEXT
  );
`);

// 🔧 기존 DB 마이그레이션(있으면 무시되고 통과)
try { db.exec(`ALTER TABLE logs ADD COLUMN processing_time_ms INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN is_garbage INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN garbage_reason TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN summary TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN pii_regex_summary TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN log_detail TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN redacted_log TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN risk_reason_l1 TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN risk_reason_l2 TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN recommendation_l1 TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE logs ADD COLUMN recommendation_l2 TEXT`); } catch (e) {}

// ----------------------------------------------------------
// kb_items 테이블
// ----------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS kb_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id TEXT,
    risk TEXT,
    incident_category TEXT,
    source TEXT,
    title TEXT,
    text TEXT,
    notes TEXT,
    meta_json TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`);

// ----------------------------------------------------------
// Prepared Statements (logs)
// ----------------------------------------------------------
const stmtUpsertLog = db.prepare(`
  INSERT INTO logs (
    log_id, source, system, env,
    risk, incident_category, title, text,
    summary, pii_regex_summary, log_detail, redacted_log,
    risk_reason_l1, risk_reason_l2, recommendation_l1, recommendation_l2,
    pii_regex_found, pii_regex_types,
    ai_learn_enabled, ai_learn_completed, final_risk_for_learning,
    meta_json,
    processing_time_ms, is_garbage, garbage_reason,
    created_at, updated_at
  ) VALUES (
    $log_id, $source, $system, $env,
    $risk, $incident_category, $title, $text,
    $summary, $pii_regex_summary, $log_detail, $redacted_log,
    $risk_reason_l1, $risk_reason_l2, $recommendation_l1, $recommendation_l2,
    $pii_regex_found, $pii_regex_types,
    $ai_learn_enabled, $ai_learn_completed, $final_risk_for_learning,
    $meta_json,
    $processing_time_ms, $is_garbage, $garbage_reason,
    $created_at, $updated_at
  )
  ON CONFLICT(log_id) DO UPDATE SET
    source                  = excluded.source,
    system                  = excluded.system,
    env                     = excluded.env,
    risk                    = excluded.risk,
    incident_category       = excluded.incident_category,
    title                   = excluded.title,
    text                    = excluded.text,
    summary                 = excluded.summary,
    pii_regex_summary       = excluded.pii_regex_summary,
    log_detail              = excluded.log_detail,
    redacted_log            = excluded.redacted_log,
    risk_reason_l1          = excluded.risk_reason_l1,
    risk_reason_l2          = excluded.risk_reason_l2,
    recommendation_l1       = excluded.recommendation_l1,
    recommendation_l2       = excluded.recommendation_l2,
    pii_regex_found         = excluded.pii_regex_found,
    pii_regex_types         = excluded.pii_regex_types,
    ai_learn_enabled        = excluded.ai_learn_enabled,
    ai_learn_completed      = excluded.ai_learn_completed,
    final_risk_for_learning = excluded.final_risk_for_learning,
    meta_json               = excluded.meta_json,
    processing_time_ms      = excluded.processing_time_ms,
    is_garbage              = excluded.is_garbage,
    garbage_reason          = excluded.garbage_reason,
    updated_at              = excluded.updated_at;
`);

const stmtSelectLogById = db.prepare(
  "SELECT * FROM logs WHERE log_id = ?"
);

const stmtSelectAllLogs = db.prepare(
  "SELECT * FROM logs ORDER BY datetime(created_at) DESC LIMIT ?"
);

const stmtSelectLearnQueue = db.prepare(`
  SELECT *
  FROM logs
  WHERE ai_learn_enabled = 1
    AND ai_learn_completed = 0
  ORDER BY datetime(created_at) DESC
`);

// ----------------------------------------------------------
// Prepared Statements (kb_items)
// ----------------------------------------------------------
const stmtInsertKb = db.prepare(`
  INSERT INTO kb_items (
    log_id,
    risk,
    incident_category,
    source,
    title,
    text,
    notes,
    meta_json,
    created_at,
    updated_at
  ) VALUES (
    @log_id,
    @risk,
    @incident_category,
    @source,
    @title,
    @text,
    @notes,
    @meta_json,
    @created_at,
    @updated_at
  );
`);

const stmtSelectKbAll = db.prepare(`
  SELECT *
  FROM kb_items
  ORDER BY datetime(created_at) DESC
`);

const stmtSelectKbExamples = db.prepare(`
  SELECT *
  FROM kb_items
  WHERE (@category IS NULL OR incident_category = @category)
    AND (@risk     IS NULL OR risk            = @risk)
  ORDER BY datetime(created_at) DESC
  LIMIT @limit
`);

const stmtCountKb = db.prepare(`
  SELECT COUNT(*) AS c FROM kb_items
`);

// ==========================================================
// 🔸 런타임 메트릭 오버라이드 (Raw Queue 등 n8n에서 push 하는 값)
// ==========================================================
const runtimeMetricsOverride = {
  queuePending: null, // n8n에서 /metrics/raw-queue 로 push 하면 여기 저장
};

// ==========================================================
// 🧩 미들웨어
// ==========================================================
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// 디버그 조회는 logs / kb_items 를 통째로 훑어서 한 번에 부담이 크다.
// 호출 횟수를 IP 단위로 제한한다. n8n 수집(POST /api/logs)과
// 대시보드 SSE(/events)에는 걸지 않아 기존 흐름은 그대로 돈다.
const debugLimiter = rateLimit({
  windowMs: 60 * 1000, // 1분
  limit: 60, // IP 당 1분에 60회
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "요청이 너무 잦습니다. 잠시 후 다시 시도하세요." },
});

// ==========================================================
// 📊 요약 정보 계산 유틸 (대시보드 & 디버그 공용)
// ==========================================================
function getSummary() {
  const total = db.prepare("SELECT COUNT(*) AS c FROM logs").get().c;

  const high = db
    .prepare("SELECT COUNT(*) AS c FROM logs WHERE risk = 'High'")
    .get().c;

  const learnQueue = db
    .prepare(
      "SELECT COUNT(*) AS c FROM logs WHERE ai_learn_enabled = 1 AND ai_learn_completed = 0"
    )
    .get().c;

  const learned = db
    .prepare(
      "SELECT COUNT(*) AS c FROM logs WHERE ai_learn_completed = 1"
    )
    .get().c;

  const kbCount = stmtCountKb.get().c;

  const piiCases = db
    .prepare(
      "SELECT COUNT(*) AS c FROM logs WHERE pii_regex_found = 1"
    )
    .get().c;

  const exfilCount = db
    .prepare(
      "SELECT COUNT(*) AS c FROM logs WHERE incident_category = 'exfiltration'"
    )
    .get().c;

  const credCount = db
    .prepare(
      "SELECT COUNT(*) AS c FROM logs WHERE incident_category = 'credential_abuse'"
    )
    .get().c;

  const misconfCount = db
    .prepare(
      "SELECT COUNT(*) AS c FROM logs WHERE incident_category = 'misconfiguration'"
    )
    .get().c;

  return {
    total,
    high,
    learnQueue,
    learned,
    kbCount,
    piiCases,
    exfilCount,
    credCount,
    misconfCount,
  };
}

// 🔹 운영 지표 계산 함수
function getMetrics(windowMinutes = 5) {
  const now = Date.now();
  const sinceIso = new Date(
    now - windowMinutes * 60 * 1000
  ).toISOString();

  const totalLast = db
    .prepare(
      `SELECT COUNT(*) AS c 
       FROM logs 
       WHERE created_at >= @since`
    )
    .get({ since: sinceIso }).c;

  const highLast = db
    .prepare(
      `SELECT COUNT(*) AS c 
       FROM logs 
       WHERE created_at >= @since AND risk = 'High'`
    )
    .get({ since: sinceIso }).c;

  const garbageCount = db
    .prepare(
      `SELECT COUNT(*) AS c 
       FROM logs 
       WHERE created_at >= @since 
         AND (is_garbage = 1 OR garbage_reason IS NOT NULL)`
    )
    .get({ since: sinceIso }).c;

  const avgProcessingRow = db
    .prepare(
      `SELECT AVG(processing_time_ms) AS avgMs
       FROM logs
       WHERE created_at >= @since 
         AND processing_time_ms IS NOT NULL`
    )
    .get({ since: sinceIso });

  const avgProcessingMs = avgProcessingRow?.avgMs
    ? Math.round(avgProcessingRow.avgMs)
    : 0;

  // 🔹 Queue 대기 건수
  //  1순위: n8n이 /metrics/raw-queue 로 직접 push 한 값 사용
  //  2순위: fallback으로 DB 기반 추정(risk가 아직 비어있는 로그)
  let queuePending;
  if (typeof runtimeMetricsOverride.queuePending === "number") {
    queuePending = runtimeMetricsOverride.queuePending;
  } else {
    queuePending = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM logs
         WHERE risk IS NULL OR risk = ''`
      )
      .get().c;
  }

  const learnedLast = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM kb_items
       WHERE created_at >= @since`
    )
    .get({ since: sinceIso }).c;

  return {
    windowMinutes,
    totalLast,
    highLast,
    queuePending,
    garbageCount,
    avgProcessingMs,
    learnedLast,
  };
}

// 🔹 /metrics 엔드포인트
app.get("/metrics", (req, res) => {
  try {
    const windowMinutes = Math.max(
      1,
      Math.min(60, parseInt(req.query.windowMinutes, 10) || 5)
    );
    const metrics = getMetrics(windowMinutes);
    res.json(metrics);
  } catch (err) {
    console.error("GET /metrics error", err);
    res.status(500).json({ error: "failed to load metrics" });
  }
});

// 🔹 Raw Queue 대기 건수 업데이트 (n8n에서 push)
//     POST /metrics/raw-queue  { "queuePending": 12 }
app.post("/metrics/raw-queue", (req, res) => {
  try {
    const body = req.body || {};
    const n = Number(body.queuePending);

    if (!Number.isFinite(n) || n < 0) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid queuePending" });
    }

    runtimeMetricsOverride.queuePending = n;
    console.log(`[METRICS] raw queue pending updated -> ${n}`);

    res.json({ ok: true, queuePending: n });
  } catch (err) {
    console.error("POST /metrics/raw-queue error", err);
    res
      .status(500)
      .json({ ok: false, error: "failed to update raw queue" });
  }
});

// ==========================================================
// 🔥 SSE (Server-Sent Events) – 실시간 스트리밍
// ==========================================================
const SSE_CACHE_LIMIT = 500;
let logsCache = [];

function reloadLogsCache() {
  logsCache = stmtSelectAllLogs.all(SSE_CACHE_LIMIT);
}

reloadLogsCache();

let clients = [];

function broadcast(eventObj) {
  const payload = JSON.stringify(eventObj);
  for (const res of clients) {
    res.write(`data: ${payload}\n\n`);
  }
}

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.push(res);
  console.log(`[SSE] 클라이언트 연결됨 (${clients.length}명)`);

  // 접속 직후 최근 로그 리스트 한 번 내려주기
  const initialPayload = {
    type: "logs",
    payload: logsCache,
  };
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
    console.log(`[SSE] 연결 종료 (남은 ${clients.length}명)`);
  });
});

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
  res.send("✅ im-bank-n8n-agent backend (SQLite + Metrics) running");
});

// ==========================================================
// 🚀 [1] n8n → 로그 저장 (신규/갱신)
// ==========================================================
app.post("/api/logs", (req, res) => {
  const log = req.body || {};
  const nowIso = new Date().toISOString();

  const row = {
    // id는 자동 증가라 안 씀
    log_id: log.log_id || log.id || null,
    source: log.source || log.system || null,
    system: log.system || null,
    env: log.env || "lab",

    risk:
      log.bot_risk_final ||
      log.risk_l2 ||
      log.risk_l1 ||
      log.risk ||
      "Safe",

    incident_category:
      log.incident_category ||
      log.incident_category_l2 ||
      log.incident_category_l1 ||
      "monitoring",

    title: log.title || log.summary || null,

    // text: 기본 요약/PII 요약/마스킹 로그 중 하나
    text:
      log.text ||
      log.summary ||
      log.pii_regex_summary ||
      log.redactedLog ||
      log.log_detail ||
      log.Log_Detail ||
      null,

    summary: log.summary || null,
    pii_regex_summary: log.pii_regex_summary || null,
    log_detail: log.Log_Detail || log.log_detail || null,
    redacted_log: log.redactedLog || log.redacted_log || null,

    // 🔥 위험도 판단 이유 / 추천 대응 저장
    risk_reason_l1:
      log.risk_reason_l1 ||
      log.risk_reason_1st ||
      null,
    risk_reason_l2: log.risk_reason_l2 || null,
    recommendation_l1:
      log.recommendation_l1 ||
      log.recommendation_1st ||
      log.recommendation ||
      null,
    recommendation_l2: log.recommendation_l2 || null,

    pii_regex_found: log.pii_regex_found ? 1 : 0,
    pii_regex_types: Array.isArray(log.pii_regex_types)
      ? log.pii_regex_types.join(",")
      : log.pii_regex_types || null,

    ai_learn_enabled: log.ai_learn_enabled ? 1 : 0,
    ai_learn_completed: log.ai_learn_completed ? 1 : 0,
    final_risk_for_learning: log.final_risk_for_learning || null,

    meta_json: JSON.stringify(log.meta || {}),

    processing_time_ms:
      typeof log.processing_time_ms === "number"
        ? log.processing_time_ms
        : null,

    is_garbage: log.is_garbage ? 1 : 0,
    garbage_reason: log.garbage_reason || null,

    created_at: log.created_at || nowIso,
    updated_at: nowIso,
  };

  if (!row.log_id) {
    row.log_id = `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  stmtUpsertLog.run({
    log_id: row.log_id,
    source: row.source,
    system: row.system,
    env: row.env,
    risk: row.risk,
    incident_category: row.incident_category,
    title: row.title,
    text: row.text,
    summary: row.summary,
    pii_regex_summary: row.pii_regex_summary,
    log_detail: row.log_detail,
    redacted_log: row.redacted_log,
    risk_reason_l1: row.risk_reason_l1,
    risk_reason_l2: row.risk_reason_l2,
    recommendation_l1: row.recommendation_l1,
    recommendation_l2: row.recommendation_l2,
    pii_regex_found: row.pii_regex_found,
    pii_regex_types: row.pii_regex_types,
    ai_learn_enabled: row.ai_learn_enabled,
    ai_learn_completed: row.ai_learn_completed,
    final_risk_for_learning: row.final_risk_for_learning,
    meta_json: row.meta_json,
    processing_time_ms: row.processing_time_ms,
    is_garbage: row.is_garbage,
    garbage_reason: row.garbage_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });

  const saved = stmtSelectLogById.get(row.log_id);

  // 캐시 갱신 (중복 log_id 제거 후 상단에 추가)
  if (saved) {
    logsCache = [
      saved,
      ...logsCache.filter((l) => l.log_id !== saved.log_id),
    ].slice(0, SSE_CACHE_LIMIT);

    broadcast({ type: "log", payload: saved });
  }

  // CodeQL 은 safeLog 안의 치환을 새니타이저로 인정하지 않는다.
  // 로그로 나가기 직전에 개행을 한 번 더 편다.
  const upsertId = safeLog(row.log_id).replace(/\n/g, " ").replace(/\r/g, " ");
  const upsertRisk = safeLog(row.risk).replace(/\n/g, " ").replace(/\r/g, " ");
  const upsertTitle = safeLog(row.title || "").replace(/\n/g, " ").replace(/\r/g, " ");
  console.log(`[LOG UPSERT] ${upsertId} | ${upsertRisk} | ${upsertTitle}`);

  return res.json({ ok: true, log: saved, summary: getSummary() });
});

// ==========================================================
// 📜 [2] 로그 조회 / 일반 상태 업데이트 (프론트 + n8n 공용)
// ==========================================================
app.get("/api/logs", (req, res) => {
  const limit = Number(req.query.limit) || 500;
  const rows = stmtSelectAllLogs.all(limit);
  res.json(rows);
});

app.get("/api/logs/:id", (req, res) => {
  const { id } = req.params;
  const row = stmtSelectLogById.get(id);

  if (!row) {
    return res.status(404).json({ ok: false, error: `Log ${id} not found` });
  }

  res.json(row);
});

app.put("/api/logs/:id", (req, res) => {
  const { id } = req.params;
  const prev = stmtSelectLogById.get(id);

  if (!prev) {
    return res.status(404).json({ ok: false, error: `Log ${id} not found` });
  }

  const body = req.body || {};
  const nowIso = new Date().toISOString();

  // meta를 객체로 보냈을 수도 있음
  let meta_json = prev.meta_json;
  if (body.meta_json) {
    meta_json =
      typeof body.meta_json === "string"
        ? body.meta_json
        : JSON.stringify(body.meta_json);
  } else if (body.meta) {
    meta_json = JSON.stringify(body.meta || {});
  }

  const merged = {
    log_id: prev.log_id,

    source: body.source ?? prev.source,
    system: body.system ?? prev.system,
    env: body.env ?? prev.env,

    risk: body.risk ?? prev.risk,
    incident_category:
      body.incident_category ?? prev.incident_category,

    title: body.title ?? prev.title,
    text: body.text ?? prev.text,
    summary: body.summary ?? prev.summary,
    pii_regex_summary:
      body.pii_regex_summary ?? prev.pii_regex_summary,
    log_detail: body.log_detail ?? prev.log_detail,
    redacted_log: body.redacted_log ?? prev.redacted_log,

    risk_reason_l1: body.risk_reason_l1 ?? prev.risk_reason_l1,
    risk_reason_l2: body.risk_reason_l2 ?? prev.risk_reason_l2,
    recommendation_l1:
      body.recommendation_l1 ?? prev.recommendation_l1,
    recommendation_l2:
      body.recommendation_l2 ?? prev.recommendation_l2,

    pii_regex_found:
      typeof body.pii_regex_found === "number"
        ? body.pii_regex_found
        : prev.pii_regex_found,
    pii_regex_types: body.pii_regex_types ?? prev.pii_regex_types,

    ai_learn_enabled:
      typeof body.ai_learn_enabled === "boolean"
        ? body.ai_learn_enabled
          ? 1
          : 0
        : prev.ai_learn_enabled,
    ai_learn_completed:
      typeof body.ai_learn_completed === "boolean"
        ? body.ai_learn_completed
          ? 1
          : 0
        : prev.ai_learn_completed,
    final_risk_for_learning:
      body.final_risk_for_learning ?? prev.final_risk_for_learning,

    meta_json,

    processing_time_ms:
      typeof body.processing_time_ms === "number"
        ? body.processing_time_ms
        : prev.processing_time_ms,
    is_garbage:
      typeof body.is_garbage === "boolean"
        ? body.is_garbage
          ? 1
          : 0
        : prev.is_garbage,
    garbage_reason: body.garbage_reason ?? prev.garbage_reason,

    created_at: prev.created_at || nowIso,
    updated_at: nowIso,
  };

  stmtUpsertLog.run({
    log_id: merged.log_id,
    source: merged.source,
    system: merged.system,
    env: merged.env,
    risk: merged.risk,
    incident_category: merged.incident_category,
    title: merged.title,
    text: merged.text,
    summary: merged.summary,
    pii_regex_summary: merged.pii_regex_summary,
    log_detail: merged.log_detail,
    redacted_log: merged.redacted_log,
    risk_reason_l1: merged.risk_reason_l1,
    risk_reason_l2: merged.risk_reason_l2,
    recommendation_l1: merged.recommendation_l1,
    recommendation_l2: merged.recommendation_l2,
    pii_regex_found: merged.pii_regex_found,
    pii_regex_types: merged.pii_regex_types,
    ai_learn_enabled: merged.ai_learn_enabled,
    ai_learn_completed: merged.ai_learn_completed,
    final_risk_for_learning: merged.final_risk_for_learning,
    meta_json: merged.meta_json,
    processing_time_ms: merged.processing_time_ms,
    is_garbage: merged.is_garbage,
    garbage_reason: merged.garbage_reason,
    created_at: merged.created_at,
    updated_at: merged.updated_at,
  });

  const saved = stmtSelectLogById.get(merged.log_id);

  if (saved) {
    logsCache = [
      saved,
      ...logsCache.filter((l) => l.log_id !== saved.log_id),
    ].slice(0, SSE_CACHE_LIMIT);
    broadcast({ type: "log", payload: saved });
  }

  const updateId = safeLog(id).replace(/\n/g, " ").replace(/\r/g, " ");
  const updateBody = safeLog(body).replace(/\n/g, " ").replace(/\r/g, " ");
  console.log("[LOG UPDATE] %s ← %s", updateId, updateBody);

  res.json({ ok: true, log: saved, summary: getSummary() });
});

// ==========================================================
// 🎓 [2-1] 학습 상태 전용 업데이트 (학습 워커용)
// ==========================================================
app.patch("/api/logs/:id/learn-complete", (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  const prev = stmtSelectLogById.get(id);
  if (!prev) {
    return res
      .status(404)
      .json({ ok: false, error: `Log ${id} not found (learn-complete)` });
  }

  const nowIso = new Date().toISOString();

  const patch = {
    log_id: prev.log_id,
    source: prev.source,
    system: prev.system,
    env: prev.env,
    risk: prev.risk,
    incident_category: prev.incident_category,
    title: prev.title,
    text: prev.text,
    summary: prev.summary,
    pii_regex_summary: prev.pii_regex_summary,
    log_detail: prev.log_detail,
    redacted_log: prev.redacted_log,

    risk_reason_l1: prev.risk_reason_l1,
    risk_reason_l2: prev.risk_reason_l2,
    recommendation_l1: prev.recommendation_l1,
    recommendation_l2: prev.recommendation_l2,

    pii_regex_found: prev.pii_regex_found,
    pii_regex_types: prev.pii_regex_types,
    ai_learn_enabled:
      typeof body.ai_learn_enabled === "boolean"
        ? body.ai_learn_enabled
          ? 1
          : 0
        : prev.ai_learn_enabled,
    ai_learn_completed:
      typeof body.ai_learn_completed === "boolean"
        ? body.ai_learn_completed
          ? 1
          : 0
        : 1, // 기본값: 학습 완료 처리
    final_risk_for_learning:
      body.final_risk_for_learning || prev.final_risk_for_learning,
    meta_json: prev.meta_json,
    processing_time_ms: prev.processing_time_ms,
    is_garbage: prev.is_garbage,
    garbage_reason: prev.garbage_reason,
    created_at: prev.created_at,
    updated_at: nowIso,
  };

  stmtUpsertLog.run({
    log_id: patch.log_id,
    source: patch.source,
    system: patch.system,
    env: patch.env,
    risk: patch.risk,
    incident_category: patch.incident_category,
    title: patch.title,
    text: patch.text,
    summary: patch.summary,
    pii_regex_summary: patch.pii_regex_summary,
    log_detail: patch.log_detail,
    redacted_log: patch.redacted_log,
    risk_reason_l1: patch.risk_reason_l1,
    risk_reason_l2: patch.risk_reason_l2,
    recommendation_l1: patch.recommendation_l1,
    recommendation_l2: patch.recommendation_l2,
    pii_regex_found: patch.pii_regex_found,
    pii_regex_types: patch.pii_regex_types,
    ai_learn_enabled: patch.ai_learn_enabled,
    ai_learn_completed: patch.ai_learn_completed,
    final_risk_for_learning: patch.final_risk_for_learning,
    meta_json: patch.meta_json,
    processing_time_ms: patch.processing_time_ms,
    is_garbage: patch.is_garbage,
    garbage_reason: patch.garbage_reason,
    created_at: patch.created_at,
    updated_at: patch.updated_at,
  });

  const saved = stmtSelectLogById.get(patch.log_id);

  if (saved) {
    logsCache = [
      saved,
      ...logsCache.filter((l) => l.log_id !== saved.log_id),
    ].slice(0, SSE_CACHE_LIMIT);
    broadcast({ type: "log", payload: saved });
  }

  const learnId = safeLog(patch.log_id).replace(/\n/g, " ").replace(/\r/g, " ");
  const learnEnabled = safeLog(patch.ai_learn_enabled).replace(/\n/g, " ").replace(/\r/g, " ");
  const learnDone = safeLog(patch.ai_learn_completed).replace(/\n/g, " ").replace(/\r/g, " ");
  console.log(
    `[LEARN COMPLETE] ${learnId} : enabled=${learnEnabled}, completed=${learnDone}`
  );

  res.json({ ok: true, log: saved, summary: getSummary() });
});

// ==========================================================
// 🧠 [3] Security KB 학습 데이터 추가 (SQLite kb_items)
// ==========================================================
function handleAddKb(req, res) {
  const item = req.body || {};
  if (!item.text) {
    return res.status(400).json({ ok: false, error: "text가 없습니다." });
  }

  const nowIso = new Date().toISOString();

  const row = {
    log_id: item.meta?.log_id || item.log_id || null,
    risk: item.risk || null,
    incident_category: item.incident_category || item.category || null,
    source: item.source || null,
    title: item.title || null,
    text: item.text,
    notes: item.notes || null,
    meta_json: JSON.stringify(item.meta || {}, null, 0),
    created_at: nowIso,
    updated_at: nowIso,
  };

  const info = stmtInsertKb.run(row);

  const kbRisk = safeLog(row.risk || "?").replace(/\n/g, " ").replace(/\r/g, " ");
  const kbLog = safeLog(row.log_id || "N/A").replace(/\n/g, " ").replace(/\r/g, " ");
  console.log(
    `[KB ADD] id=${info.lastInsertRowid}, risk=${kbRisk}, log=${kbLog}`
  );

  res.json({ ok: true, id: info.lastInsertRowid });
}

app.post("/security-kb", handleAddKb);
app.post("/api/kb", handleAddKb);

// ==========================================================
// 📚 [3-1] KB 예시 조회 (유사 학습 사례)
// ==========================================================
function handleGetKbExamples(req, res) {
  const { category, risk, limit = 3 } = req.query;

  const rows = stmtSelectKbExamples.all({
    category: category || null,
    risk: risk || null,
    limit: Number(limit) || 3,
  });

  res.json(rows);
}

app.get("/security-kb/examples", handleGetKbExamples);
app.get("/api/kb/examples", handleGetKbExamples);

// ==========================================================
// 📤 [3-2] KB 전체 Export (재학습 / 백업용)
// ==========================================================
app.get("/kb/export", (req, res) => {
  const rows = stmtSelectKbAll.all();
  res.json(rows);
});

app.get("/kb/export-ndjson", (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  const rows = stmtSelectKbAll.all();
  for (const row of rows) {
    res.write(JSON.stringify(row) + "\n");
  }
  res.end();
});

// ==========================================================
// 📊 [4] 대시보드 요약 / 디버그
// ==========================================================
app.get("/api/summary", (req, res) => {
  res.json(getSummary());
});

app.get("/debug/logs", debugLimiter, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, log_id, risk, incident_category,
              ai_learn_enabled, ai_learn_completed,
              is_garbage, garbage_reason, created_at
       FROM logs
       ORDER BY datetime(created_at) DESC`
    )
    .all();

  res.json({
    summary: getSummary(),
    count: rows.length,
    items: rows,
  });
});

app.get("/debug/kb", debugLimiter, (req, res) => {
  const rows = stmtSelectKbAll.all();
  res.json({
    count: rows.length,
    items: rows.map((k) => ({
      id: k.id,
      risk: k.risk,
      createdAt: k.created_at,
      log_id: k.log_id,
    })),
  });
});

app.get("/debug/learn-queue", debugLimiter, (req, res) => {
  const rows = stmtSelectLearnQueue.all();
  res.json({
    count: rows.length,
    items: rows.map((l) => ({
      id: l.id,
      log_id: l.log_id,
      risk: l.risk,
      ai_learn_enabled: l.ai_learn_enabled,
      ai_learn_completed: l.ai_learn_completed,
    })),
  });
});

app.get("/debug/logs/:id", debugLimiter, (req, res) => {
  const { id } = req.params;
  const row = stmtSelectLogById.get(id);
  if (!row) {
    return res.status(404).json({ ok: false, error: `Log ${id} not found` });
  }
  res.json(row);
});

// ==========================================================
// 🚦 서버 시작
// ==========================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `✅ SecureFlow SQLite backend (Metrics 포함) listening on http://0.0.0.0:${PORT}`
  );
});
