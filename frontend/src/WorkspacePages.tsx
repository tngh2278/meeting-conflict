import { useState } from "react";
import { daysLeft, resolutionLabels } from "./demo-data";
import type {
  Candidate,
  ChangeRecord,
  Decision,
  Evidence,
  Meeting,
  Member,
  Navigate,
  Role,
  Task,
  Team,
} from "./demo-data";
import { EmptyState, Heading, SourceButton } from "./MeetingPages";
import Modal from "./components/Modal";
import { searchUserByEmail, type UserSearchResult } from "./lib/teams";

export function DecisionsPage({
  meetings,
  decisions,
  history,
  role,
  go,
  onSource,
  onResolve,
}: {
  meetings: Meeting[];
  decisions: Decision[];
  history: ChangeRecord[];
  role: Role;
  go: Navigate;
  onSource: (source: Evidence) => void;
  onResolve: (meeting: Meeting, candidate: Candidate) => void;
}) {
  const [tab, setTab] = useState(role === "admin" ? "pending" : "current");
  const pending = meetings.flatMap((meeting) =>
    meeting.status === "submitted"
      ? meeting.candidates
          .filter((candidate) => candidate.confirmed && !candidate.resolution)
          .map((candidate) => ({ meeting, candidate }))
      : [],
  );
  const held = meetings.flatMap((meeting) =>
    meeting.candidates
      .filter((candidate) => candidate.resolution === "hold")
      .map((candidate) => ({ meeting, candidate })),
  );
  return (
    <>
      <Heading
        title="결정 사항"
        description="검토가 끝난 후보를 비교하고, 현재 유효한 결정과 변경 이력을 확인합니다."
      />
      <div className="tabs" role="tablist" aria-label="결정 상태">
        <button
          role="tab"
          aria-selected={tab === "pending"}
          onClick={() => setTab("pending")}
        >
          처리 대기 <span>{pending.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "current"}
          onClick={() => setTab("current")}
        >
          현재 유효 <span>{decisions.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "held"}
          onClick={() => setTab("held")}
        >
          보류 <span>{held.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => setTab("history")}
        >
          변경 이력 <span>{history.length}</span>
        </button>
      </div>
      {tab === "pending" && (
        <>
          <div className="notice-message">
            {role === "admin"
              ? "관리자가 원문과 변경 사유를 확인한 뒤 최종 처리합니다."
              : "일반 팀원은 비교 내용과 처리 현황을 조회할 수 있습니다. 최종 결정 반영은 관리자가 진행합니다."}
          </div>
          <div className="stack">
            {pending.map(({ meeting, candidate }) => (
              <section className="card stack" key={candidate.id}>
                <div className="row-between">
                  <span
                    className={`badge ${candidate.kind === "change" ? "badge-amber" : ""}`}
                  >
                    {candidate.kind === "change"
                      ? "명시적 변경 후보"
                      : "신규 결정 후보"}
                  </span>
                  <span className="small muted">
                    {meeting.date} · {meeting.title}
                  </span>
                </div>
                <h2>{candidate.title}</h2>
                <p className="muted">
                  {candidate.kind === "change"
                    ? "기존 18:00 → 신규 20:00 · 같은 행사와 같은 날짜의 마감 변경"
                    : `${candidate.owner || "담당자 미확인"} · ${candidate.dueDate || "기한 미확인"}`}
                </p>
                <div className="row-actions">
                  <button
                    className="button button-primary"
                    onClick={() => onResolve(meeting, candidate)}
                  >
                    {role === "admin" ? "비교·처리하기" : "비교 내용 보기"}
                  </button>
                  <SourceButton
                    source={candidate.evidence}
                    onSource={onSource}
                  />
                </div>
              </section>
            ))}
            {!pending.length && (
              <section className="card">
                <EmptyState
                  title="관리자 확인을 기다리는 결정이 없습니다"
                  description="회의록의 추출 결과를 검토 제출하면 확정 항목이 여기에 표시됩니다."
                  action={
                    <button
                      className="button button-secondary"
                      onClick={() => go("meetings")}
                    >
                      회의록 확인
                    </button>
                  }
                />
              </section>
            )}
          </div>
        </>
      )}
      {tab === "current" && (
        <section className="card stack">
          <div className="row-between">
            <h2>현재 유효한 결정</h2>
            <span className="small muted">관리자 처리 결과 반영</span>
          </div>
          {decisions.map((decision) => (
            <div className="list-row" key={decision.id}>
              <div>
                <span
                  className={`badge ${decision.exception ? "badge-amber" : ""}`}
                >
                  {decision.exception ? "예외 적용" : "유효"}
                </span>
                <h3>{decision.title}</h3>
                <p className="small muted">
                  {decision.owner || "담당자 미확인"} ·{" "}
                  {decision.dueDate || "기한 미확인"}
                </p>
              </div>
              <SourceButton source={decision.evidence} onSource={onSource} />
            </div>
          ))}
          {!decisions.length && (
            <EmptyState
              title="반영된 결정이 없습니다"
              description="검토와 관리자 처리가 끝나면 현재 유효한 결정이 표시됩니다."
            />
          )}
        </section>
      )}
      {tab === "held" && (
        <section className="card stack">
          <h2>논의 중으로 보류한 항목</h2>
          {held.map(({ meeting, candidate }) => (
            <div className="list-row" key={candidate.id}>
              <div>
                <strong>{candidate.title}</strong>
                <p className="small muted">보류 사유: {candidate.reason}</p>
              </div>
              <button
                className="button button-secondary"
                onClick={() => onResolve(meeting, candidate)}
              >
                {role === "admin" ? "다시 검토" : "내용 보기"}
              </button>
            </div>
          ))}
          {!held.length && (
            <EmptyState
              title="보류 중인 결정이 없습니다"
              description="추가 논의가 필요한 항목을 현재 유효 결정과 분리해 관리합니다."
            />
          )}
        </section>
      )}
      {tab === "history" && (
        <section className="card stack">
          <h2>결정 변경 이력</h2>
          {history.map((record) => (
            <article className="history-item" key={record.id}>
              <div className="row-between">
                <strong>{resolutionLabels[record.method]}</strong>
                <span className="small muted">
                  {record.at} · {record.actor}
                </span>
              </div>
              <h3>{record.title}</h3>
              <div className="history-comparison">
                <p>
                  <span>이전</span>
                  {record.before}
                </p>
                <p>
                  <span>처리 후</span>
                  {record.after}
                </p>
              </div>
              <p className="muted">사유: {record.reason}</p>
              <SourceButton source={record.evidence} onSource={onSource} />
            </article>
          ))}
          {!history.length && (
            <EmptyState
              title="아직 처리 이력이 없습니다"
              description="결정을 처리하면 이전·이후 내용과 처리자·사유가 기록됩니다."
            />
          )}
        </section>
      )}
    </>
  );
}

export function TasksPage({
  tasks,
  user,
  role,
  onUpdate,
  go,
}: {
  tasks: Task[];
  user: Member;
  role: Role;
  onUpdate: (task: Task) => void;
  go: Navigate;
}) {
  const [all, setAll] = useState(false);
  const rows = tasks.filter(
    (task) => (role === "admin" && all) || task.owner === user.name,
  );
  return (
    <>
      <Heading
        title="내 업무"
        description="담당 업무와 마감일을 확인하고, 결정 변경으로 재검토할 항목을 관리합니다."
        action={
          role === "admin" && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={all}
                onChange={(event) => setAll(event.target.checked)}
              />
              팀 전체 보기
            </label>
          )
        }
      />
      <p className="page-note">
        D-Day는 시연 데이터 기준일인 2026년 10월 13일을 기준으로 표시합니다.
      </p>
      <section className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>업무</th>
                <th>담당자</th>
                <th>마감일</th>
                <th>진행 상태</th>
                <th>연결된 결정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => (
                <tr key={task.id}>
                  <td>
                    <strong>{task.title}</strong>
                    {task.recheck && (
                      <div>
                        <span className="badge badge-amber">재검토 필요</span>
                      </div>
                    )}
                  </td>
                  <td>{task.owner}</td>
                  <td>
                    {task.dueDate}{" "}
                    <span className="badge badge-gray">
                      {daysLeft(task.dueDate)}
                    </span>
                  </td>
                  <td>
                    <select
                      aria-label={`${task.title} 진행 상태`}
                      value={task.status}
                      onChange={(event) =>
                        onUpdate({
                          ...task,
                          status: event.target.value as Task["status"],
                        })
                      }
                    >
                      {["대기", "진행 중", "완료"].map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => go("decisions")}
                    >
                      결정 보기 ↗
                    </button>
                    {task.recheck && (
                      <button
                        className="text-button"
                        onClick={() => onUpdate({ ...task, recheck: false })}
                      >
                        재검토 완료
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <EmptyState
            title="담당 업무가 없습니다"
            description="확정된 결정과 연결된 담당 업무가 여기에 표시됩니다."
          />
        )}
      </section>
    </>
  );
}

type ChatMessage = { question: string; answer: string; source?: Evidence };
export function ChatPage({
  decisions,
  onSource,
}: {
  decisions: Decision[];
  onSource: (source: Evidence) => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  function send(question: string) {
    if (!question.trim()) return;
    const current =
      decisions.find((decision) => decision.id === "decision-deadline") ||
      decisions.find((decision) => !decision.exception) ||
      decisions[0];
    const exceptionNote = decisions.some((decision) => decision.exception)
      ? " 별도 예외 항목이 있으므로 적용 조건은 결정 사항에서 확인해 주세요."
      : "";
    setMessages((items) => [
      ...items,
      {
        question,
        answer: current
          ? `현재 유효한 결정은 “${current.title}”입니다. 담당자는 ${current.owner || "미확인"}입니다. 아래 원문 근거에서 확인할 수 있습니다.${exceptionNote}`
          : "현재 팀에 반영된 결정이 없어 근거를 제시할 수 없습니다. 회의록 검토와 관리자 처리를 먼저 진행해 주세요.",
        source: current?.evidence,
      },
    ]);
    setInput("");
  }
  return (
    <>
      <Heading
        title="근거 기반 AI 질문"
        description="팀의 현재 결정과 원문 근거를 함께 확인합니다."
      />
      <div className="notice-message">
        화면 시연에서는 현재 유효한 결정에 대한 고정 형식의 예시 답변을
        표시합니다. 실제 AI 답변 생성은 연결 전입니다.
      </div>
      <section className="card chat-card">
        <div className="chat-messages" aria-live="polite">
          {!messages.length && (
            <div className="chat-welcome">
              <span className="chat-mark">Q</span>
              <h2>지난 회의의 결정이 궁금한가요?</h2>
              <p className="muted">답변의 근거를 원문으로 직접 확인하세요.</p>
              <div className="row-actions">
                <button
                  className="button button-secondary"
                  onClick={() => send("현재 자료 제출 마감은 언제인가요?")}
                >
                  현재 자료 제출 마감은?
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => send("현재 결정의 담당자는 누구인가요?")}
                >
                  담당자는 누구인가요?
                </button>
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div className="chat-turn" key={index}>
              <div className="chat-question">{message.question}</div>
              <div className="chat-answer">
                <span className="badge badge-gray">예시 답변</span>
                <p>{message.answer}</p>
                {message.source && (
                  <SourceButton source={message.source} onSource={onSource} />
                )}
              </div>
            </div>
          ))}
        </div>
        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <label className="sr-only" htmlFor="chat-question">
            질문 입력
          </label>
          <input
            id="chat-question"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="회의록과 결정에 대해 질문해 보세요"
          />
          <button className="button button-primary" disabled={!input.trim()}>
            질문 보내기
          </button>
        </form>
      </section>
    </>
  );
}

export function TeamPage({
  team,
  role,
  currentUser,
  onAdd,
  onRole,
  onRemove,
  onLeave,
  onCreate,
}: {
  team: Team;
  role: Role;
  currentUser: Member;
  onAdd: (member: Member) => void;
  onRole: (id: string, role: Role) => void;
  onRemove: (id: string) => void;
  onLeave: () => void;
  onCreate: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<UserSearchResult | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const pendingMembers = team.pendingMembers ?? [];

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSearching(true);
    setSearchError(null);
    setHasSearched(false);
    try {
      const found = await searchUserByEmail(email);
      setResult(found);
      setHasSearched(true);
    } catch (err: unknown) {
      setSearchError(
        err instanceof Error ? err.message : "검색 중 오류가 발생했습니다.",
      );
      setResult(null);
      setHasSearched(true);
    } finally {
      setSearching(false);
    }
  }

  function closeAdding() {
    setAdding(false);
    setEmail("");
    setResult(null);
    setSearchError(null);
    setHasSearched(false);
  }

  // 검색 결과가 이미 정식 팀원이거나 초대 대기 중인지 판별
  const isAlreadyMember = result
    ? team.members.some((member) => member.id === result.id) ||
      pendingMembers.some((member) => member.id === result.id)
    : false;

  return (
    <>
      <Heading
        title="팀 관리"
        description="가입된 사용자를 팀에 초대하고, 역할별 접근 권한을 관리합니다."
        action={
          <div className="row-actions">
            <button className="button button-secondary" onClick={onCreate}>
              새 팀 만들기
            </button>
            <button
              className="text-button danger-text"
              onClick={() => setLeaving(true)}
            >
              팀 나가기
            </button>
            {role === "admin" && (
              <button
                className="button button-primary"
                onClick={() => setAdding(true)}
              >
                + 팀원 초대
              </button>
            )}
          </div>
        }
      />
      <div className="card stack">
        <div className="row-between">
          <div>
            <span className="small muted">WORKSPACE</span>
            <h2>{team.name}</h2>
          </div>
          <span className="badge">팀원 {team.members.length}명</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>팀원</th>
                <th>사용자 ID</th>
                <th>역할</th>
                {role === "admin" && <th> </th>}
              </tr>
            </thead>
            <tbody>
              {team.members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <span className="avatar small-avatar">
                      {member.name.slice(-2)}
                    </span>
                    <strong>{member.name}</strong>
                    {member.id === currentUser.id && (
                      <span className="small muted"> · 나</span>
                    )}
                  </td>
                  <td>
                    <code className="small muted">
                      {member.id.slice(0, 8)}…
                    </code>
                  </td>
                  <td>
                    {role === "admin" ? (
                      <select
                        aria-label={`${member.name} 팀 역할`}
                        value={member.role}
                        onChange={(event) =>
                          onRole(member.id, event.target.value as Role)
                        }
                      >
                        <option value="admin">관리자</option>
                        <option value="member">일반 팀원</option>
                      </select>
                    ) : member.role === "admin" ? (
                      "관리자"
                    ) : (
                      "일반 팀원"
                    )}
                  </td>
                  {role === "admin" && (
                    <td>
                      {member.id !== currentUser.id && (
                        <button
                          className="text-button danger-text"
                          onClick={() => setRemovingId(member.id)}
                        >
                          제거
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {role === "admin" && pendingMembers.length > 0 && (
          <div className="subtle-panel stack">
            <div className="row-between">
              <h3>초대 대기중</h3>
              <span className="small muted">수락 전까지 정식 팀원이 아닙니다</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>초대한 사용자</th>
                    <th>사용자 ID</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingMembers.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <span className="avatar small-avatar">
                          {member.name.slice(-2)}
                        </span>
                        <strong>{member.name}</strong>
                      </td>
                      <td>
                        <code className="small muted">
                          {member.id.slice(0, 8)}…
                        </code>
                      </td>
                      <td>
                        <span className="badge badge-amber">수락 대기</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <section className="card permissions-card">
        <h2>역할별 권한</h2>
        <div className="permissions-grid">
          <div>
            <span className="badge badge-gray">일반 팀원</span>
            <p>
              회의록 등록 · 추출 결과 검수·수정 · 결정·원문·이력 조회 · 회의
              사진 검수
            </p>
          </div>
          <div>
            <span className="badge">관리자</span>
            <p>
              일반 팀원 기능 + 팀원 초대·권한 변경·팀원 제거 + 충돌 처리·최종 결정
              반영
            </p>
          </div>
        </div>
      </section>
      {adding && (
        <Modal title="팀원 초대" onClose={closeAdding}>
          <div className="stack">
            <p className="muted">
              서비스에 가입된 사용자를 이메일로 검색해 초대합니다. 초대받은
              사용자가 로그인 후 수락하면 정식 팀원으로 표시됩니다.
            </p>
            <form className="row-actions" onSubmit={handleSearch}>
              <input
                type="email"
                required
                aria-label="초대할 팀원 이메일"
                placeholder="가입자 이메일"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setResult(null);
                  setSearchError(null);
                }}
              />
              <button
                className="button button-secondary"
                disabled={searching || !email.trim()}
              >
                {searching ? "검색 중…" : "검색"}
              </button>
            </form>
            {searchError && (
              <p className="error-message" role="status">
                검색 실패: {searchError}
              </p>
            )}
            {!hasSearched && email.trim() && !searching && (
              <p className="small muted">
                검색 버튼을 눌러 가입자를 찾습니다.
              </p>
            )}
            {result && (
              <div className="subtle-panel stack">
                <strong>{result.name}</strong>
                <p className="small muted">{result.email}</p>
                {isAlreadyMember ? (
                  <p className="muted">이미 이 팀에 소속되었거나 초대 대기 중인 사용자입니다.</p>
                ) : (
                  <button
                    className="button button-primary"
                    onClick={() => {
                      onAdd({
                        id: result.id,
                        name: result.name,
                        email: result.email,
                        role: "member",
                      });
                      closeAdding();
                    }}
                  >
                    초대 보내기
                  </button>
                )}
              </div>
            )}
            {hasSearched && !result && !searchError && (
              <p className="small muted">
                가입자를 찾지 못했습니다. 이메일을 확인해 주세요.
              </p>
            )}
          </div>
        </Modal>
      )}
      {removingId && (
        <Modal
          title="팀원을 제거할까요?"
          onClose={() => setRemovingId(null)}
        >
          <div className="stack">
            <p>
              <strong>
                {team.members.find((member) => member.id === removingId)?.name}
              </strong>
              님을 이 팀에서 제거합니다. 제거된 사용자는 이 팀의 회의록·결정·업무에
              더 이상 접근할 수 없습니다.
            </p>
            <div className="row-actions">
              <button
                className="button button-secondary"
                onClick={() => setRemovingId(null)}
              >
                취소
              </button>
              <button
                className="button button-danger"
                onClick={() => {
                  onRemove(removingId);
                  setRemovingId(null);
                }}
              >
                제거
              </button>
            </div>
          </div>
        </Modal>
      )}
      {leaving && (
        <Modal title="팀에서 나갈까요?" onClose={() => setLeaving(false)}>
          <div className="stack">
            <p>
              <strong>{team.name}</strong> 팀에서 나갑니다. 이 팀의 회의록·결정·업무
              데이터는 팀에 남아 있으며, 다시 초대받아 수락해야 볼 수 있습니다.
            </p>
            {role === "admin" &&
              team.members.filter((member) => member.role === "admin")
                .length === 1 && (
                <p className="notice-message">
                  현재 회원님이 이 팀의 유일한 관리자입니다. 다른 팀원을 관리자로
                  지정한 뒤 나가거나, 팀을 삭제해야 합니다.
                </p>
              )}
            <div className="row-actions">
              <button
                className="button button-secondary"
                onClick={() => setLeaving(false)}
              >
                취소
              </button>
              <button
                className="button button-danger"
                onClick={() => {
                  onLeave();
                  setLeaving(false);
                }}
              >
                팀 나가기
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export type FaceProfile = { consent: boolean; url: string };
export function ProfilePage({
  user,
  profile,
  onChange,
  createUrl,
  onWithdraw,
}: {
  user: Member;
  profile: FaceProfile;
  onChange: (profile: FaceProfile) => void;
  createUrl: (file: File) => string;
  onWithdraw: () => void;
}) {
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Heading
        title="내 정보·얼굴 정보 관리"
        description="본인의 기준 얼굴 사진과 처리 동의를 관리합니다."
      />
      <div className="profile-grid">
        <section className="card stack">
          <div className="profile-avatar">
            {profile.url ? (
              <img src={profile.url} alt="내 기준 얼굴 사진" />
            ) : (
              <span>{user.name.slice(-2)}</span>
            )}
          </div>
          <h2>{user.name}</h2>
          <p className="muted">{user.email}</p>
          <span className="badge">
            {profile.url ? "기준 얼굴 사진 선택됨" : "기준 얼굴 사진 미등록"}
          </span>
        </section>
        <section className="card stack">
          <h2>얼굴 정보 처리 동의</h2>
          <p>
            회의 사진에서 본인의 일치 후보를 찾는 용도로 기준 얼굴 사진을
            사용합니다.
          </p>
          <div className="subtle-panel">
            <p>
              <strong>시연 보유 기간</strong> · 새로고침 또는 동의 철회 전까지
            </p>
            <p className="small muted">
              실제 얼굴 특징 추출이나 서버 저장은 실행되지 않습니다.
            </p>
          </div>
          <label className="check-line">
            <input
              type="checkbox"
              checked={profile.consent}
              onChange={(event) => {
                if (!event.target.checked) setConfirming(true);
                else onChange({ ...profile, consent: true });
              }}
            />
            처리 목적과 보유 기간을 확인하고 동의합니다.
          </label>
          <label
            className={`button button-secondary file-label ${!profile.consent ? "is-disabled" : ""}`}
          >
            {profile.url ? "기준 사진 교체" : "기준 사진 등록"}
            <input
              aria-label="기준 얼굴 JPEG 사진 선택"
              type="file"
              hidden
              disabled={!profile.consent}
              accept=".jpg,.jpeg,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (
                  !/\.jpe?g$/i.test(file.name) ||
                  file.type !== "image/jpeg" ||
                  !file.size ||
                  file.size > 10 * 1024 * 1024
                ) {
                  setError("10 MB 이하의 JPEG 사진을 선택해 주세요.");
                  return;
                }
                setError("");
                onChange({ ...profile, url: createUrl(file) });
              }}
            />
          </label>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button
            className="text-button danger-text"
            onClick={() => setConfirming(true)}
          >
            동의 철회·얼굴 정보 삭제
          </button>
        </section>
      </div>
      {confirming && (
        <Modal
          title="얼굴 정보 처리를 중단할까요?"
          onClose={() => setConfirming(false)}
        >
          <div className="stack">
            <p>
              현재 시연의 기준 얼굴 사진과 본인에 연결된 얼굴 대조 정보를
              제거합니다.
            </p>
            <div className="row-actions">
              <button
                className="button button-secondary"
                onClick={() => setConfirming(false)}
              >
                취소
              </button>
              <button
                className="button button-danger"
                onClick={() => {
                  onWithdraw();
                  setConfirming(false);
                }}
              >
                동의 철회·삭제
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
