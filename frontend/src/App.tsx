import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import "./workspace.css";
import Modal from "./components/Modal";
import UploadPage from "./UploadPage";
// import ServerConnectionStatus from "./components/ServerConnectionStatus";
import AuthDialog from "./components/AuthDialog";
import { useAuth } from "./hooks/useAuth";
import type { AuthUser } from "./hooks/useAuth";
import {
  demoUsers,
  exampleCandidates,
  initialDecisions,
  initialMeetings,
  initialTasks,
  initialTeams,
  newParagraphs,
  resolutionLabels,
} from "./demo-data";
import type {
  Candidate,
  ChangeRecord,
  Decision,
  Evidence,
  Meeting,
  MeetingPhoto,
  Member,
  Page,
  Resolution,
  Task,
  Team,
  UploadDraft,
} from "./demo-data";
import {
  EmptyState,
  MeetingDetail,
  MeetingList,
  Overview,
  ReviewPage,
  SourceButton,
  SourceDocument,
} from "./MeetingPages";
import {
  ChatPage,
  DecisionsPage,
  ProfilePage,
  TasksPage,
  TeamPage,
} from "./WorkspacePages";
import type { FaceProfile } from "./WorkspacePages";

const menuItems: { page: Page; label: string }[] = [
  { page: "overview", label: "개요" },
  { page: "meetings", label: "회의록" },
  { page: "decisions", label: "결정 사항" },
  { page: "tasks", label: "내 업무" },
  { page: "chat", label: "AI 질문" },
  { page: "team", label: "팀 관리" },
];
type DialogName =
  | "login"
  | "signup"
  | "help"
  | "logout"
  | "teams"
  | "newteam"
  | "notifications"
  | "resolve"
  | null;
function readRoute() {
  const [page, id, tab] = window.location.hash.replace(/^#\/?/, "").split("/");
  const allowed: Page[] = [
    "overview",
    "meetings",
    "upload",
    "meeting",
    "review",
    "decisions",
    "tasks",
    "chat",
    "team",
    "profile",
  ];
  return {
    page: allowed.includes(page as Page)
      ? (page as Page)
      : ("overview" as Page),
    id,
    tab,
  };
}

export default function App() {
  // === Supabase 인증 + 데모 사용자 하이브리드 ===
  // useAuth: Supabase 세션 관리 (실제 로그인)
  const { user: authUser, loading, signIn, signUp, signOut } = useAuth();
  // demoUser: 시연용 데모 계정 (Supabase 없이도 동작)
  const [demoUser, setDemoUser] = useState<Member | null>(null);

  // AuthUser -> Member 타입 매핑 (Supabase 사용자를 Member로 변환)
  const memberFromAuth = (auth: AuthUser): Member => ({
    id: auth.id,
    name: auth.name,
    email: auth.email,
    role: auth.role,
  });

  // 최종 user: Supabase 로그인이 우선, 없으면 데모 사용자
  const user: Member | null = authUser ? memberFromAuth(authUser) : demoUser;
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [teamId, setTeamId] = useState("service");
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings);
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions);
  const [history, setHistory] = useState<ChangeRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [profiles, setProfiles] = useState<Record<string, FaceProfile>>({});
  const [route, setRoute] = useState(readRoute);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [source, setSource] = useState<Evidence | null>(null);
  const [resolveTarget, setResolveTarget] = useState<{
    meetingId: string;
    candidateId: string;
  } | null>(null);
  const [toast, setToast] = useState("");
  const [notifications, setNotifications] = useState([
    {
      id: "welcome",
      teamId: "service",
      text: "행사 준비 회의의 추출 결과를 검토해 주세요.",
    },
  ]);
  const [teamName, setTeamName] = useState("");
  const urls = useRef<string[]>([]);
  const activeTeam = teams.find((team) => team.id === teamId) || teams[0];
  const role =
    activeTeam.members.find((member) => member.id === user?.id)?.role ||
    "member";
  const teamMeetings = meetings.filter(
    (meeting) => meeting.teamId === activeTeam.id,
  );
  const teamDecisions = decisions.filter(
    (decision) => decision.teamId === activeTeam.id,
  );
  const teamTasks = tasks.filter((task) => task.teamId === activeTeam.id);
  const teamHistory = history.filter(
    (record) => record.teamId === activeTeam.id,
  );
  const currentMeeting = teamMeetings.find(
    (meeting) => meeting.id === route.id,
  );
  const sourceMeeting = teamMeetings.find(
    (meeting) => meeting.id === source?.documentId,
  );
  const targetMeeting = teamMeetings.find(
    (meeting) => meeting.id === resolveTarget?.meetingId,
  );
  const targetCandidate = targetMeeting?.candidates.find(
    (candidate) => candidate.id === resolveTarget?.candidateId,
  );
  const pendingCount = teamMeetings.flatMap((meeting) =>
    meeting.status === "submitted"
      ? meeting.candidates.filter(
          (candidate) => candidate.confirmed && !candidate.resolution,
        )
      : [],
  ).length;
  const unread = notifications.filter((item) => item.teamId === activeTeam.id);
  const analyzing = meetings
    .filter((meeting) => meeting.status === "analyzing")
    .map((meeting) => meeting.id)
    .join(",");

  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
      setSource(null);
      setDialog(null);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(
    () => () => urls.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!analyzing) return;
    const ids = analyzing.split(",");
    const timer = window.setTimeout(
      () =>
        setMeetings((items) =>
          items.map((meeting) =>
            ids.includes(meeting.id) && meeting.status === "analyzing"
              ? { ...meeting, status: "review" }
              : meeting,
          ),
        ),
      2200,
    );
    return () => window.clearTimeout(timer);
  }, [analyzing]);

  function go(page: Page, id?: string) {
    setDialog(null);
    setSource(null);
    const hash = `#/${page}${id ? `/${id}` : ""}`;
    window.location.hash = hash;
    setRoute(readRoute());
    window.scrollTo(0, 0);
  }
  function recordNotice(text: string) {
    setToast(text);
    setNotifications((items) => [
      { id: crypto.randomUUID(), teamId: activeTeam.id, text },
      ...items,
    ]);
  }
  function login(account: Member) {
    // 데모 로그인: Supabase 호출 없이 demoUser만 설정
    setDemoUser(account);
    setTeamId(
      teams.find((team) =>
        team.members.some((member) => member.id === account.id),
      )?.id || "service",
    );
    go("overview");
  }
  function createUrl(file: File) {
    const type = /\.pdf$/i.test(file.name)
      ? "application/pdf"
      : /\.jpe?g$/i.test(file.name)
        ? "image/jpeg"
        : "text/plain;charset=utf-8";
    const url = URL.createObjectURL(new Blob([file], { type }));
    urls.current.push(url);
    return url;
  }
  function makePhoto(file: File): MeetingPhoto {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      url: createUrl(file),
      example: false,
      reviewed: false,
      consent: true,
      addressStatus: "missing-gps",
      faces: [],
    };
  }
  function releaseUrl(url?: string) {
    if (!url) return;
    URL.revokeObjectURL(url);
    urls.current = urls.current.filter((item) => item !== url);
  }
  function updateMeeting(id: string, update: (meeting: Meeting) => Meeting) {
    setMeetings((items) =>
      items.map((meeting) =>
        meeting.id === id && meeting.teamId === activeTeam.id
          ? update(meeting)
          : meeting,
      ),
    );
  }
  function saveDraft(draft: UploadDraft) {
    if (!user) return;
    const id = crypto.randomUUID();
    const candidates = draft.example
      ? exampleCandidates(id).map((candidate) =>
          teamDecisions.length
            ? candidate
            : { ...candidate, kind: "new" as const },
        )
      : [];
    const meeting: Meeting = {
      id,
      teamId: activeTeam.id,
      title: draft.title,
      date: draft.date,
      location: draft.location,
      author: user.name,
      fileName: draft.file.name,
      fileUrl: createUrl(draft.file),
      format: /\.pdf$/i.test(draft.file.name) ? "PDF" : "TXT",
      tags: draft.tags,
      paragraphs: draft.example
        ? newParagraphs
        : draft.text.split(/\n\s*\n/).filter(Boolean),
      status: draft.example ? "analyzing" : "ready",
      example: draft.example,
      candidates,
      photos: draft.photos.map(makePhoto),
    };
    setMeetings((items) => [meeting, ...items]);
    go(draft.example ? "review" : "meeting", id);
    setToast(
      draft.example
        ? "예시 분석 흐름을 시작했습니다."
        : "선택한 파일을 시연 화면에 등록했습니다. 서버 저장·실제 분석은 연결 전입니다.",
    );
  }
  function submitReview(meeting: Meeting) {
    if (meeting.status !== "review") return;
    const hasConfirmed = meeting.candidates.some(
      (candidate) => candidate.confirmed,
    );
    updateMeeting(meeting.id, (item) => ({
      ...item,
      status: hasConfirmed ? "submitted" : "done",
    }));
    recordNotice(
      hasConfirmed
        ? "검토 제출 완료 · 확정 항목을 관리자 확인 대상으로 전달했습니다."
        : "검토 제출 완료 · 제안·논의 사항만 기록했습니다.",
    );
    go(
      role === "admin" && hasConfirmed ? "decisions" : "meeting",
      role === "admin" && hasConfirmed ? undefined : meeting.id,
    );
  }
  function openResolution(meeting: Meeting, candidate: Candidate) {
    setResolveTarget({ meetingId: meeting.id, candidateId: candidate.id });
    setDialog("resolve");
  }
  function applyResolution(method: Resolution | "new", reason: string) {
    if (
      !user ||
      role !== "admin" ||
      !targetMeeting ||
      !targetCandidate ||
      !targetCandidate.confirmed ||
      !reason.trim() ||
      (targetMeeting.status !== "submitted" &&
        targetCandidate.resolution !== "hold")
    )
      return;
    const previous =
      teamDecisions.find((decision) => decision.id === "decision-deadline") ||
      teamDecisions[0];
    const nextDecision: Decision = {
      id:
        previous && method === "replace" && targetCandidate.kind === "change"
          ? previous.id
          : crypto.randomUUID(),
      teamId: activeTeam.id,
      title: targetCandidate.title,
      owner: targetCandidate.owner,
      dueDate: targetCandidate.dueDate,
      evidence: targetCandidate.evidence,
      exception: method === "exception",
    };
    if (method === "replace" || method === "exception" || method === "new") {
      setDecisions((items) =>
        previous && method === "replace" && targetCandidate.kind === "change"
          ? items.map((decision) =>
              decision.id === previous.id ? nextDecision : decision,
            )
          : [nextDecision, ...items],
      );
    }
    if (method === "replace" && targetCandidate.kind === "change" && previous)
      setTasks((items) =>
        items.map((task) =>
          task.teamId === activeTeam.id && task.decisionId === previous.id
            ? { ...task, recheck: true }
            : task,
        ),
      );
    updateMeeting(targetMeeting.id, (meeting) => {
      const candidates = meeting.candidates.map((candidate) =>
        candidate.id === targetCandidate.id
          ? {
              ...candidate,
              resolution: method === "new" ? ("replace" as const) : method,
              reason: reason.trim(),
            }
          : candidate,
      );
      return {
        ...meeting,
        candidates,
        status: candidates.every(
          (candidate) => !candidate.confirmed || candidate.resolution,
        )
          ? "done"
          : "submitted",
      };
    });
    const after =
      method === "keep"
        ? previous?.title || "기존 결정 유지"
        : method === "hold"
          ? "현재 결정에 반영하지 않고 논의 중으로 보류"
          : nextDecision.title;
    setHistory((items) => [
      {
        id: crypto.randomUUID(),
        teamId: activeTeam.id,
        title: targetCandidate.title,
        before:
          targetCandidate.kind === "change"
            ? previous?.title || "기존 결정 없음"
            : "신규 결정",
        after,
        method,
        reason: reason.trim(),
        actor: user.name,
        at: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
        evidence: targetCandidate.evidence,
      },
      ...items,
    ]);
    recordNotice(`${resolutionLabels[method]} 처리를 기록했습니다.`);
    setDialog(null);
  }
  function createTeam(event: FormEvent) {
    event.preventDefault();
    if (!user || !teamName.trim()) return;
    const id = crypto.randomUUID();
    setTeams((items) => [
      ...items,
      { id, name: teamName.trim(), members: [{ ...user, role: "admin" }] },
    ]);
    setTeamId(id);
    setTeamName("");
    go("overview");
    setToast("새 팀을 만들었습니다. 이 팀의 관리자로 시작합니다.");
  }
  function changeMemberRole(id: string, nextRole: Member["role"]) {
    if (role !== "admin") return;
    const target = activeTeam.members.find((member) => member.id === id);
    if (
      target?.role === "admin" &&
      nextRole === "member" &&
      activeTeam.members.filter((member) => member.role === "admin").length ===
        1
    ) {
      setToast("팀에는 최소 한 명의 관리자가 필요합니다.");
      return;
    }
    setTeams((items) =>
      items.map((team) =>
        team.id === activeTeam.id
          ? {
              ...team,
              members: team.members.map((member) =>
                member.id === id ? { ...member, role: nextRole } : member,
              ),
            }
          : team,
      ),
    );
    recordNotice("팀원 역할을 변경했습니다.");
  }

  const commonDialogs = (
    <>
      {(dialog === "login" || dialog === "signup") && (
        <AuthDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onMode={setDialog}
          onSignUp={signUp}
          onSignIn={signIn}
        />
      )}
      {dialog === "help" && (
        <Modal title="로딩중 이용 안내" wide onClose={() => setDialog(null)}>
          <div className="stack">
            <p className="notice-message">
              현재 버전은 화면·이동·입력 검증·예시 상태 변경을 확인하는
              프론트엔드 시연입니다. 서버 인증·DB 저장·AI 분석은 아직 연결되지
              않았습니다.
            </p>
            <ol className="help-steps">
              <li>
                <strong>일반 팀원으로 시작</strong>
                <p>
                  회의록 등록에서 ‘예시 회의록 불러오기’를 선택하고 분석 흐름을
                  확인합니다.
                </p>
              </li>
              <li>
                <strong>결정 후보 검수·제출</strong>
                <p>
                  원문을 확인하고 담당자·마감일·확정 여부를 검수합니다.
                  제안·논의는 비교 대상에서 제외됩니다.
                </p>
              </li>
              <li>
                <strong>관리자로 결정 처리</strong>
                <p>
                  로그아웃 후 정수호 시연 계정으로 들어가 처리 대기의 후보를
                  비교하고 사유를 남깁니다.
                </p>
              </li>
              <li>
                <strong>원문·사진 확인</strong>
                <p>
                  원문 근거 팝업의 강조 표시와 회의 사진 탭의 얼굴·촬영
                  일시·위치 화면을 확인합니다.
                </p>
              </li>
            </ol>
            <div className="subtle-panel">
              <p>
                지원 선택 형식: PDF·TXT 최대 10 MB, 회의 사진 원본 JPEG 최대 10
                MB.
              </p>
              <p className="small muted">
                예시 사진은 실제 인물이 없는 배치 그림입니다. 직접 선택한
                파일에는 가짜 분석 결과를 생성하지 않습니다. 새로고침하면 모든
                시연 변경 사항이 초기화됩니다.
              </p>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "logout" && (
        <Modal title="로그아웃할까요?" onClose={() => setDialog(null)}>
          <div className="stack">
            <p>
              시연 중 변경한 회의록과 결정은 새로고침 전까지 유지됩니다. 다른
              권한의 시연 계정으로 이어서 확인할 수 있습니다.
            </p>
            <div className="row-actions">
              <button
                className="button button-secondary"
                onClick={() => setDialog(null)}
              >
                취소
              </button>
              <button
                className="button button-primary"
                onClick={async () => {
                  await signOut();
                  setDemoUser(null);
                  setSource(null);
                  setDialog(null);
                }}
              >
                로그아웃
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "teams" && user && (
        <Modal title="워크스페이스 선택" onClose={() => setDialog(null)}>
          <div className="stack">
            {teams
              .filter((team) =>
                team.members.some((member) => member.id === user.id),
              )
              .map((team) => (
                <button
                  key={team.id}
                  className="team-option"
                  onClick={() => {
                    setTeamId(team.id);
                    go("overview");
                  }}
                >
                  <strong>{team.name}</strong>
                  <span className="muted">
                    {team.id === teamId
                      ? "현재 팀"
                      : `팀원 ${team.members.length}명`}
                  </span>
                </button>
              ))}
            <button
              className="button button-secondary"
              onClick={() => setDialog("newteam")}
            >
              + 새 팀 만들기
            </button>
          </div>
        </Modal>
      )}
      {dialog === "newteam" && (
        <Modal title="새 팀 만들기" onClose={() => setDialog(null)}>
          <form className="stack" onSubmit={createTeam}>
            <p className="muted">팀을 만든 사용자가 첫 관리자가 됩니다.</p>
            <label className="field">
              <span>팀 이름</span>
              <input
                autoFocus
                required
                maxLength={40}
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="예: 캡스톤 개발팀"
              />
            </label>
            <button className="button button-primary">팀 만들기</button>
          </form>
        </Modal>
      )}
      {dialog === "notifications" && (
        <Modal title="알림" onClose={() => setDialog(null)}>
          <div className="stack">
            {unread.length ? (
              unread.map((item) => (
                <div className="list-row" key={item.id}>
                  <p>{item.text}</p>
                </div>
              ))
            ) : (
              <p className="muted">새 알림이 없습니다.</p>
            )}
            <div className="row-actions">
              <button
                className="button button-secondary"
                onClick={() =>
                  setNotifications((items) =>
                    items.filter((item) => item.teamId !== activeTeam.id),
                  )
                }
              >
                모두 읽음
              </button>
              <button
                className="button button-primary"
                onClick={() => go("meetings")}
              >
                회의록 확인
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "resolve" && targetMeeting && targetCandidate && (
        <ResolveDialog
          key={targetCandidate.id}
          candidate={targetCandidate}
          previous={
            targetCandidate.kind === "change"
              ? teamDecisions.find(
                  (decision) => decision.id === "decision-deadline",
                ) || teamDecisions[0]
              : undefined
          }
          admin={role === "admin"}
          onSource={setSource}
          onApply={applyResolution}
          onClose={() => setDialog(null)}
        />
      )}
      {source && sourceMeeting && (
        <Modal title="원문 근거" wide onClose={() => setSource(null)}>
          <SourceDocument meeting={sourceMeeting} source={source} />
        </Modal>
      )}
    </>
  );

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "1rem",
          background: "#f5f5f7",
        }}
      >
        <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
          로그인 정보를 불러오는 중...
        </div>
        <div className="small muted">
          Supabase 세션을 확인하고 있어요. 잠시만 기다려주세요.
        </div>
      </div>
    );
  }

  if (!user)
    return (
      <>
        <div className="landing">
          <header className="landing-header">
            <div>
              <strong className="brand">로딩중</strong>
              <p className="sidebar-subtitle">회의의 결정을 잇다</p>
            </div>
            <nav className="row-actions" aria-label="시작 메뉴">
              <button className="text-button" onClick={() => setDialog("help")}>
                이용 안내
              </button>
              <button
                className="text-button"
                onClick={() => setDialog("login")}
              >
                로그인
              </button>
              <button
                className="button button-primary"
                onClick={() => setDialog("signup")}
              >
                회원가입
              </button>
            </nav>
          </header>
          <main className="landing-main">
            <section className="landing-copy">
              <span className="eyebrow">TEAM DECISION WORKSPACE</span>
              <h1>
                회의의 결정을,
                <br />
                다음 회의까지
                <br />
                <span>이어갑니다.</span>
              </h1>
              <p>
                회의록 속 결정과 후속 업무를 연결합니다.
                <br />
                달라진 결정을 비교하고, 원문을 근거로 함께 확인하세요.
              </p>
              <div className="row-actions">
                <button
                  className="button button-primary"
                  onClick={() => setDialog("login")}
                >
                  로그인하고 시작하기 →
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => setDialog("help")}
                >
                  사용 흐름 보기
                </button>
              </div>
              <div className="demo-quick-accounts" style={{ marginTop: "1.5rem" }}>
                <p className="small muted" style={{ marginBottom: "0.5rem" }}>
                  시연용 계정으로 바로 입장 (Supabase 인증 없이)
                </p>
                <div
                  className="row-actions"
                  style={{ flexWrap: "wrap", gap: "0.5rem" }}
                >
                  {demoUsers.map((account) => (
                    <button
                      key={account.id}
                      className="button button-secondary"
                      onClick={() => login(account)}
                    >
                      {account.name} (
                      {account.role === "admin" ? "관리자" : "팀원"})
                    </button>
                  ))}
                </div>
              </div>
              <p className="landing-demo-note">
                화면 시연 버전 · 예시 데이터 사용
              </p>
            </section>
            <section
              className="landing-preview"
              aria-label="결정 검토 화면 예시"
            >
              <div className="preview-topline">
                <span className="preview-dot" />
                <span>서비스 기획팀 / 결정 검토</span>
                <span className="badge badge-gray">예시</span>
              </div>
              <div className="preview-paper">
                <p className="small muted">10.13 행사 준비 회의</p>
                <h2>
                  결정은 바뀌어도,
                  <br />
                  근거는 남도록.
                </h2>
                <div className="preview-decision">
                  <span className="small muted">기존 결정</span>
                  <p>
                    자료 제출 마감 <s>18:00</s>
                  </p>
                </div>
                <div className="preview-decision preview-new">
                  <span className="small">새 결정 후보</span>
                  <p>
                    같은 날 <strong>20:00으로 변경</strong>
                  </p>
                  <span className="small">회의록 · 문단 2 ↗</span>
                </div>
                <div className="preview-footer">
                  <span className="avatar small-avatar">수호</span>
                  <p>원문 확인 후 관리자 반영</p>
                  <span className="badge">검토</span>
                </div>
              </div>
              <div className="landing-stepbar">
                <span>기록</span>
                <span>→</span>
                <span>검토</span>
                <span>→</span>
                <span>결정</span>
                <span>→</span>
                <span>후속 업무</span>
              </div>
            </section>
          </main> 
          <footer className="landing-footer">
            <p>회의록 · 결정 사항 · 회의 사진을 하나의 기록으로</p>
            <span>로딩중 · 캡스톤 디자인</span>
          </footer>
        </div>
        {commonDialogs}
      </>
    );

  return (
    <>
      <div className="app-layout">
        <aside className="sidebar">
          <button className="brand brand-button" onClick={() => go("overview")}>
            로딩중
          </button>
          <p className="sidebar-subtitle">회의의 결정을 잇다</p>
          <button className="team-selector" onClick={() => setDialog("teams")}>
            <span>현재 팀</span>
            <strong>{activeTeam.name} ▾</strong>
          </button>
          <p className="workspace-label">WORKSPACE</p>
          <nav className="sidebar-nav" aria-label="주 메뉴">
            {menuItems.map((item) => {
              const active =
                route.page === item.page ||
                (item.page === "meetings" &&
                  ["upload", "meeting", "review"].includes(route.page));
              return (
                <button
                  key={item.page}
                  className={`nav-button ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => go(item.page)}
                >
                  {item.label}
                  {item.page === "decisions" && pendingCount > 0 && (
                    <span className="nav-count">{pendingCount}</span>
                  )}
                </button>
              );
            })}
          </nav>
          <button
            className={`sidebar-user profile-button ${route.page === "profile" ? "profile-active" : ""}`}
            onClick={() => go("profile")}
          >
            <strong>{user.name}</strong>
            <span>
              {role === "admin" ? "팀 관리자" : "일반 팀원"} · 내 정보 ↗
            </span>
          </button>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <p className="breadcrumb">워크스페이스 / {activeTeam.name}</p>
            <div className="topbar-actions">
              <span className="demo-pill">화면 시연</span>
              <button
                className="text-button"
                onClick={() => setDialog("notifications")}
              >
                알림{unread.length > 0 && <span className="notification-dot" />}
              </button>
              <button
                className="text-button"
                onClick={() => setDialog("logout")}
              >
                로그아웃
              </button>
              <button className="text-button" onClick={() => setDialog("help")}>
                도움말
              </button>
            </div>
          </header>
          <main className="main-content" key={activeTeam.id}>
            {route.page === "overview" && (
              <Overview
                meetings={teamMeetings}
                decisions={teamDecisions}
                tasks={teamTasks}
                pendingCount={pendingCount}
                name={user.name}
                go={go}
              />
            )}
            {route.page === "meetings" && (
              <MeetingList meetings={teamMeetings} go={go} />
            )}
            {route.page === "upload" && (
              <UploadPage onSave={saveDraft} onCancel={() => go("meetings")} />
            )}
            {route.page === "meeting" && currentMeeting && (
              <MeetingDetail
                key={`${currentMeeting.id}-${route.tab}`}
                meeting={currentMeeting}
                members={activeTeam.members}
                initialTab={route.tab}
                go={go}
                onSource={setSource}
                onAddPhotos={(files) => {
                  const photos = files.map(makePhoto);
                  updateMeeting(currentMeeting.id, (meeting) => ({
                    ...meeting,
                    photos: [...meeting.photos, ...photos],
                  }));
                }}
                onPhotoChange={(photo) =>
                  updateMeeting(currentMeeting.id, (meeting) => ({
                    ...meeting,
                    photos: meeting.photos.some((item) => item.id === photo.id)
                      ? meeting.photos.map((item) =>
                          item.id === photo.id ? photo : item,
                        )
                      : [...meeting.photos, photo],
                  }))
                }
                onPhotoDelete={(id) => {
                  releaseUrl(
                    currentMeeting.photos.find((photo) => photo.id === id)?.url,
                  );
                  updateMeeting(currentMeeting.id, (meeting) => ({
                    ...meeting,
                    photos: meeting.photos.filter((photo) => photo.id !== id),
                  }));
                }}
              />
            )}
            {route.page === "review" && currentMeeting && (
              <ReviewPage
                key={currentMeeting.id}
                meeting={currentMeeting}
                members={activeTeam.members}
                go={go}
                onSource={setSource}
                onEdit={(candidate) => {
                  if (currentMeeting.status === "review")
                    updateMeeting(currentMeeting.id, (meeting) => ({
                      ...meeting,
                      candidates: meeting.candidates.map((item) =>
                        item.id === candidate.id ? candidate : item,
                      ),
                    }));
                }}
                onSubmit={() => submitReview(currentMeeting)}
                onStatus={(status) => {
                  if (currentMeeting.example)
                    updateMeeting(currentMeeting.id, (meeting) => ({
                      ...meeting,
                      status,
                    }));
                }}
              />
            )}
            {["meeting", "review"].includes(route.page) && !currentMeeting && (
              <EmptyState
                title="회의록을 찾을 수 없습니다"
                description="현재 팀에 소속된 회의록만 확인할 수 있습니다."
                action={
                  <button
                    className="button button-primary"
                    onClick={() => go("meetings")}
                  >
                    회의록 목록
                  </button>
                }
              />
            )}
            {route.page === "decisions" && (
              <DecisionsPage
                key={`${activeTeam.id}-${role}`}
                meetings={teamMeetings}
                decisions={teamDecisions}
                history={teamHistory}
                role={role}
                go={go}
                onSource={setSource}
                onResolve={openResolution}
              />
            )}
            {route.page === "tasks" && (
              <TasksPage
                tasks={teamTasks}
                user={user}
                role={role}
                onUpdate={(task) => {
                  if (role === "admin" || task.owner === user.name)
                    setTasks((items) =>
                      items.map((item) => (item.id === task.id ? task : item)),
                    );
                }}
                go={go}
              />
            )}
            {route.page === "chat" && (
              <ChatPage decisions={teamDecisions} onSource={setSource} />
            )}
            {route.page === "team" && (
              <TeamPage
                team={activeTeam}
                role={role}
                currentUser={user}
                onCreate={() => setDialog("newteam")}
                onRole={changeMemberRole}
                onAdd={(member) => {
                  if (
                    role !== "admin" ||
                    activeTeam.members.some((item) => item.id === member.id)
                  )
                    return;
                  setTeams((items) =>
                    items.map((team) =>
                      team.id === activeTeam.id
                        ? { ...team, members: [...team.members, member] }
                        : team,
                    ),
                  );
                  recordNotice(`${member.name}님을 팀에 추가했습니다.`);
                }}
              />
            )}
            {route.page === "profile" && (
              <ProfilePage
                user={user}
                profile={profiles[user.id] || { consent: false, url: "" }}
                createUrl={createUrl}
                onChange={(profile) => {
                  if (profiles[user.id]?.url !== profile.url)
                    releaseUrl(profiles[user.id]?.url);
                  setProfiles((items) => ({ ...items, [user.id]: profile }));
                }}
                onWithdraw={() => {
                  releaseUrl(profiles[user.id]?.url);
                  setProfiles((items) => ({
                    ...items,
                    [user.id]: { consent: false, url: "" },
                  }));
                  setMeetings((items) =>
                    items.map((meeting) => ({
                      ...meeting,
                      photos: meeting.photos.map((photo) => ({
                        ...photo,
                        faces: photo.faces.map((face) =>
                          face.name === user.name
                            ? { ...face, name: "확인 불가", confirmed: false }
                            : face,
                        ),
                      })),
                    })),
                  );
                  setToast(
                    "얼굴 정보 처리 동의를 철회하고 연결 정보를 시연 데이터에서 제거했습니다.",
                  );
                }}
              />
            )}
            <footer className="workspace-footer">
              예시 데이터 기반 화면 시연 · 새로고침 시 초기화 · 실제
              인증·분석·저장은 연결 전
            </footer>
          </main>
        </div>
      </div>
      {commonDialogs}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="안내 닫기" onClick={() => setToast("")}>
            ×
          </button>
        </div>
      )}
    </>
  );
}


function ResolveDialog({
  candidate,
  previous,
  admin,
  onSource,
  onApply,
  onClose,
}: {
  candidate: Candidate;
  previous?: Decision;
  admin: boolean;
  onSource: (source: Evidence) => void;
  onApply: (method: Resolution | "new", reason: string) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<Resolution>("replace");
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={previous ? "기존 결정과 새 후보 비교" : "신규 결정 검토"}
      wide
      onClose={onClose}
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (admin && reason.trim())
            onApply(previous ? method : "new", reason);
        }}
      >
        <p className="muted">
          원문을 확인한 뒤 적용 대상·조건·시점을 비교해 판단해 주세요.
        </p>
        <div className="comparison-grid">
          {previous && (
            <section className="comparison-card">
              <span className="badge badge-gray">기존 확정 결정</span>
              <h3>{previous.title}</h3>
              <p className="muted">
                {previous.owner || "담당자 미확인"} ·{" "}
                {previous.dueDate || "기한 미확인"}
              </p>
              <SourceButton
                source={previous.evidence}
                onSource={onSource}
                label="기존 결정 원문"
              />
            </section>
          )}
          <section className="comparison-card comparison-new">
            <span className="badge">새 결정 후보</span>
            <h3>{candidate.title}</h3>
            <p className="muted">
              {candidate.owner || "담당자 미확인"} ·{" "}
              {candidate.dueDate || "기한 미확인"}
            </p>
            <SourceButton
              source={candidate.evidence}
              onSource={onSource}
              label="새 후보 원문"
            />
          </section>
        </div>
        <div className="subtle-panel">
          <strong>예시 분석 사유</strong>
          <p>
            {previous
              ? "적용 대상과 날짜가 같으며, 새 회의록에서 마감 변경을 명시하고 있습니다. 최종 반영 여부는 관리자가 판단합니다."
              : "사용자가 회의에서 확정한 내용으로 검토한 신규 후보입니다."}
          </p>
        </div>
        {admin ? (
          <>
            {previous && (
              <fieldset className="resolution-options">
                <legend>처리 방식 선택</legend>
                {(["keep", "replace", "exception", "hold"] as const).map(
                  (value) => (
                    <label
                      key={value}
                      className={method === value ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="resolution"
                        value={value}
                        checked={method === value}
                        onChange={() => setMethod(value)}
                      />
                      {resolutionLabels[value]}
                    </label>
                  ),
                )}
              </fieldset>
            )}
            <label className="field">
              <span>
                처리 사유 <span className="required">필수</span>
              </span>
              <textarea
                rows={3}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  method === "exception"
                    ? "예외를 적용할 대상·기간·조건과 사유를 기록하세요."
                    : "원문을 확인한 뒤 선택한 처리 사유를 남겨 주세요."
                }
              />
            </label>
            <div className="row-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={onClose}
              >
                취소
              </button>
              <button
                className="button button-primary"
                disabled={!reason.trim()}
              >
                {previous ? "선택한 방식으로 처리" : "현재 결정에 반영"}
              </button>
            </div>
          </>
        ) : (
          <div className="notice-message">
            일반 팀원은 비교 내용과 원문을 확인할 수 있습니다. 최종 결정 처리는
            관리자 권한이 필요합니다.
          </div>
        )}
      </form>
    </Modal>
  );
}