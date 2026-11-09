import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { statusLabels } from "./demo-data";
import type {
  Candidate,
  Decision,
  Evidence,
  Meeting,
  MeetingPhoto,
  Member,
  Navigate,
  Task,
} from "./demo-data";
import MeetingPhotos from "./MeetingPhotos";

export function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading row-between">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function StatusBadge({ status }: { status: Meeting["status"] }) {
  return (
    <span
      className={`badge ${status === "failed" ? "badge-red" : status === "review" || status === "submitted" ? "badge-amber" : ""}`}
    >
      {statusLabels[status]}
    </span>
  );
}
export function SourceButton({
  source,
  onSource,
  label = "원문 근거 보기",
}: {
  source: Evidence;
  onSource: (source: Evidence) => void;
  label?: string;
}) {
  return (
    <button
      className="text-button source-link"
      type="button"
      onClick={() => onSource(source)}
    >
      {label} <span aria-hidden="true">↗</span>
    </button>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol" aria-hidden="true">
        —
      </div>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {action}
    </div>
  );
}
export function SourceDocument({
  meeting,
  source,
}: {
  meeting: Meeting;
  source?: Evidence;
}) {
  const documentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!source) return;
    const frame = window.requestAnimationFrame(() =>
      documentRef.current
        ?.querySelector("mark")
        ?.scrollIntoView({ block: "center" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [source]);
  const downloadUrl =
    meeting.fileUrl ||
    `data:text/plain;charset=utf-8,${encodeURIComponent(meeting.paragraphs.join("\n\n"))}`;
  return (
    <div className="stack" ref={documentRef}>
      <div className="row-between">
        <div>
          <strong>{meeting.title}</strong>
          <p className="small muted">
            {meeting.fileName} · {meeting.date}
            {source && (
              <span>
                {" "}
                · {source.page ? `${source.page}페이지 · ` : ""}문단{" "}
                {source.paragraph}
              </span>
            )}
          </p>
        </div>
        <a
          className="button button-secondary"
          href={downloadUrl}
          download={meeting.fileName}
        >
          원본 다운로드
        </a>
      </div>
      {meeting.format === "PDF" && meeting.fileUrl ? (
        <>
          <p className="small muted">
            PDF 원본 미리보기입니다. 텍스트 추출 결과는 아래에서 확인할 수 있습니다.
          </p>
          <iframe
            className="pdf-preview"
            title={`${meeting.title} PDF 원문`}
            src={`${meeting.fileUrl}#page=${source?.page || 1}`}
          />
        </>
      ) : null}
      {meeting.extractedDocument ? (
        <article className="document-paper" aria-label="추출한 회의록 텍스트">
          <div className="paper-heading">
            <span>EXTRACTED TEXT</span>
            <h2>텍스트 추출 결과</h2>
            <p>
              {meeting.format === "PDF" ? `${meeting.extractedDocument.pages.length}페이지 · ` : ""}
              문단 {meeting.paragraphs.length}개
            </p>
          </div>
          {meeting.extractedDocument.pages.map((page, pageIndex) => (
            <section key={pageIndex} aria-label={page.pageNumber === null ? "TXT 문서" : `${page.pageNumber}페이지`}>
              <h3>{page.pageNumber === null ? "TXT 문서" : `${page.pageNumber}페이지`}</h3>
              {!page.paragraphs.length && <p className="small muted">추출된 텍스트가 없는 페이지입니다.</p>}
              {page.paragraphs.map((paragraph) => (
                <section
                  key={paragraph.paragraphNumber}
                  className="source-paragraph"
                  data-start-offset={paragraph.startOffset}
                  data-end-offset={paragraph.endOffset}
                >
                  <span className="paragraph-number" aria-label={`문단 ${paragraph.paragraphNumber}`}>
                    {String(paragraph.paragraphNumber).padStart(2, "0")}
                  </span>
                  <p>
                    {source?.page === page.pageNumber && source.paragraph === paragraph.paragraphNumber ? (
                      <mark aria-label="선택한 원문 근거">{paragraph.text}</mark>
                    ) : paragraph.text}
                  </p>
                </section>
              ))}
            </section>
          ))}
        </article>
      ) : meeting.format !== "PDF" ? (
        <article className="document-paper" aria-label="회의록 원문">
          <div className="paper-heading">
            <span>MEETING RECORD</span>
            <h2>{meeting.title}</h2>
            <p>
              {meeting.date} · {meeting.location || "장소 미입력"}
            </p>
          </div>
          {meeting.paragraphs.map((text, index) => (
            <section
              key={index}
              className="source-paragraph"
              id={`paragraph-${index + 1}`}
            >
              <span className="paragraph-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p>
                {source?.paragraph === index + 1 ? (
                  <mark aria-label="선택한 원문 근거">{text}</mark>
                ) : (
                  text
                )}
              </p>
            </section>
          ))}
        </article>
      ) : null}
      {source && (
        <p className="small muted">
          선택한 근거: 문단 {source.paragraph}. 문서·페이지·문단·문자 위치를
          연결하는 구조입니다.
        </p>
      )}
    </div>
  );
}

export function Overview({
  meetings,
  decisions,
  tasks,
  pendingCount,
  name,
  go,
}: {
  meetings: Meeting[];
  decisions: Decision[];
  tasks: Task[];
  pendingCount: number;
  name: string;
  go: Navigate;
}) {
  const reviewMeeting =
    meetings[0]?.status === "review" ? meetings[0] : undefined;
  const mine = tasks.filter(
    (task) => task.owner === name && task.status !== "완료",
  );
  return (
    <>
      <Heading
        title="오늘 확인할 일"
        description="회의록을 등록하고 AI가 추출한 내용을 검토합니다."
        action={
          <button
            className="button button-primary heading-action"
            onClick={() => go("upload")}
          >
            + 회의록 등록
          </button>
        }
      />
      <div className="stats-grid">
        <button className="card stat" onClick={() => go("decisions")}>
          <span>관리자 확인 대기</span>
          <strong>{pendingCount}</strong>
        </button>
        <button className="card stat" onClick={() => go("meetings")}>
          <span>저장된 회의록</span>
          <strong>{meetings.length}</strong>
        </button>
        <button className="card stat" onClick={() => go("tasks")}>
          <span>내 미완료 업무</span>
          <strong>{mine.length}</strong>
        </button>
      </div>
      <div className="overview-grid">
        <section className="card stack">
          <h2>최근 등록한 회의록</h2>
          {meetings.length ? (
            <>
              <div className="stack">
                <div className="row-between">
                  <h3>
                    {meetings[0].date.slice(5).replace("-", "월 ")}일 ·{" "}
                    {meetings[0].title}
                  </h3>
                  <StatusBadge status={meetings[0].status} />
                </div>
                <p className="muted">
                  결정 후보와 담당자·마감일을 원문과 함께 확인하세요.
                </p>
                <div>
                  <button
                    className="button button-primary"
                    onClick={() =>
                      go(
                        reviewMeeting ? "review" : "meeting",
                        (reviewMeeting ?? meetings[0]).id,
                      )
                    }
                  >
                    {reviewMeeting ? "추출 결과 검토" : "회의록 상세 보기"}
                  </button>
                </div>
              </div>
              <hr />
              <p className="muted">현재 유효한 결정</p>
              <h3>
                {(
                  decisions.find((decision) => !decision.exception) ||
                  decisions[0]
                )?.title || "아직 반영된 결정이 없습니다."}
              </h3>
              <div>
                <button className="text-button" onClick={() => go("decisions")}>
                  결정 사항 전체 보기 →
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              title="첫 회의록을 등록해 보세요"
              description="예시 회의록을 불러오면 검토와 결정 반영 흐름을 확인할 수 있습니다."
              action={
                <button
                  className="button button-secondary"
                  onClick={() => go("upload")}
                >
                  회의록 등록
                </button>
              }
            />
          )}
        </section>
        <section className="card stack">
          <div className="row-between">
            <h2>이번 주 할 일</h2>
            <span className="small muted">예시 기준일 10.13</span>
          </div>
          {mine.length ? (
            mine.slice(0, 3).map((task) => (
              <div className="task-summary" key={task.id}>
                <strong>{task.title}</strong>
                <p className="muted">
                  {task.dueDate.slice(5).replace("-", ".")} · {task.owner}
                </p>
                {task.recheck && (
                  <span className="badge badge-amber">재검토 필요</span>
                )}
              </div>
            ))
          ) : (
            <p className="muted">지정된 미완료 업무가 없습니다.</p>
          )}
          <button className="text-button" onClick={() => go("tasks")}>
            업무 확인 →
          </button>
        </section>
      </div>
      <p className="page-note">
        AI는 후보를 제시하며, 팀의 현재 결정은 관리자의 검토 후 반영됩니다.
      </p>
    </>
  );
}

export function MeetingList({
  meetings,
  go,
}: {
  meetings: Meeting[];
  go: Navigate;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const rows = meetings.filter(
    (meeting) =>
      `${meeting.title} ${meeting.author} ${meeting.tags}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!status || meeting.status === status),
  );
  return (
    <>
      <Heading
        title="회의록 저장 공간"
        description="원본 파일, 추출 결과, 회의 사진과 처리 상태를 한곳에서 확인합니다."
        action={
          <button
            className="button button-primary"
            onClick={() => go("upload")}
          >
            + 회의록 등록
          </button>
        }
      />
      <div className="toolbar">
        <label className="search-field">
          <span className="sr-only">회의록 검색</span>
          <input
            placeholder="제목·작성자·태그로 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span aria-hidden="true">⌕</span>
        </label>
        <select
          aria-label="회의록 상태 필터"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">전체 상태</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="small muted">총 {rows.length}개</span>
      </div>
      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>회의록 · 회의일 · 작성자</th>
                <th>분석 정보</th>
                <th>회의 사진</th>
                <th>확인</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((meeting) => (
                <tr key={meeting.id}>
                  <td>
                    <button
                      className="title-link"
                      onClick={() => go("meeting", meeting.id)}
                    >
                      {meeting.title}
                    </button>
                    <p className="small muted">
                      {meeting.date} · {meeting.author} · {meeting.format}
                    </p>
                    <p className="small muted">{meeting.tags}</p>
                  </td>
                  <td>
                    <StatusBadge status={meeting.status} />
                    <p className="small muted">
                      결정 후보 {meeting.candidates.length}개
                    </p>
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => go("meeting", `${meeting.id}/photos`)}
                    >
                      {meeting.photos.length
                        ? `사진 ${meeting.photos.length}장`
                        : "사진 추가"}
                    </button>
                  </td>
                  <td>
                    <button
                      className="button button-secondary small-button"
                      onClick={() =>
                        go(
                          meeting.status === "review" ||
                            meeting.status === "analyzing" ||
                            meeting.status === "failed"
                            ? "review"
                            : "meeting",
                          meeting.id,
                        )
                      }
                    >
                      {meeting.status === "review" ? "검토하기" : "보기"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title="표시할 회의록이 없습니다"
            description="검색 조건을 바꾸거나 첫 회의록을 등록해 주세요."
            action={
              <button
                className="button button-secondary"
                onClick={() => go("upload")}
              >
                회의록 등록
              </button>
            }
          />
        )}
      </div>
    </>
  );
}

export function MeetingDetail({
  meeting,
  members,
  initialTab,
  go,
  onSource,
  onAddPhotos,
  onPhotoChange,
  onPhotoDelete,
}: {
  meeting: Meeting;
  members: Member[];
  initialTab?: string;
  go: Navigate;
  onSource: (source: Evidence) => void;
  onAddPhotos: (files: File[]) => void;
  onPhotoChange: (photo: MeetingPhoto) => void;
  onPhotoDelete: (id: string) => void;
}) {
  const [tab, setTab] = useState(initialTab || "source");
  return (
    <>
      <button className="back-link" onClick={() => go("meetings")}>
        ← 회의록 저장 공간
      </button>
      <Heading
        title={meeting.title}
        description={`${meeting.date} · ${meeting.author} · ${meeting.location || "장소 미입력"}`}
        action={<StatusBadge status={meeting.status} />}
      />
      <div className="tabs" role="tablist" aria-label="회의록 상세">
        <button
          role="tab"
          aria-selected={tab === "source"}
          onClick={() => setTab("source")}
        >
          원문·기본 정보
        </button>
        <button
          role="tab"
          aria-selected={tab === "results"}
          onClick={() => setTab("results")}
        >
          AI 추출 결과 <span>{meeting.candidates.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "photos"}
          onClick={() => setTab("photos")}
        >
          회의 사진 <span>{meeting.photos.length}</span>
        </button>
      </div>
      {tab === "source" && (
        <section className="card">
          <SourceDocument meeting={meeting} />
        </section>
      )}
      {tab === "results" && (
        <section className="card stack">
          <div className="row-between">
            <h2>검토 및 처리 현황</h2>
            <StatusBadge status={meeting.status} />
          </div>
          <p className="muted">
            회의에서 확정한 항목을 검토 제출한 뒤, 관리자가 현재 결정으로
            반영합니다.
          </p>
          {meeting.candidates.map((candidate) => (
            <div className="list-row" key={candidate.id}>
              <div>
                <strong>{candidate.title}</strong>
                <p className="small muted">
                  {candidate.confirmed ? "회의에서 확정" : "제안·논의"} ·{" "}
                  {candidate.owner || "담당자 미확인"}
                </p>
              </div>
              <SourceButton source={candidate.evidence} onSource={onSource} />
            </div>
          ))}
          <div className="row-actions">
            <button
              className="button button-primary"
              onClick={() => go("review", meeting.id)}
            >
              {meeting.status === "submitted" || meeting.status === "done"
                ? "검토 결과 보기"
                : "추출 결과 검토"}
            </button>
            <button
              className="button button-secondary"
              onClick={() => go("decisions")}
            >
              결정 처리 현황 보기
            </button>
          </div>
        </section>
      )}
      {tab === "photos" && (
        <MeetingPhotos
          photos={meeting.photos}
          members={members}
          onAdd={onAddPhotos}
          onChange={onPhotoChange}
          onDelete={onPhotoDelete}
        />
      )}
    </>
  );
}

export function ReviewPage({
  meeting,
  members,
  go,
  onSource,
  onEdit,
  onSubmit,
  onStatus,
}: {
  meeting: Meeting;
  members: Member[];
  go: Navigate;
  onSource: (source: Evidence) => void;
  onEdit: (candidate: Candidate) => void;
  onSubmit: () => void;
  onStatus: (status: Meeting["status"]) => void;
}) {
  const locked = meeting.status === "submitted" || meeting.status === "done";
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button className="back-link" onClick={() => go("meeting", meeting.id)}>
        ← {meeting.title}
      </button>
      <Heading
        title={
          meeting.status === "analyzing"
            ? "회의록을 분석하고 있습니다"
            : meeting.status === "failed"
              ? "분석을 완료하지 못했습니다"
              : "AI 추출 결과 검토"
        }
        description="원문과 비교하여 수정하고, 회의에서 확정한 결정인지 확인합니다."
        action={<StatusBadge status={meeting.status} />}
      />
      {meeting.status === "analyzing" ? (
        <section className="card analysis-state">
          <div className="spinner" />
          <h2>예시 분석 흐름 진행 중</h2>
          <p className="muted">문서 준비 → 결정 후보 추출 → 사용자 검토</p>
          <p className="small muted">
            외부 AI를 호출하지 않는 화면 시연입니다.
          </p>
          <button
            className="button button-secondary"
            onClick={() => onStatus("failed")}
          >
            실패 상황 확인
          </button>
        </section>
      ) : meeting.status === "failed" ? (
        <section className="card analysis-state">
          <span className="failure-symbol">!</span>
          <h2>분석 요청에 실패했습니다</h2>
          <p className="muted">
            원본 회의록은 그대로 유지됩니다. 분석만 다시 요청할 수 있습니다.
          </p>
          <button
            className="button button-primary"
            onClick={() => onStatus("analyzing")}
          >
            분석 재시도
          </button>
        </section>
      ) : meeting.status === "ready" ? (
        <section className="card">
          <EmptyState
            title="실제 AI 분석은 아직 연결되지 않았습니다"
            description="원문 탭에서 서버가 추출한 텍스트와 문단을 확인할 수 있습니다. 예시 회의록을 등록하면 AI 분석 이후 화면을 시연할 수 있습니다."
            action={
              <button
                className="button button-primary"
                onClick={() => go("upload")}
              >
                예시 회의록 등록하기
              </button>
            }
          />
        </section>
      ) : (
        <>
          <div className="notice-message">
            {locked
              ? "검토 제출이 완료되었습니다. 현재 유효한 결정은 관리자 처리 이후 갱신됩니다."
              : "AI가 제시한 예시 후보입니다. 원문에 없는 담당자·마감일은 빈칸으로 남겨 주세요."}
          </div>
          <div className="stack">
            {meeting.candidates.map((candidate, index) => (
              <section className="card candidate-card" key={candidate.id}>
                <div className="row-between">
                  <div className="row-actions">
                    <span className="number-label">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`badge ${candidate.confirmed ? "" : "badge-gray"}`}
                    >
                      {candidate.confirmed ? "회의에서 확정" : "제안·논의"}
                    </span>
                  </div>
                  <SourceButton
                    source={candidate.evidence}
                    onSource={onSource}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`title-${candidate.id}`}>
                    결정·제안 내용
                  </label>
                  <input
                    id={`title-${candidate.id}`}
                    value={candidate.title}
                    disabled={locked}
                    onChange={(event) =>
                      onEdit({ ...candidate, title: event.target.value })
                    }
                  />
                </div>
                <div className="candidate-fields">
                  <div className="field">
                    <label htmlFor={`owner-${candidate.id}`}>담당자</label>
                    <select
                      id={`owner-${candidate.id}`}
                      disabled={locked}
                      value={candidate.owner}
                      onChange={(event) =>
                        onEdit({ ...candidate, owner: event.target.value })
                      }
                    >
                      <option value="">미확인</option>
                      {members.map((member) => (
                        <option key={member.id}>{member.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`due-${candidate.id}`}>마감일</label>
                    <input
                      id={`due-${candidate.id}`}
                      type="date"
                      disabled={locked}
                      value={candidate.dueDate}
                      onChange={(event) =>
                        onEdit({ ...candidate, dueDate: event.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`confirmed-${candidate.id}`}>
                      확정 여부
                    </label>
                    <select
                      id={`confirmed-${candidate.id}`}
                      disabled={locked}
                      value={candidate.confirmed ? "confirmed" : "proposal"}
                      onChange={(event) =>
                        onEdit({
                          ...candidate,
                          confirmed: event.target.value === "confirmed",
                        })
                      }
                    >
                      <option value="confirmed">회의에서 확정</option>
                      <option value="proposal">제안·논의</option>
                    </select>
                  </div>
                </div>
              </section>
            ))}
          </div>
          <div className="review-footer">
            <p className="muted">
              확정 항목{" "}
              {
                meeting.candidates.filter((candidate) => candidate.confirmed)
                  .length
              }
              개만 기존 결정과 비교합니다.
            </p>
            <div className="row-actions">
              <button
                className="button button-secondary"
                onClick={() => go("meeting", meeting.id)}
              >
                회의록 상세로
              </button>
              {locked ? (
                <button
                  className="button button-primary"
                  onClick={() => go("decisions")}
                >
                  결정 처리 현황 보기
                </button>
              ) : (
                <button
                  className="button button-primary"
                  disabled={meeting.candidates.some(
                    (candidate) => !candidate.title.trim(),
                  )}
                  onClick={() => setConfirmOpen(true)}
                >
                  검토 결과 제출
                </button>
              )}
            </div>
          </div>
          {confirmOpen && (
            <div
              className="inline-confirm"
              role="region"
              aria-label="검토 제출 확인"
            >
              <strong>검토 결과를 제출할까요?</strong>
              <p>
                제안·논의는 기록으로 남고, 확정 항목은 관리자 확인 대상으로
                전달됩니다.
              </p>
              <div className="row-actions">
                <button
                  className="button button-secondary"
                  onClick={() => setConfirmOpen(false)}
                >
                  계속 검토
                </button>
                <button
                  className="button button-primary"
                  onClick={() => {
                    setConfirmOpen(false);
                    onSubmit();
                  }}
                >
                  제출 확인
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
