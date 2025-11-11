// src/App.js
import React, { useEffect, useState } from "react";
import "./App.css";

// 🔗 백엔드 / n8n 엔드포인트
const NODE_BACKEND_BASE = "http://YOUR_SERVER_IP:3001"; // SSE, summary 등
const N8N_WEBHOOK_ID = "c414a7fc-9924-4f90-b7a5-99998989e80b"; // API - Get Logs / Update Log 공통
const N8N_BASE = `http://YOUR_SERVER_IP:5678/webhook/${N8N_WEBHOOK_ID}`; // n8n Webhook API

function App() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedRisk, setSelectedRisk] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [openRowId, setOpenRowId] = useState(null);

  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [latestLogTime, setLatestLogTime] = useState(null);

  // 🔹 초기 1회 fetch + SSE 연결
  useEffect(() => {
    async function initialLoad() {
      try {
        // n8n "API - Get Logs" Webhook
        const res = await fetch(`${N8N_BASE}/api/logs`);
        const data = await res.json();
        const logsArray = Array.isArray(data) ? data : [];
        setLogs(logsArray);
        setLatestLogTime(
          logsArray.length > 0
            ? logsArray[logsArray.length - 1].timestamp
            : null
        );
        setLastFetchAt(new Date().toISOString());
      } catch (err) {
        console.error("초기 로그 로드 실패:", err);
      } finally {
        setLoading(false);
      }
    }

    initialLoad();

    // 🔹 SSE (Server-Sent Events) 연결
    const eventSource = new EventSource(`${NODE_BACKEND_BASE}/events`);

    eventSource.onmessage = (event) => {
      try {
        const newData = JSON.parse(event.data);
        if (!Array.isArray(newData)) return;

        setLogs((prev) => {
          // 완전히 동일하면 무시
          if (JSON.stringify(prev) === JSON.stringify(newData)) return prev;

          // 새 로그 하이라이트 효과
          document.body.classList.add("highlight-glow");
          setTimeout(
            () => document.body.classList.remove("highlight-glow"),
            500
          );

          return newData;
        });

        setLastFetchAt(new Date().toISOString());
        if (newData.length > 0) {
          setLatestLogTime(newData[newData.length - 1].timestamp);
        }
      } catch (err) {
        console.error("SSE 데이터 처리 실패:", err);
      }
    };

    eventSource.onerror = (e) => {
      console.warn("SSE 연결 끊김:", e);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // ---------- 통계 계산 ----------
  const total = logs.length;
  const highRisk = logs.filter((l) => l.risk === "High").length;
  const learnQueue = logs.filter(
    (l) => l.ai_learn_enabled && !l.ai_learn_completed
  ).length;
  const learned = logs.filter((l) => l.ai_learn_completed).length;
  const piiCases = logs.filter((l) => l.pii_regex_found).length;

  const exfilCount = logs.filter(
    (l) => l.incident_category === "exfiltration"
  ).length;
  const credCount = logs.filter(
    (l) => l.incident_category === "credential_abuse"
  ).length;
  const misconfCount = logs.filter(
    (l) => l.incident_category === "misconfiguration"
  ).length;

  // ---------- 중복 제거 ----------
  const dedupedLogs = (() => {
    const seen = new Set();
    return logs.filter((log) => {
      const key =
        log.id ||
        log.logId ||
        `${log.log_detail || log.Log_Detail || ""}::${log.timestamp || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  // ---------- 필터 ----------
  const filteredLogs = dedupedLogs.filter((log) => {
    if (selectedRisk !== "ALL" && log.risk !== selectedRisk) return false;
    if (
      selectedCategory !== "ALL" &&
      log.incident_category !== selectedCategory
    )
      return false;
    return true;
  });

  // ---------- 유틸 ----------
  const formatTime = (t) => (!t ? "-" : new Date(t).toLocaleString());

  const riskBadgeClass = (r) =>
    r === "High"
      ? "badge badge-high"
      : r === "Medium"
      ? "badge badge-medium"
      : "badge badge-safe";

  const statusBadgeClass = (l) =>
    l.ai_learn_completed
      ? "badge badge-learned"
      : l.ai_learn_enabled
      ? "badge badge-queue"
      : "badge badge-default";

  const renderLearnProgress = (l) => {
    let pct = 0;
    let label = "일반 로그";
    let bar = "progress-bar";

    if (l.ai_learn_completed) {
      pct = 100;
      label = "학습 완료";
      bar += " progress-bar-done";
    } else if (l.ai_learn_enabled) {
      pct = 60;
      label = "학습 후보";
      bar += " progress-bar-active";
    }

    return (
      <div className="learn-progress">
        <span className={statusBadgeClass(l)}>{label}</span>
        <div className="progress-track">
          <div
            className={bar}
            style={{ width: `${pct}%`, transition: "width 0.5s ease" }}
          />
        </div>
      </div>
    );
  };

  const toggleRow = (id) => setOpenRowId((prev) => (prev === id ? null : id));

  // ---------- 렌더 ----------
  return (
    <div className="app-root">
      <header className="app-header">
        <h1>AI 기반 개인정보 유출 탐지 및 자동 학습 파이프라인</h1>
        <p className="app-subtitle">
          실시간 로그 수집부터 정규식 탐지, 위험도 분석, 학습 큐 관리, 학습 완료까지
          전 과정 자동화합니다.
          <br />
          고위험·비PII 로그만 선별 학습하여 보안 인시던트 대응 AI를 지속적으로
          진화시킵니다.
        </p>
      </header>

      {/* 실시간 배너 */}
      <section className="sim-banner glow-border">
        <div className="sim-left">
          <span className="sim-status-pill">
            <span className="sim-live-dot" /> LIVE
          </span>
          <div className="sim-text-main">n8n 실시간 로그 스트림 연결됨</div>
          <div className="sim-text-sub">SSE 기반 실시간 갱신 중</div>
        </div>
        <div className="sim-right">
          <div className="sim-meta-line">
            <span className="sim-meta-label">최근 로그 발생</span>
            <span className="sim-meta-value">
              {formatTime(latestLogTime)}
            </span>
          </div>
          <div className="sim-meta-line">
            <span className="sim-meta-label">대시보드 갱신</span>
            <span className="sim-meta-value">{formatTime(lastFetchAt)}</span>
          </div>
        </div>
      </section>

      {/* 상단 통계 */}
      <section className="stats-section">
        <div className="stat-card">
          <div className="stat-label">전체 로그</div>
          <div className="stat-value">{total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">고위험(High)</div>
          <div className="stat-value">{highRisk}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">학습 큐</div>
          <div className="stat-value">{learnQueue}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">학습 완료</div>
          <div className="stat-value">{learned}</div>
        </div>
        <div className="stat-card stat-card-pii">
          <div className="stat-label">민감 PII 탐지</div>
          <div className="stat-value">{piiCases}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">데이터 유출</div>
          <div className="stat-value">{exfilCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">계정 악용</div>
          <div className="stat-value">{credCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">설정 오류</div>
          <div className="stat-value">{misconfCount}</div>
        </div>
      </section>

      {/* 필터 */}
      <section className="controls-section">
        <div className="filter-group">
          <span className="filter-label">위험도:</span>
          {["ALL", "High", "Medium", "Safe"].map((r) => (
            <button
              key={r}
              className={selectedRisk === r ? "filter-btn active" : "filter-btn"}
              onClick={() => setSelectedRisk(r)}
            >
              {r === "ALL" ? "전체" : r}
            </button>
          ))}
        </div>

        <div className="filter-group">
          <span className="filter-label">유형:</span>
          {[
            ["ALL", "전체"],
            ["exfiltration", "데이터 유출"],
            ["credential_abuse", "계정 악용"],
            ["misconfiguration", "설정 오류"],
            ["monitoring", "모니터링"],
          ].map(([val, label]) => (
            <button
              key={val}
              className={
                selectedCategory === val ? "filter-btn active" : "filter-btn"
              }
              onClick={() => setSelectedCategory(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* 테이블 */}
      <section className="table-section">
        <div className="table-header-row">
          <h2>실시간 보안 로그</h2>
          <span className="table-subtitle">
            {selectedRisk === "ALL" ? "전체" : selectedRisk} 위험도 표시
          </span>
        </div>

        {loading ? (
          <div className="loading">불러오는 중...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty">표시할 로그가 없습니다.</div>
        ) : (
          <div className="table-wrapper">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>위험도</th>
                  <th>유형</th>
                  <th>학습 상태</th>
                  <th>요약</th>
                  <th>출처</th>
                  <th>시각</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...filteredLogs]
                  // 1️⃣ timestamp 기준으로 최신순 정렬 (가장 최근 로그가 위로)
                  .sort(
                    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
                  )
                  // 2️⃣ 너무 오래된 건 잘라서 최대 200개까지만 표시
                  .slice(0, 200)
                  .map((log) => {
                    const rowId = log.id || log.logId || log.timestamp;
                    return (
                      <React.Fragment key={rowId}>
                        <tr
                          className={
                            openRowId === rowId
                              ? "row-main row-open"
                              : "row-main"
                          }
                          onClick={() => toggleRow(rowId)}
                        >
                          <td>
                            <span className={riskBadgeClass(log.risk)}>
                              {log.risk || "-"}
                            </span>
                          </td>
                          <td>{log.incident_category || "-"}</td>
                          <td>{renderLearnProgress(log)}</td>
                          <td className="col-summary">
                            {log.summary || log.detail || "-"}
                          </td>
                          <td>
                            <span className="badge badge-source">
                              {log.source || "UNKNOWN"}
                            </span>
                          </td>
                          <td>{formatTime(log.timestamp)}</td>
                          <td className="toggle-cell">
                            {openRowId === rowId ? "▲" : "▼"}
                          </td>
                        </tr>
                        {openRowId === rowId && (
                          <tr className="row-detail">
                            <td colSpan={7}>
                              <div className="detail-box">
                                <div className="detail-row">
                                  <span className="detail-label">
                                    PII 탐지 요약
                                  </span>
                                  <span className="detail-value">
                                    {log.pii_regex_summary ||
                                      (log.pii_regex_found
                                        ? "민감 PII 포함"
                                        : "민감 PII 미탐지")}
                                  </span>
                                </div>
                                <div className="detail-row">
                                  <span className="detail-label">
                                    위험도 판단 이유
                                  </span>
                                  <span className="detail-value">
                                    {log.risk_reason_l2 ||
                                      log.risk_reason_l1 ||
                                      log.detail ||
                                      "-"}
                                  </span>
                                </div>
                                <div className="detail-row">
                                  <span className="detail-label">
                                    추천 대응
                                  </span>
                                  <span className="detail-value">
                                    {log.recommendation_l2 ||
                                      log.recommendation ||
                                      "-"}
                                  </span>
                                </div>
                                <div className="detail-row detail-log-row">
                                  <span className="detail-label">
                                    로그 내용
                                  </span>
                                  <pre className="detail-log">
                                    {log.log_detail ||
                                      log.redactedLog ||
                                      log.Log_Detail ||
                                      "(로그 없음)"}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
