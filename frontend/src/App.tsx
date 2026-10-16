import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const menus = ["개요", "회의록", "결정 사항", "내 업무", "AI 질문", "팀 관리"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEMO_DATE = "2026-10-13";

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(DEMO_DATE);
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }

    const isPdf = /\.pdf$/i.test(selectedFile.name);
    const previewFile = new Blob([selectedFile], {
      type: isPdf ? "application/pdf" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(previewFile);

    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  function selectFile(file: File) {
    setError("");
    setNotice("");

    if (!/\.(pdf|txt)$/i.test(file.name)) {
      setSelectedFile(null);
      setError("PDF 또는 TXT 파일만 선택할 수 있습니다.");
      return;
    }

    if (file.size === 0) {
      setSelectedFile(null);
      setError("내용이 없는 파일입니다. 다른 파일을 선택해 주세요.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null);
      setError("파일 크기는 최대 10 MB까지 가능합니다.");
      return;
    }

    setSelectedFile(file);
  }

  function loadExample() {
    const content = [
      "회의명: 행사 준비 회의",
      "회의일: 2026-10-13",
      "참석자: 장준경, 송채은, 정수호",
      "",
      "결정 사항",
      "1. 행사 준비 자료는 10월 15일 20:00까지 제출한다.",
      "2. 장준경은 10월 16일까지 행사 안내문 초안을 작성한다.",
    ].join("\n");

    selectFile(
      new File([content], "예시_회의록_2026-10-13.txt", {
        type: "text/plain;charset=utf-8",
      }),
    );

    setMeetingTitle("행사 준비 회의");
    setMeetingDate(DEMO_DATE);
    setTags("#행사준비 #마감변경");
  }

  function resetForm() {
    setSelectedFile(null);
    setMeetingTitle("");
    setMeetingDate(DEMO_DATE);
    setTags("");
    setError("");
    setNotice("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!selectedFile) {
      setError("회의록 파일을 먼저 선택해 주세요.");
      return;
    }

    if (!meetingTitle.trim()) {
      setError("회의 제목을 입력해 주세요.");
      return;
    }

    if (!meetingDate) {
      setError("회의일을 선택해 주세요.");
      return;
    }

    setNotice(
      "입력 확인이 완료되었습니다. 아직 서버와 연결되지 않아 파일 저장과 AI 분석은 실행되지 않습니다.",
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h2 className="brand">로딩중</h2>
        <p className="sidebar-subtitle">회의의 결정을 잇다</p>

        <button
          type="button"
          className="team-selector"
          disabled
          title="팀 선택 기능은 아직 연결되지 않았습니다."
        >
          <span>현재 팀</span>
          <strong>서비스 기획팀 ▾</strong>
        </button>

        <p className="workspace-label">WORKSPACE</p>

        <nav className="sidebar-nav" aria-label="주 메뉴">
          {menus.map((menu) => (
            <button
              key={menu}
              type="button"
              className={`nav-button ${menu === "회의록" ? "active" : ""}`}
              aria-current={menu === "회의록" ? "page" : undefined}
              disabled={menu !== "회의록"}
              title={
                menu !== "회의록" ? "아직 연결되지 않은 화면입니다." : undefined
              }
            >
              {menu}
            </button>
          ))}
        </nav>

        <div className="sidebar-user">
          <strong>장준경</strong>
          <span>일반 팀원</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <p className="breadcrumb">워크스페이스 / 서비스 기획팀</p>

          <div className="topbar-actions">
            {["알림", "로그아웃", "도움말"].map((label) => (
              <button
                key={label}
                type="button"
                className="text-button"
                disabled
                title="아직 연결되지 않은 기능입니다."
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <main className="main-content">
          <div className="page-heading">
            <h1>회의록 등록</h1>
            <p>회의록 원본을 저장하고 AI 분석을 시작합니다.</p>
          </div>

          <form className="upload-form" onSubmit={handleSubmit}>
            <section className="upload-card" aria-labelledby="file-heading">
              <h2 id="file-heading">
                {selectedFile ? selectedFile.name : "회의록 파일을 선택하세요"}
              </h2>

              <p className="file-description">
                {selectedFile
                  ? `${selectedFile.name.split(".").pop()?.toUpperCase()} · ${(selectedFile.size / 1024).toFixed(1)} KB · 선택 완료`
                  : "텍스트가 있는 PDF 또는 TXT · 최대 10 MB"}
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                aria-label="회의록 파일 선택"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];

                  if (file) {
                    selectFile(file);
                  }

                  event.currentTarget.value = "";
                }}
              />

              <div className="file-actions">
                <button
                  type="button"
                  className="button button-secondary file-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {selectedFile ? "파일 다시 선택" : "파일 선택"}
                </button>

                <button
                  type="button"
                  className="button button-secondary example-button"
                  onClick={loadExample}
                >
                  예시 회의록 불러오기
                </button>

                {selectedFile && previewUrl && (
                  <a
                    className="button button-secondary file-button"
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    원문 미리보기
                  </a>
                )}
              </div>
            </section>

            <div className="field-row">
              <div className="field">
                <label htmlFor="meeting-title">회의 제목</label>
                <input
                  id="meeting-title"
                  type="text"
                  placeholder="행사 준비 회의"
                  value={meetingTitle}
                  onChange={(event) => setMeetingTitle(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="meeting-date">회의일</label>
                <input
                  id="meeting-date"
                  type="date"
                  value={meetingDate}
                  onChange={(event) => setMeetingDate(event.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="meeting-tags">태그</label>
              <input
                id="meeting-tags"
                type="text"
                placeholder="#행사준비  #마감변경"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </div>

            <p className="form-description">
              분석 후 결정 내용·담당자·마감일과 확정 여부를 직접 검토할 수
              있습니다.
            </p>

            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}

            {notice && (
              <p className="notice-message" role="status">
                {notice}
              </p>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary cancel-button"
                onClick={resetForm}
              >
                취소
              </button>

              <button
                type="submit"
                className="button button-primary submit-button"
              >
                저장하고 분석 시작
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

export default App;
