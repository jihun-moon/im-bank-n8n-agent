// src/App.js
import React, { useEffect, useState, useRef } from "react";
import "./App.css";

// 🔗 백엔드 엔드포인트 (Node server-sqlite.js)
const NODE_BACKEND_BASE = "http://YOUR_SERVER_IP:3001";

function App() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState(null);

  const [selectedRisk, setSelectedRisk] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [openRowId, setOpenRowId] = useState(null);

  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [latestLogTime, setLatestLogTime] = useState(null);

  // 🔧 Garbage 로그 기본은 숨기기
  const [hideGarbage, setHideGarbage] = useState(true);

  // ✅ 운영 모니터링 지표 상태
  const [metrics, setMetrics] = useState({
    windowMinutes: 5,
    totalLast: 0,
    highLast: 0,
    queuePending: 0,
    garbageCount: 0,
    avgProcessingMs: 0,
    learnedLast: 0,
  });

  // ✅ SSE가 "최초 연결인지 / 재연결인지" 구분하기 위한 ref
  const firstConnectRef = useRef(true);

  // 🔹 /api/summary 호출
  async function fetchSummary() {
    try {
      const res = await fetch(`${NODE_BACKEND_BASE}/api/summary`);
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      console.error("summary 로드 실패:", err);
    }
  }

  // 🔹 /metrics 호출
  async function fetchMetrics() {
    try {
      const res = await fetch(`${NODE_BACKEND_BASE}/metrics`);
      if (!res.ok) return;
      const data = await res.json();
      setMetrics((prev) => ({ ...prev, ...data }));
    } catch (err) {
      console.error("metrics 로드 실패:", err);
    }
  }

  // 🔹 초기 1회 fetch + SSE 연결
  useEffect(() => {
    let eventSource = null;
    let retryTimeout = null;
    let metricsTimer = null;

    async function fetchLogs() {
      try {
        const res = await fetch(`${NODE_BACKEND_BASE}/api/logs?limit=500`);
        const data = await res.json();
        const logsArray = Array.isArray(data) ? data : [];

        setLogs(logsArray);
        if (logsArray.length > 0) {
          const last = logsArray[0]; // created_at DESC 기준이므로 첫 번째가 최신
          setLatestLogTime(
            last.occurred_at || last.timestamp || last.created_at || null
          );
        } else {
          setLatestLogTime(null);
        }
        setLastFetchAt(new Date().toISOString());
      } catch (err) {
        console.error("로그 로드 실패:", err);
      }
    }

    async function initialLoad() {
      setLoading(true);
      await Promise.all([fetchLogs(), fetchSummary(), fetchMetrics()]);
      setLoading(false);
    }

    function connectSSE() {
      if (eventSource) {
        eventSource.close();
      }

      const es = new EventSource(`${NODE_BACKEND_BASE}/events`);
      eventSource = es;

      es.onopen = () => {
        console.log("SSE 연결/재연결 완료");
        if (firstConnectRef.current) {
          firstConnectRef.current = false;
          console.log("최초 연결 → /api/logs + /api/summary + /metrics 동기화");
          fetchLogs();
          fetchSummary();
          fetchMetrics();
        } else {
          console.log("재연결 → 기존 로그/summary/metrics 유지");
          fetchMetrics();
        }
      };

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          // ✅ 서버가 { type: "logs", payload: [...] } 형식으로 전체 캐시 전달
          if (
            payload &&
            payload.type === "logs" &&
            Array.isArray(payload.payload)
          ) {
            const arr = payload.payload;

            setLogs((prev) => {
              if (JSON.stringify(prev) === JSON.stringify(arr)) return prev;

              document.body.classList.add("highlight-glow");
              setTimeout(
                () => document.body.classList.remove("highlight-glow"),
                500
              );

              return arr;
            });

            setLastFetchAt(new Date().toISOString());
            if (arr.length > 0) {
              const last = arr[0];
              setLatestLogTime(
                last.occurred_at || last.timestamp || last.created_at || null
              );
            }

            fetchSummary();
            fetchMetrics();
            return;
          }

          // ✅ 서버가 { type: "log", payload: {...} } 형식으로 단일 로그 브로드캐스트
          if (payload && payload.type === "log" && payload.payload) {
            const newLog = payload.payload;

            setLogs((prev) => {
              const merged = [newLog, ...prev];
              const seen = new Set();
              const deduped = merged.filter((l) => {
                const key =
                  l.log_id ||
                  l.id ||
                  l.logId ||
                  `${l.log_detail ||
                    l.Log_Detail ||
                    l.redacted_log ||
                    ""}::${l.occurred_at || l.timestamp || ""}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              return deduped.slice(0, 500);
            });

            setLastFetchAt(new Date().toISOString());
            const t =
              newLog.occurred_at || newLog.timestamp || newLog.created_at;
            if (t) setLatestLogTime(t);

            fetchSummary();
            fetchMetrics();
            return;
          }

          // ✅ 예전 버전 호환: 서버가 그냥 배열 자체를 보내는 경우
          if (Array.isArray(payload)) {
            setLogs((prev) => {
              if (JSON.stringify(prev) === JSON.stringify(payload)) return prev;

              document.body.classList.add("highlight-glow");
              setTimeout(
                () => document.body.classList.remove("highlight-glow"),
                500
              );

              return payload;
            });

            setLastFetchAt(new Date().toISOString());
            if (payload.length > 0) {
              const last = payload[0];
              setLatestLogTime(
                last.occurred_at || last.timestamp || last.created_at || null
              );
            }

            fetchSummary();
            fetchMetrics();
            return;
          }

          // ✅ 다른 타입 혹은 heartbeat 등은 무시
        } catch (err) {
          // heartbeat 등으로 인한 파싱 에러는 조용히 무시
        }
      };

      es.onerror = (e) => {
        console.warn("SSE 연결 오류, 3초 후 재연결 시도:", e);
        es.close();
        retryTimeout = setTimeout(() => {
          connectSSE();
        }, 3000);
      };
    }

    initialLoad();
    connectSSE();

    // 🔁 백엔드/SSE가 잠깐 끊겨도 10초마다 운영 지표 보정
    metricsTimer = setInterval(() => {
      fetchMetrics();
    }, 10000);

    return () => {
      if (eventSource) eventSource.close();
      if (retryTimeout) clearTimeout(retryTimeout);
      if (metricsTimer) clearInterval(metricsTimer);
    };
  }, []);

  // ---------- 중복 제거 ----------
  const dedupedLogs = (() => {
    const seen = new Set();
    return logs.filter((log) => {
      const key =
        log.log_id ||
        log.id ||
        log.logId ||
        `${log.log_detail ||
          log.Log_Detail ||
          log.redacted_log ||
          ""}::${log.occurred_at || log.timestamp || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  // ---------- 통계 계산 ----------
  const total = summary?.total ?? dedupedLogs.length;
  const highRisk =
    summary?.high ?? dedupedLogs.filter((l) => l.risk === "High").length;
  const learnQueue =
    summary?.learnQueue ??
    dedupedLogs.filter((l) => l.ai_learn_enabled && !l.ai_learn_completed)
      .length;
  const learned =
    summary?.learned ?? dedupedLogs.filter((l) => l.ai_learn_completed).length;

  const piiCases =
    summary?.piiCases ?? dedupedLogs.filter((l) => l.pii_regex_found).length;

  const exfilCount =
    summary?.exfilCount ??
    dedupedLogs.filter((l) => l.incident_category === "exfiltration").length;
  const credCount =
    summary?.credCount ??
    dedupedLogs.filter((l) => l.incident_category === "credential_abuse")
      .length;
  const misconfCount =
    summary?.misconfCount ??
    dedupedLogs.filter((l) => l.incident_category === "misconfiguration")
      .length;

  // ---------- 필터 ----------
  const filteredLogs = dedupedLogs.filter((log) => {
    // Garbage 숨기기 옵션 적용
    if (hideGarbage && log.is_garbage) return false;

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
          실시간 로그 수집부터 정규식 탐지, 위험도 분석, 학습 큐 관리, 학습
          완료까지 전 과정 자동화합니다.
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

      {/* 상단 통계 카드 (위험도/학습/PII) */}
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

      {/* 운영 메트릭 카드 */}
      <section className="metrics-section">
        <div className="stat-card">
          <div className="stat-label">
            최근 {metrics.windowMinutes}분 처리 로그
          </div>
          <div className="stat-value">
            {metrics.totalLast ?? "-"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">최근 고위험 로그</div>
          <div className="stat-value">
            {metrics.highLast ?? "-"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Raw Queue 대기</div>
          <div className="stat-value">
            {metrics.queuePending ?? "-"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">최근 Garbage 로그</div>
          <div className="stat-value">
            {metrics.garbageCount ?? "-"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">평균 처리 시간 (ms)</div>
          <div className="stat-value">
            {metrics.avgProcessingMs ?? "-"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">최근 학습 완료 건수</div>
          <div className="stat-value">
            {metrics.learnedLast ?? "-"}
          </div>
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

        {/* Garbage 토글 */}
        <div className="filter-group">
          <span className="filter-label">Garbage:</span>
          <button
            className={hideGarbage ? "filter-btn active" : "filter-btn"}
            onClick={() => setHideGarbage(true)}
          >
            숨기기
          </button>
          <button
            className={!hideGarbage ? "filter-btn active" : "filter-btn"}
            onClick={() => setHideGarbage(false)}
          >
            같이 보기
          </button>
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
                  .sort((a, b) => {
                    const ta = new Date(
                      a.occurred_at || a.timestamp || a.created_at || 0
                    ).getTime();
                    const tb = new Date(
                      b.occurred_at || b.timestamp || b.created_at || 0
                    ).getTime();
                    return tb - ta;
                  })
                  .slice(0, 200)
                  .map((log) => {
                    const rowId =
                      log.log_id || log.id || log.logId || log.occurred_at;

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
                            {log.summary ||
                              log.text ||
                              log.detail ||
                              log.pii_regex_summary ||
                              "-"}
                          </td>
                          <td>
                            <span className="badge badge-source">
                              {log.source || "UNKNOWN"}
                            </span>
                          </td>
                          <td>
                            {formatTime(
                              log.occurred_at ||
                                log.timestamp ||
                                log.created_at
                            )}
                          </td>
                          <td className="toggle-cell">
                            {openRowId === rowId ? "▲" : "▼"}
                          </td>
                        </tr>

                        {openRowId === rowId && (
                          <tr className="row-detail">
                            <td colSpan={7}>
                              <div className="detail-box">
                                {/* 왼쪽: PII/이유/대응 */}
                                <div className="detail-col-meta">
                                  <div className="detail-row">
                                    <span className="detail-label">
                                      PII 탐지 요약
                                    </span>
                                    <span className="detail-value">
                                      {log.pii_regex_summary ||
                                        log.summary ||
                                        log.text ||
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
                                        "-"}
                                    </span>
                                  </div>
                                  <div className="detail-row">
                                    <span className="detail-label">
                                      추천 대응
                                    </span>
                                    <span className="detail-value">
                                      {log.recommendation_l2 ||
                                        log.recommendation_l1 ||
                                        log.recommendation ||
                                        "-"}
                                    </span>
                                  </div>
                                  <div className="detail-row">
                                    <span className="detail-label">
                                      Garbage 여부
                                    </span>
                                    <span className="detail-value">
                                      {log.is_garbage
                                        ? `Garbage (${
                                            log.garbage_reason ||
                                            "필터 규칙에 의해 제외된 로그"
                                          })`
                                        : "정상 로그"}
                                    </span>
                                  </div>
                                </div>

                                {/* 오른쪽: 로그 전문 */}
                                <div className="detail-col-log">
                                  <div className="detail-row detail-log-row">
                                    <span className="detail-label detail-label-log">
                                      로그 내용
                                    </span>
                                    <pre className="detail-log">
                                      {log.log_detail ||
                                        log.redacted_log ||
                                        log.redactedLog ||
                                        log.Log_Detail ||
                                        log.text ||
                                        "(로그 없음)"}
                                    </pre>
                                  </div>
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
