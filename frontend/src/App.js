import React, { useEffect, useState } from "react";

const BACKEND_URL = "http://175.45.194.202:3001/api/logs"; // 서버 공인 IP

function App() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(BACKEND_URL);
        const data = await res.json();
        setLogs(data);
      } catch (err) {
        console.error("로그 가져오기 실패:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
    const id = setInterval(fetchLogs, 10000); // 10초마다 새로고침
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "20px" }}>
      <h1>im-bank n8n Dashboard</h1>
      <p>n8n이 백엔드로 보낸 위험 로그를 실시간으로 보여줍니다.</p>

      {loading ? (
        <p>불러오는 중...</p>
      ) : logs.length === 0 ? (
        <p>아직 수집된 로그가 없습니다.</p>
      ) : (
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            marginTop: "20px",
          }}
        >
          <thead>
            <tr>
              <th style={thStyle}>위험도</th>
              <th style={thStyle}>요약</th>
              <th style={thStyle}>상세 내용</th>
              <th style={thStyle}>수신 시간</th>
            </tr>
          </thead>
          <tbody>
            {logs
              .slice()
              .reverse() // 최신이 위로
              .map((log, idx) => (
                <tr key={idx}>
                  <td style={{ ...tdStyle, fontWeight: "bold", color: colorByRisk(log.risk) }}>
                    {log.risk}
                  </td>
                  <td style={tdStyle}>{log.summary}</td>
                  <td style={tdStyle}>{log.detail}</td>
                  <td style={tdStyle}>
                    {log.timestamp
                      ? new Date(log.timestamp).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle = {
  border: "1px solid #ddd",
  padding: "8px",
  backgroundColor: "#f4f4f4",
};

const tdStyle = {
  border: "1px solid #ddd",
  padding: "8px",
};

function colorByRisk(risk) {
  if (!risk) return "#000";
  const r = risk.toLowerCase();
  if (r.includes("high") || r.includes("위험")) return "red";
  if (r.includes("medium") || r.includes("주의")) return "orange";
  if (r.includes("low") || r.includes("정상")) return "green";
  return "#000";
}

export default App;
