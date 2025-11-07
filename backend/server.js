const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// 메모리에 로그 저장 (나중에 DB로 바꿀 수 있음)
let logs = [];

// 헬스 체크
app.get("/", (req, res) => {
  res.send("im-bank-n8n-agent backend running ✅");
});

// n8n이 분석 결과를 보내는 곳
app.post("/api/logs", (req, res) => {
  const log = req.body;

  if (!log || !log.risk) {
    return res.status(400).json({ error: "log.risk 필드가 필요합니다" });
  }

  log.timestamp = new Date().toISOString();
  logs.push(log);

  console.log("✅ New log received:", log);
  res.json({ ok: true });
});

// 프론트엔드가 조회하는 곳
app.get("/api/logs", (req, res) => {
  res.json(logs);
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});
