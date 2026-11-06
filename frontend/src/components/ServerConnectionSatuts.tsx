import { useState } from "react";

export default function ServerConnectionStatus() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("아직 연결을 확인하지 않았습니다.");

  async function checkConnection() {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

    if (!apiBaseUrl) {
      setMessage("VITE_API_BASE_URL 환경변수를 먼저 설정해 주세요.");
      return;
    }

    setLoading(true);
    setMessage("서버 확인 중입니다. 첫 접속에는 1분 정도 걸릴 수 있습니다.");

    try {
      const response = await fetch(`${apiBaseUrl}/api/health`);

      if (!response.ok) {
        throw new Error(`서버 응답 오류: ${response.status}`);
      }

      const data = await response.json();

      if (data.status !== "UP") {
        throw new Error("정상 상태 응답이 아닙니다.");
      }

      setMessage("백엔드 연결 성공!");
    } catch {
      setMessage("연결 실패. 서버 상태와 API 주소, CORS 설정을 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-label="백엔드 연결 확인">
      <button
        type="button"
        className="button button-secondary"
        onClick={checkConnection}
        disabled={loading}
      >
        {loading ? "확인 중…" : "백엔드 연결 확인"}
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
