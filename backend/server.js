// backend/server.js
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3001;

// CORS & JSON 파서
app.use(cors());
app.use(express.json());

// 메모리에 로그 저장 (나중에 DB로 바꿔도 됨)
let logs = [];

// 헬스체크
app.get("/", (req, res) => {
  res.send("im-bank-n8n-agent backend running ✅");
});

// n8n 이 로그 보내는 곳
app.post("/api/logs", (req, res) => {
  const log = req.body;

  if (!log || !log.risk) {
    return res.status(400).json({ error: "risk 필드는 필수입니다." });
  }

  log.timestamp = new Date().toISOString();
  logs.push(log);

  console.log("✅ New log:", log);
  res.json({ ok: true });
});

// 프론트가 리스트를 가져가는 곳
app.get("/api/logs", (req, res) => {
  res.json(logs);
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});
