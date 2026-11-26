import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import "./workspace.css";
import Modal from "./components/Modal";
import { compareDecision, comparisonLabels, type ComparisonResult } from "./comparison-api";
import UploadPage from "./UploadPage";
import { analyzeDocument, type MeetingAnalysis } from "./document-api";
import {
  fetchMyNotifications,
  markNotificationsRead,
  type AppNotification,
} from "./lib/notifications";
import { fetchTeamTasks, updateTaskRow } from "./lib/tasks";
// import ServerConnectionStatus from "./components/ServerConnectionStatus";
import AuthDialog from "./components/AuthDialog";
import { useAuth } from "./hooks/useAuth";
import type { AuthUser } from "./hooks/useAuth";
import { exampleCandidates, newParagraphs, resolutionLabels } from "./demo-data";
import {
  fetchTeamMeetings,
  fetchMeetingFileUrl,
  fetchTeamProjects,
  persistMeetingAnalysis,
  createTeamProject,
  saveMeetingToSupabase,
  fetchTeamDecisions,
  fetchTeamHistory,
  updateMeetingStatus,
  updateConflictCandidate,
  resolveCandidate,
  resolveTaskCandidate,
  invalidateDecision,
  deleteMeeting,
} from "./lib/meetings";
import {
  acceptInvitation,
  changeMemberRole as changeMemberRoleRemote,
  createTeam as createTeamRemote,
  declineInvitation,
  fetchMyPendingInvitations,
  fetchMyTeams,
  inviteMember,
  leaveTeam as leaveTeamRemote,
  removeMember as removeMemberRemote,
} from "./lib/teams";
import type { PendingInvitation } from "./lib/teams";
import type {
  Candidate,
  ChangeRecord,
  Decision,
  Evidence,
  Meeting,
  MeetingPhoto,
  Member,
  Page,
  Project,
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
  | "invitations"
  | "resolve"
  | "task"
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

function meetingError(message: string, error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return `${message}: ${error.message}`;
  }
  return message;
}

// AI 분석 결과를 결정 후보(kind new)와 후속 업무 후보(kind action_item)로 나눈다.
// 후속 업무도 결정과 같은 후보 테이블로 저장해 검토 화면 → 관리자 확정 순서로
// tasks에 반영한다 (SFR-016 검수 단계).
function candidatesFromAnalysis(
  analysis: MeetingAnalysis,
  meetingId: string,
): Candidate[] {
  return analysis.decisions.map((item) => {
    const paragraph = analysis.extractedDocument.pages
      .find((page) => page.pageNumber === item.source.pageNumber)
      ?.paragraphs.find(
        (entry) => entry.paragraphNumber === item.source.paragraphNumber,
      );
    const quote = item.source.text ?? "";
    const quoteIndex =
      quote && paragraph ? paragraph.text.indexOf(quote) : -1;
    const startOffset =
      paragraph && quoteIndex >= 0
        ? paragraph.startOffset + quoteIndex
        : null;
    return {
      id: crypto.randomUUID(),
      title: item.decision,
      owner: item.assignee ?? "",
      dueDate: item.dueDate ?? "",
      confirmed: true,
      kind: item.actionItem ? ("action_item" as const) : ("new" as const),
      evidence: {
        documentId: meetingId,
        page: item.source.pageNumber,
        paragraph: item.source.paragraphNumber,
        startOffset,
        endOffset: startOffset === null ? null : startOffset + quote.length,
        quote,
      },
    };
  });
}

export default function App() {
  // === Supabase 인증 ===
  // useAuth: Supabase 세션 관리 (실제 로그인, RPC 기반)
  const { user: authUser, loading, signIn, signUp, signOut } = useAuth();

  // AuthUser -> Member 타입 매핑 (Supabase 사용자를 Member로 변환)
  const memberFromAuth = (auth: AuthUser): Member => ({
    id: auth.id,
    name: auth.name,
    email: auth.email,
    role: auth.role,
  });

  const user: Member | null = authUser ? memberFromAuth(authUser) : null;

  // teams / teamId는 더 이상 demo-data.ts의 initialTeams로 초기화하지 않습니다.
  // 로그인 직후 fetchMyTeams()로 Supabase에서 불러옵니다.
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<
    PendingInvitation[]
  >([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [deletingMeetingId, setDeletingMeetingId] = useState<string | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const candidateWrites = useRef(new Map<string, Promise<void>>());
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionsReadyTeamId, setDecisionsReadyTeamId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChangeRecord[]>([]);
  // 업무는 Supabase tasks 테이블을 직접 조회한다 (SFR-016).
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Record<string, FaceProfile>>({});
  const [route, setRoute] = useState(readRoute);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [source, setSource] = useState<Evidence | null>(null);
  const [resolveTarget, setResolveTarget] = useState<{
    meetingId: string;
    candidateId: string;
  } | null>(null);
  // 후속 업무 후보 처리(확정/제외) 대상 — 결정 처리(resolve)와 별도 다이얼로그.
  const [taskTarget, setTaskTarget] = useState<{
    meetingId: string;
    candidateId: string;
  } | null>(null);
  const [toast, setToast] = useState("");
  // 알림은 notifications 테이블에서 본인(user_id) 알림을 읽어 온다 (SFR-018).
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [retryingMeetingId, setRetryingMeetingId] = useState<string | null>(
    null,
  );
  const [teamName, setTeamName] = useState("");
  const urls = useRef<string[]>([]);

  // 로그인된 사용자가 바뀔 때마다 내 팀 목록과 받은 초대를 Supabase에서 불러옵니다.
  useEffect(() => {
    if (!authUser) {
      setTeams([]);
      setTeamId(null);
      setNotifications([]);
      setPendingInvitations([]);
      return;
    }
    let cancelled = false;
    setTeamsLoading(true);
    setTeamsError(null);
    fetchMyTeams()
      .then((result) => {
        if (cancelled) return;
        setTeams(result);
        // 이전 teamId가 결과에 있으면 유지, 없으면 첫 팀으로
        setTeamId((prev) =>
          prev && result.some((t) => t.id === prev)
            ? prev
            : (result[0]?.id ?? null),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTeamsError(
          err instanceof Error ? err.message : "팀 목록을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    // 받은 초대(PENDING) 목록도 함께 로드
    setInvitationsLoading(true);
    fetchMyPendingInvitations(authUser.id)
      .then((items) => {
        if (!cancelled) setPendingInvitations(items);
      })
      .catch(() => {
        if (!cancelled) setPendingInvitations([]);
      })
      .finally(() => {
        if (!cancelled) setInvitationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  // 팀·초대 목록을 서버에서 다시 불러옵니다. (초대/수락/거절/제거/탈퇴 후 호출)
  async function refreshTeamsAndInvitations() {
    if (!authUser) return;
    const [teamsResult, invitationsResult] = await Promise.all([
      fetchMyTeams(),
      fetchMyPendingInvitations(authUser.id),
    ]);
    setTeams(teamsResult);
    setPendingInvitations(invitationsResult);
    return teamsResult;
  }

  const emptyTeam: Team = { id: "", name: "", members: [] };
  const activeTeam =
    teams.find((team) => team.id === teamId) || teams[0] || emptyTeam;
  const hasTeam = activeTeam.id !== "";
  const role =
    activeTeam.members.find((member) => member.id === user?.id)?.role ||
    "member";
  const teamMeetings = meetings.filter(
    (meeting) => meeting.teamId === activeTeam.id,
  );
  const teamDecisions = decisions.filter(
    (decision) => decision.teamId === activeTeam.id,
  );
  const teamProjects = projects.filter(
    (project) => project.teamId === activeTeam.id,
  );
  const teamTasks = tasks.filter((task) => task.teamId === activeTeam.id);
  // 이력의 actor는 user_id라서 팀원 목록에서 이름으로 치환해 화면에 표시
  const memberNameById = new Map(
    activeTeam.members.map((m) => [m.id, m.name] as const),
  );
  const teamHistory = history
    .filter((record) => record.teamId === activeTeam.id)
    .map((record) => ({
      ...record,
      actor: memberNameById.get(record.actor) ?? record.actor,
    }));
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
  // 후속 업무 처리 다이얼로그용 대상
  const taskMeeting = teamMeetings.find(
    (meeting) => meeting.id === taskTarget?.meetingId,
  );
  const taskCandidate = taskMeeting?.candidates.find(
    (candidate) => candidate.id === taskTarget?.candidateId,
  );
  const pendingCount = teamMeetings.flatMap((meeting) =>
    meeting.status === "submitted"
      ? meeting.candidates.filter(
          (candidate) => candidate.confirmed && !candidate.resolution,
        )
      : [],
  ).length;
  const teamNotifications = notifications.filter(
    (item) => item.teamId === activeTeam.id,
  );
  const unread = teamNotifications.filter((item) => !item.readAt);
  const analyzing = meetings
    .filter((meeting) => meeting.example && meeting.status === "analyzing")
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

  // 활성 팀의 프로젝트, 유효 결정, 변경 이력을 Supabase에서 불러온다.
  useEffect(() => {
    setDecisionsReadyTeamId(null);
    if (!hasTeam) {
      setDecisions([]);
      setHistory([]);
      setProjects([]);
      setTasks([]);
      return;
    }
    let cancelled = false;
    fetchTeamProjects(activeTeam.id)
      .then((rows) => {
        if (!cancelled) setProjects((items) => {
          const byId = new Map([...items, ...rows].map((project) => [project.id, project]));
          return [...byId.values()];
        });
      })
      .catch((error) => {
        if (!cancelled) setToast(meetingError("프로젝트 조회 실패", error));
      });
    fetchTeamDecisions(activeTeam.id)
      .then((rows) => {
        if (!cancelled) {
          setDecisions(rows);
          setDecisionsReadyTeamId(activeTeam.id);
        }
      })
      .catch((error) => {
        if (!cancelled) setToast(meetingError("현재 결정 조회 실패", error));
      });
    fetchTeamHistory(activeTeam.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    // 업무(SFR-016)도 팀 데이터와 함께 조회한다.
    fetchTeamTasks(activeTeam.id)
      .then((rows) => {
        if (!cancelled)
          setTasks((items) => [
            ...items.filter((item) => item.teamId !== activeTeam.id),
            ...rows,
          ]);
      })
      .catch((error) => {
        if (!cancelled) {
          setTasks((items) =>
            items.filter((item) => item.teamId !== activeTeam.id),
          );
          // 마이그레이션 미실행 등으로 조회가 실패하면 조용히 빈 화면이
          // 되지 않게 이유를 알려 준다.
          setToast(meetingError("업무 목록 불러오기 실패", error));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam.id, hasTeam]);

  // 알림(SFR-018): notifications 테이블을 조회하고 30초마다 갱신한다.
  useEffect(() => {
    if (!authUser) {
      setNotifications([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchMyNotifications()
        .then((rows) => {
          if (!cancelled) setNotifications(rows);
        })
        .catch(() => {
          if (!cancelled) setNotifications([]);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authUser]);

  function refreshNotifications() {
    void fetchMyNotifications()
      .then((rows) => setNotifications(rows))
      .catch(() => {});
  }

  // 활성 팀이 바뀌면 회의록 목록을 Supabase에서 불러온다.
  useEffect(() => {
    if (!hasTeam) {
      setMeetings([]);
      setMeetingsLoading(false);
      return;
    }
    let cancelled = false;
    setMeetingsLoading(true);
    fetchTeamMeetings(activeTeam.id)
      .then((rows) => {
        if (!cancelled) setMeetings(rows);
      })
      .catch((error) => {
        if (!cancelled) setToast(meetingError("회의록 조회 실패", error));
      })
      .finally(() => {
        if (!cancelled) setMeetingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam.id, hasTeam]);

  const previewMeeting = sourceMeeting ??
    (route.page === "meeting" || route.page === "review" ? currentMeeting : undefined);
  const previewMeetingId = previewMeeting?.id;
  const needsFileUrl = !!previewMeeting && !previewMeeting.example && !previewMeeting.fileUrl;
  const previewTeamId = activeTeam.id;

  useEffect(() => {
    if (!previewMeetingId || !needsFileUrl) return;
    let cancelled = false;
    fetchMeetingFileUrl(previewTeamId, previewMeetingId)
      .then((fileUrl) => {
        if (!cancelled && fileUrl) {
          setMeetings((items) => items.map((item) =>
            item.id === previewMeetingId ? { ...item, fileUrl } : item,
          ));
        }
      })
      .catch((error) => {
        if (!cancelled) setToast(meetingError("원본 파일 주소 조회 실패", error));
      });
    return () => { cancelled = true; };
  }, [needsFileUrl, previewMeetingId, previewTeamId]);

  function go(page: Page, id?: string) {
    setDialog(null);
    setSource(null);
    const hash = `#/${page}${id ? `/${id}` : ""}`;
    window.location.hash = hash;
    setRoute(readRoute());
    window.scrollTo(0, 0);
  }
  // 화면에서 생긴 즉시 피드백은 toast로만 알린다. 알림 목록은 notifications
  // 테이블을 조회해 담당자에게 도착한 알림을 보여 준다 (SFR-018).
  function recordNotice(text: string) {
    setToast(text);
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
  async function createProject(name: string): Promise<string | null> {
    const projectName = name.trim();
    if (!user || !hasTeam) return "프로젝트를 추가할 팀을 선택해 주세요.";
    if (!projectName) return "프로젝트 이름을 입력해 주세요.";
    if (teamProjects.some((project) => project.name === projectName)) {
      return "현재 팀에 같은 이름의 프로젝트가 있습니다.";
    }

    try {
      const project = await createTeamProject(activeTeam.id, projectName);
      setProjects((items) => items.some((item) => item.id === project.id) ? items : [...items, project]);
      setToast("프로젝트를 추가했습니다.");
      return null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        return "현재 팀에 같은 이름의 프로젝트가 있습니다.";
      }
      return meetingError("프로젝트 추가 실패", error);
    }
  }

  function saveReviewCandidate(candidate: Candidate) {
    const writes = candidateWrites.current;
    // 빠르게 입력하더라도 같은 후보의 수정은 순서대로 저장한다.
    const current = writes.get(candidate.id) ?? Promise.resolve();
    const next = current.catch(() => {}).then(() => updateConflictCandidate(candidate, activeTeam.members));
    writes.set(candidate.id, next);
    const clear = () => {
      if (writes.get(candidate.id) === next) writes.delete(candidate.id);
    };
    void next.then(clear, clear);
    return next;
  }

  function updateMeeting(id: string, update: (meeting: Meeting) => Meeting) {
    if (!hasTeam) return;
    setMeetings((items) =>
      items.map((meeting) =>
        meeting.id === id && meeting.teamId === activeTeam.id
          ? update(meeting)
          : meeting,
      ),
    );
  }
  async function saveDraft(draft: UploadDraft) {
    if (!user || !hasTeam) return;
    const id = crypto.randomUUID();
    // AI 결과를 결정 후보와 후속 업무 후보로 나눈다 (SFR-008/009/016).
    // 후속 업무도 후보로 저장되며, 관리자 확정 시 tasks에 반영된다.
    const candidates: Candidate[] = draft.analysis
      ? candidatesFromAnalysis(draft.analysis, id)
      : draft.example
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
        : (draft.extractedDocument?.pages.flatMap((page) =>
            page.paragraphs.map((paragraph) => paragraph.text),
          ) ?? []),
      extractedDocument: draft.extractedDocument,
      // 분석 실패 시에도 원본을 failed 상태로 저장해 재시도(SFR-027)할 수 있게 한다.
      status: draft.example ? "analyzing" : draft.analysis ? "review" : "failed",
      example: draft.example,
      candidates,
      photos: draft.photos.map(makePhoto),
    };
    if (!draft.example) {
      try {
        await saveMeetingToSupabase(meeting, draft, user.id, activeTeam.members);
      } catch (error) {
        releaseUrl(meeting.fileUrl);
        throw new Error(meetingError("회의록 저장 실패", error));
      }
    }
    setMeetings((items) => [meeting, ...items]);
    go(
      draft.analysis || draft.example || draft.analysisError
        ? "review"
        : "meeting",
      id,
    );
    setToast(
      draft.example
        ? "예시 분석 흐름을 시작했습니다."
        : draft.analysis
          ? `AI 분석이 완료됐습니다. 결정 ${candidates.filter((item) => item.kind !== "action_item").length}건과 후속 업무 ${candidates.filter((item) => item.kind === "action_item").length}건을 검토해 주세요.`
          : "분석에 실패해 원본을 저장했습니다. 회의록 화면에서 분석을 다시 요청할 수 있습니다.",
    );
  }
  async function submitReview(meeting: Meeting) {
    if (meeting.status !== "review" || submittingReview) return;

    // 확정한 결정은 현재 팀의 프로젝트를 선택해야 제출할 수 있다.
    // 후속 업무 후보는 프로젝트 분류가 필요 없다.
    const hasUnclassified = meeting.candidates.some(
      (candidate) =>
        candidate.confirmed &&
        candidate.kind !== "action_item" &&
        !teamProjects.some((project) => project.id === candidate.projectId),
    );
    if (hasUnclassified) {
      setToast("확정 항목의 프로젝트를 모두 선택해 주세요.");
      return;
    }
    const nextStatus = meeting.candidates.some((candidate) => candidate.confirmed)
      ? "submitted"
      : "done";

    if (!meeting.example) {
      setSubmittingReview(true);
      try {
        await Promise.all(meeting.candidates.map(saveReviewCandidate));
        await updateMeetingStatus(meeting.id, nextStatus);
      } catch (error) {
        setToast(meetingError("검토 결과 저장 실패", error));
        return;
      } finally {
        setSubmittingReview(false);
      }
    }

    updateMeeting(meeting.id, (item) => ({ ...item, status: nextStatus }));
    recordNotice(
      nextStatus === "submitted"
        ? "검토 제출 완료 · 확정 항목을 관리자 확인 대상으로 전달했습니다."
        : "검토 제출 완료 · 제안·논의 사항만 기록했습니다.",
    );
    go(
      role === "admin" && nextStatus === "submitted" ? "decisions" : "meeting",
      role === "admin" && nextStatus === "submitted" ? undefined : meeting.id,
    );
  }

  // 분석 실패 회의록의 원본을 저장소에서 내려받아 다시 분석한다 (SFR-027).
  async function retryAnalysis(meeting: Meeting) {
    if (!user || !hasTeam || meeting.example || retryingMeetingId) return;
    setRetryingMeetingId(meeting.id);
    updateMeeting(meeting.id, (item) => ({ ...item, status: "analyzing" }));
    void updateMeetingStatus(meeting.id, "analyzing").catch(() => {});
    try {
      const fileUrl = await fetchMeetingFileUrl(meeting.teamId, meeting.id);
      if (!fileUrl) {
        throw new Error("원본 파일을 찾지 못했습니다. 파일을 다시 업로드해 주세요.");
      }
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error("원본 파일을 내려받지 못했습니다.");
      const blob = await response.blob();
      const file = new File([blob], meeting.fileName || "meeting", {
        type: blob.type ||
          (/\.pdf$/i.test(meeting.fileName)
            ? "application/pdf"
            : "text/plain;charset=utf-8"),
      });
      const analysis = await analyzeDocument(file, new AbortController().signal);
      const candidates = candidatesFromAnalysis(analysis, meeting.id);
      await persistMeetingAnalysis({
        meetingId: meeting.id,
        teamId: meeting.teamId,
        doc: analysis.extractedDocument,
        candidates,
        members: activeTeam.members,
      });
      updateMeeting(meeting.id, (item) => ({
        ...item,
        status: "review",
        paragraphs: analysis.extractedDocument.pages.flatMap((page) =>
          page.paragraphs.map((paragraph) => paragraph.text),
        ),
        extractedDocument: analysis.extractedDocument,
        candidates,
      }));
      void updateMeetingStatus(meeting.id, "review").catch(() => {});
      void fetchTeamTasks(meeting.teamId)
        .then((rows) =>
          setTasks((items) => [
            ...items.filter((item) => item.teamId !== meeting.teamId),
            ...rows,
          ]),
        )
        .catch(() => {});
      setToast(
        `AI 분석이 완료됐습니다. 결정 ${candidates.filter((item) => item.kind !== "action_item").length}건과 후속 업무 ${candidates.filter((item) => item.kind === "action_item").length}건을 검토해 주세요.`,
      );
      go("review", meeting.id);
    } catch (error) {
      updateMeeting(meeting.id, (item) => ({ ...item, status: "failed" }));
      void updateMeetingStatus(meeting.id, "failed").catch(() => {});
      setToast(meetingError("분석 재시도 실패", error));
    } finally {
      setRetryingMeetingId(null);
    }
  }

  async function handleDeleteMeeting(meeting: Meeting) {
    if (!hasTeam || meeting.teamId !== activeTeam.id || meeting.example || deletingMeetingId) {
      return;
    }
    if (teamDecisions.some((decision) => decision.evidence.documentId === meeting.id)) {
      setToast("유효한 결정이 연결된 회의록은 삭제할 수 없습니다.");
      return;
    }
    if (
      !window.confirm(
        `회의록 "${meeting.title}"을 삭제할까요? 이 회의록의 결정 후보도 목록에서 사라집니다.`,
      )
    ) {
      return;
    }

    setDeletingMeetingId(meeting.id);
    try {
      await deleteMeeting(meeting.id);
      releaseUrl(meeting.fileUrl);
      setMeetings((items) => items.filter((item) => item.id !== meeting.id));
      setToast("회의록을 삭제했습니다.");
      const currentRoute = readRoute();
      if (currentRoute.page === "meeting" && currentRoute.id === meeting.id) {
        go("meetings");
      }
    } catch (error) {
      setToast(meetingError("회의록 삭제 실패", error));
    } finally {
      setDeletingMeetingId(null);
    }
  }

  async function handleInvalidateDecision(decision: Decision, reason: string) {
    if (role !== "admin" || decision.teamId !== activeTeam.id) {
      return "이 팀의 관리자만 결정을 무효 처리할 수 있습니다.";
    }
    try {
      await invalidateDecision(decision.id, reason);
    } catch (error) {
      return meetingError("결정 무효 처리 실패", error);
    }

    setDecisions((items) => items.filter((item) => item.id !== decision.id));
    try {
      const rows = await fetchTeamHistory(decision.teamId);
      setHistory((items) => [...items.filter((item) => item.teamId !== decision.teamId), ...rows]);
      setToast("결정을 무효 처리했습니다.");
    } catch (error) {
      setToast(meetingError("결정은 무효 처리됐습니다. 이력을 보려면 화면을 새로고침해 주세요", error));
    }
    return null;
  }

  function openResolution(meeting: Meeting, candidate: Candidate) {
    if (!meeting.example && decisionsReadyTeamId !== meeting.teamId) {
      setToast("현재 유효한 결정을 불러온 뒤 다시 시도해 주세요.");
      return;
    }
    setResolveTarget({ meetingId: meeting.id, candidateId: candidate.id });
    setDialog("resolve");
  }
  async function applyResolution(
    method: Resolution | "new",
    reason: string,
    previousDecisionId?: string,
  ) {
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
    // 선택한 ID와 프로젝트가 일치하는 결정에만 반영한다.
    const previous = previousDecisionId
      ? teamDecisions.find(
          (decision) =>
            decision.id === previousDecisionId &&
            !!targetCandidate.projectId &&
            decision.projectId === targetCandidate.projectId &&
            decision.evidence.documentId !== targetMeeting.id,
        )
      : undefined;
    if (
      (targetCandidate.projectId && !teamProjects.some((project) => project.id === targetCandidate.projectId)) ||
      (previousDecisionId && !previous) ||
      (method !== "new" && !previous) ||
      (method === "new" && previous)
    ) {
      setToast("비교 대상과 프로젝트를 다시 확인해 주세요.");
      return;
    }
    if (!targetMeeting.example) {
      try {
        await resolveCandidate({
          candidateId: targetCandidate.id,
          method,
          reason: reason.trim(),
          previousDecisionId: previous?.id,
        });
      } catch (error) {
        setToast(meetingError("처리 결과 저장 실패", error));
        return;
      }
    }

    updateMeeting(targetMeeting.id, (meeting) => {
      const candidates = meeting.candidates.map((candidate) =>
        candidate.id === targetCandidate.id
          ? {
              ...candidate,
              kind: previous ? ("change" as const) : ("new" as const),
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
    if (method === "replace" && previous && targetMeeting.example) {
      // 예시 회의록 흐름: 데모 업무의 재검토 표시를 화면에서만 바꾼다.
      // 실제 회의록은 DB(tasks.recheck)와 알림 트리거가 처리한다 (SFR-017).
      setTasks((items) => items.map((task) =>
        task.teamId === activeTeam.id && task.decisionId === previous.id
          ? { ...task, recheck: true }
          : task,
      ));
    }

    if (!targetMeeting.example) {
      const savedTeamId = activeTeam.id;
      try {
        const [freshDecisions, freshHistory, freshTasks] = await Promise.all([
          fetchTeamDecisions(savedTeamId),
          fetchTeamHistory(savedTeamId),
          fetchTeamTasks(savedTeamId),
        ]);
        setDecisions((items) => [...items.filter((item) => item.teamId !== savedTeamId), ...freshDecisions]);
        setHistory((items) => [...items.filter((item) => item.teamId !== savedTeamId), ...freshHistory]);
        setTasks((items) => [...items.filter((item) => item.teamId !== savedTeamId), ...freshTasks]);
        recordNotice(`${resolutionLabels[method]} 처리를 기록했습니다.`);
        refreshNotifications();
      } catch (error) {
        setDecisionsReadyTeamId(null);
        setToast(meetingError("결정은 저장됐지만 변경 결과를 불러오지 못했습니다. 다시 접속해 주세요", error));
      }
      setDialog(null);
      return;
    }

    const nextDecision: Decision = {
      id:
        previous && method === "replace"
          ? previous.id
          : crypto.randomUUID(),
      teamId: activeTeam.id,
      title: targetCandidate.title,
      projectId: targetCandidate.projectId,
      owner: targetCandidate.owner,
      dueDate: targetCandidate.dueDate,
      evidence: targetCandidate.evidence,
      exception: method === "exception",
    };
    if (method === "replace" || method === "exception" || method === "new") {
      setDecisions((items) =>
        previous && method === "replace"
          ? items.map((decision) =>
              decision.id === previous.id ? nextDecision : decision,
            )
          : [nextDecision, ...items],
      );
    }
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
        before: previous?.title || "신규 결정",
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

  // 후속 업무 후보 처리 — 확정 시 apply_task_candidate RPC가 tasks를 만들고
  // 담당자에게 알림을 보낸다. 제외는 기각만 기록한다 (SFR-016 검수 단계).
  function openTaskResolution(meeting: Meeting, candidate: Candidate) {
    setTaskTarget({ meetingId: meeting.id, candidateId: candidate.id });
    setDialog("task");
  }
  async function applyTaskCandidate(
    method: "confirm" | "discard",
    reason: string,
  ) {
    if (!user || role !== "admin" || !taskTarget || !reason.trim()) return;
    const meeting = teamMeetings.find((item) => item.id === taskTarget.meetingId);
    const candidate = meeting?.candidates.find(
      (item) => item.id === taskTarget.candidateId,
    );
    if (
      !meeting ||
      !candidate ||
      !candidate.confirmed ||
      candidate.resolution ||
      meeting.status !== "submitted"
    ) {
      setToast("처리할 수 있는 후속 업무 후보가 아닙니다. 화면을 다시 불러와 주세요.");
      return;
    }
    try {
      await resolveTaskCandidate({
        candidateId: candidate.id,
        method,
        reason: reason.trim(),
      });
    } catch (error) {
      setToast(meetingError("후속 업무 처리 저장 실패", error));
      return;
    }
    updateMeeting(meeting.id, (item) => {
      const candidates = item.candidates.map((entry) =>
        entry.id === candidate.id
          ? { ...entry, resolution: method, reason: reason.trim() }
          : entry,
      );
      return {
        ...item,
        candidates,
        status: candidates.every(
          (entry) => !entry.confirmed || entry.resolution,
        )
          ? "done"
          : "submitted",
      };
    });
    const savedTeamId = activeTeam.id;
    try {
      const freshTasks = await fetchTeamTasks(savedTeamId);
      setTasks((items) => [
        ...items.filter((entry) => entry.teamId !== savedTeamId),
        ...freshTasks,
      ]);
      recordNotice(
        method === "confirm"
          ? "후속 업무를 확정했습니다. 담당자에게 알림을 보냈습니다."
          : "후속 업무 후보를 제외했습니다.",
      );
      refreshNotifications();
    } catch (error) {
      setToast(
        meetingError("후속 업무는 처리됐지만 업무 목록을 새로 불러오지 못했습니다", error),
      );
    }
    setDialog(null);
  }
  async function createTeam(event: FormEvent) {
    event.preventDefault();
    if (!user || !teamName.trim() || !authUser) return;
    const name = teamName.trim();
    setToast("팀을 생성하는 중...");
    try {
      const newId = await createTeamRemote(name);
      // Supabase에서 방금 만든 팀(본인이 ADMIN)까지 다시 fetch
      const refreshed = await fetchMyTeams();
      setTeams(refreshed);
      setTeamId(
        refreshed.find((t) => t.id === newId)?.id ?? refreshed[0]?.id ?? null,
      );
      setTeamName("");
      setDialog(null);
      go("overview");
      setToast("새 팀을 만들었습니다. 이 팀의 관리자로 시작합니다.");
    } catch (err: unknown) {
      setToast(
        err instanceof Error
          ? `팀 생성 실패: ${err.message}`
          : "팀 생성에 실패했습니다.",
      );
    }
  }
  async function changeMemberRole(id: string, nextRole: Member["role"]) {
    if (role !== "admin" || !hasTeam) return;
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
    // 낙관적 업데이트: UI 먼저 반영
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
    try {
      await changeMemberRoleRemote(activeTeam.id, id, nextRole);
      recordNotice("팀원 역할을 변경했습니다.");
    } catch (err: unknown) {
      // 실패 시 원래 상태로 되돌림
      const refreshed = await fetchMyTeams().catch(() => teams);
      setTeams(refreshed);
      setToast(
        err instanceof Error
          ? `역할 변경 실패: ${err.message}`
          : "역할 변경에 실패했습니다.",
      );
    }
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
              회원가입·로그인·팀 관리와 회의록·결정·업무·알림은 Supabase에
              연결되어 실제 저장됩니다. 직접 선택한 PDF·TXT는 서버에서 결정
              사항과 후속 업무를 분석하고 원문과 함께 확인할 수 있습니다. 회의
              사진은 아직 화면 시연용입니다.
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
                  관리자 권한을 받은 팀에 들어가면 처리 대기의 후보를 비교하고
                  사유를 남겨 최종 반영할 수 있습니다.
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
              로그아웃해도 팀·회의록·결정 데이터는 Supabase에 저장되어 다음
              로그인 시 그대로 불러옵니다.
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
            {teamNotifications.length ? (
              teamNotifications.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <p>
                      <strong>{item.title || "알림"}</strong>
                      {!item.readAt && (
                        <span
                          className="badge badge-amber"
                          style={{ marginLeft: "0.5rem" }}
                        >
                          안 읽음
                        </span>
                      )}
                    </p>
                    <p className="small muted">{item.body}</p>
                    <p className="small muted">
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          })
                        : ""}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">새 알림이 없습니다.</p>
            )}
            <div className="row-actions">
              <button
                className="button button-secondary"
                disabled={!unread.length}
                onClick={async () => {
                  try {
                    await markNotificationsRead(unread.map((item) => item.id));
                    setNotifications((items) =>
                      items.map((item) =>
                        unread.some((mark) => mark.id === item.id)
                          ? { ...item, readAt: new Date().toISOString() }
                          : item,
                      ),
                    );
                  } catch (error) {
                    setToast(meetingError("알림 읽음 처리 실패", error));
                  }
                }}
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
      {dialog === "invitations" && (
        <Modal title="받은 팀 초대" onClose={() => setDialog(null)}>
          <div className="stack">
            {invitationsLoading && <p className="muted">초대를 불러오는 중…</p>}
            {!invitationsLoading && pendingInvitations.length === 0 && (
              <p className="muted">받은 초대가 없습니다.</p>
            )}
            {pendingInvitations.map((invitation) => (
              <div className="list-row" key={invitation.teamId}>
                <div>
                  <strong>{invitation.teamName}</strong>
                  <p className="small muted">
                    {invitation.role === "admin" ? "관리자" : "일반 팀원"} 초대
                  </p>
                </div>
                <div className="row-actions">
                  <InvitationActionButton
                    teamId={invitation.teamId}
                    kind="accept"
                    onDone={async () => {
                      try {
                        await acceptInvitation(invitation.teamId);
                        const refreshed = await refreshTeamsAndInvitations();
                        // 수락한 팀이 결과에 있으면 해당 팀으로 이동
                        if (
                          refreshed &&
                          refreshed.some((t) => t.id === invitation.teamId)
                        ) {
                          setTeamId(invitation.teamId);
                        }
                        setToast(`${invitation.teamName} 팀에 참여했습니다.`);
                      } catch (err: unknown) {
                        setToast(
                          err instanceof Error
                            ? `수락 실패: ${err.message}`
                            : "수락에 실패했습니다.",
                        );
                      }
                    }}
                  />
                  <InvitationActionButton
                    teamId={invitation.teamId}
                    kind="decline"
                    onDone={async () => {
                      try {
                        await declineInvitation(invitation.teamId);
                        await refreshTeamsAndInvitations();
                        setToast("초대를 거절했습니다.");
                      } catch (err: unknown) {
                        setToast(
                          err instanceof Error
                            ? `거절 실패: ${err.message}`
                            : "거절에 실패했습니다.",
                        );
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {dialog === "resolve" && targetMeeting && targetCandidate && (
        <ResolveDialog
          key={targetCandidate.id}
          candidate={targetCandidate}
          projectName={
            teamProjects.find(
              (project) => project.id === targetCandidate.projectId,
            )?.name ?? "미분류"
          }
          existing={teamDecisions.filter(
            (decision) =>
              !!targetCandidate.projectId &&
              decision.projectId === targetCandidate.projectId &&
              decision.evidence.documentId !== targetMeeting.id,
          )}
          meetings={teamMeetings}
          admin={role === "admin"}
          onSource={setSource}
          onApply={applyResolution}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "task" && taskMeeting && taskCandidate && (
        <TaskCandidateDialog
          key={taskCandidate.id}
          candidate={taskCandidate}
          meetingTitle={taskMeeting.title}
          meetingDate={taskMeeting.date}
          admin={role === "admin"}
          onSource={setSource}
          onApply={applyTaskCandidate}
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
              <p className="landing-demo-note">
                로그인 후 팀을 만들거나 초대받은 팀에서 작업을 시작합니다.
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

  // 팀이 없는 경우 (방금 가입한 신규 사용자)
  if (!hasTeam) {
    return (
      <>
        <div className="app-layout">
          <aside className="sidebar">
            <button
              className="brand brand-button"
              onClick={() => go("overview")}
            >
              로딩중
            </button>
            <p className="sidebar-subtitle">회의의 결정을 잇다</p>
            <p className="workspace-label">WORKSPACE</p>
            <button
              className={`sidebar-user profile-button ${route.page === "profile" ? "profile-active" : ""}`}
              onClick={() => go("profile")}
            >
              <strong>{user.name}</strong>
              <span>내 정보 ↗</span>
            </button>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <p className="breadcrumb">워크스페이스 / 팀 없음</p>
              <div className="topbar-actions">
                <button
                  className="text-button"
                  onClick={() => setDialog("invitations")}
                >
                  초대
                  {pendingInvitations.length > 0 && (
                    <span className="nav-count">
                      {pendingInvitations.length}
                    </span>
                  )}
                </button>
                <button
                  className="text-button"
                  onClick={() => setDialog("logout")}
                >
                  로그아웃
                </button>
              </div>
            </header>
            <main className="main-content">
              <section className="card stack">
                <h2>아직 소속된 팀이 없습니다</h2>
                <p className="muted">
                  새 팀을 만들어 회의록·결정·업무를 관리하거나, 다른 팀의
                  관리자가 회원님을 초대할 때까지 기다릴 수 있습니다.
                </p>
                {pendingInvitations.length > 0 && (
                  <div className="subtle-panel row-between">
                    <p>
                      <strong>받은 초대 {pendingInvitations.length}건</strong>이
                      있습니다. 상단 “초대” 버튼을 눌러 수락하세요.
                    </p>
                    <button
                      className="button button-primary"
                      onClick={() => setDialog("invitations")}
                    >
                      초대 확인
                    </button>
                  </div>
                )}
                {teamsError && (
                  <p className="error-message" role="alert">
                    팀 목록 불러오기 실패: {teamsError}
                  </p>
                )}
                <div className="row-actions">
                  <button
                    className="button button-primary"
                    onClick={() => setDialog("newteam")}
                  >
                    새 팀 만들기
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() =>
                      authUser &&
                      refreshTeamsAndInvitations().catch((e: unknown) =>
                        setTeamsError(
                          e instanceof Error ? e.message : String(e),
                        ),
                      )
                    }
                  >
                    새로고침
                  </button>
                </div>
              </section>
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
              {teamsLoading && (
                <span className="small muted">팀 동기화 중…</span>
              )}
              <button
                className="text-button"
                onClick={() => setDialog("invitations")}
              >
                초대
                {pendingInvitations.length > 0 && (
                  <span className="nav-count">{pendingInvitations.length}</span>
                )}
              </button>
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
              meetingsLoading ? (
                <section className="card">
                  <p className="muted">회의록을 불러오는 중…</p>
                </section>
              ) : (
                <MeetingList
                  meetings={teamMeetings}
                  go={go}
                  onCreateProject={createProject}
                  deletingMeetingId={deletingMeetingId}
                  onDelete={handleDeleteMeeting}
                />
              )
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
                deletingMeetingId={deletingMeetingId}
                onDelete={handleDeleteMeeting}
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
                projects={teamProjects}
                onCreateProject={createProject}
                go={go}
                onSource={setSource}
                submitting={submittingReview}
                onSubmit={() => submitReview(currentMeeting)}
                onRetry={() => retryAnalysis(currentMeeting)}
                retrying={retryingMeetingId === currentMeeting.id}
                onStatus={(status) => {
                  updateMeeting(currentMeeting.id, (meeting) => ({
                    ...meeting,
                    status,
                  }));
                  if (!currentMeeting.example) {
                    void updateMeetingStatus(currentMeeting.id, status).catch(() => {
                      setToast("상태 변경을 서버에 저장하지 못했습니다.");
                    });
                  }
                }}
                onEdit={(candidate) => {
                  if (currentMeeting.status === "review" && !submittingReview) {
                    updateMeeting(currentMeeting.id, (meeting) => ({
                      ...meeting,
                      candidates: meeting.candidates.map((item) =>
                        item.id === candidate.id ? candidate : item,
                      ),
                    }));
                    if (!currentMeeting.example) {
                      void saveReviewCandidate(candidate).catch((error) => {
                        setToast(meetingError("후보 수정 저장 실패", error));
                      });
                    }
                  }
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
                projects={teamProjects}
                history={teamHistory}
                role={role}
                go={go}
                onSource={setSource}
                onResolve={openResolution}
                onTaskResolve={openTaskResolution}
                onInvalidate={handleInvalidateDecision}
              />
            )}
            {route.page === "tasks" && (
              <TasksPage
                tasks={teamTasks}
                user={user}
                role={role}
                onUpdate={(task) => {
                  if (role !== "admin" && task.owner !== user.name) return;
                  setTasks((items) =>
                    items.map((item) => (item.id === task.id ? task : item)),
                  );
                  // 업무 상태·재검토 완료를 tasks 테이블에 저장한다 (SFR-016/017).
                  void updateTaskRow(task).catch((error) => {
                    setToast(meetingError("업무 상태 저장 실패", error));
                    void fetchTeamTasks(activeTeam.id)
                      .then((rows) =>
                        setTasks((items) => [
                          ...items.filter(
                            (item) => item.teamId !== activeTeam.id,
                          ),
                          ...rows,
                        ]),
                      )
                      .catch(() => {});
                  });
                }}
                go={go}
              />
            )}
            {route.page === "chat" && (
              <ChatPage
                key={activeTeam.id}
                meetings={teamMeetings}
                onSource={setSource}
              />
            )}
            {route.page === "team" && (
              <TeamPage
                team={activeTeam}
                role={role}
                currentUser={user}
                onCreate={() => setDialog("newteam")}
                onRole={changeMemberRole}
                onAdd={async (member) => {
                  if (
                    role !== "admin" ||
                    !hasTeam ||
                    activeTeam.members.some((item) => item.id === member.id)
                  )
                    return;
                  // 낙관적 업데이트: pendingMembers 에 즉시 추가
                  setTeams((items) =>
                    items.map((team) =>
                      team.id === activeTeam.id
                        ? {
                            ...team,
                            pendingMembers: [
                              ...(team.pendingMembers ?? []),
                              member,
                            ],
                          }
                        : team,
                    ),
                  );
                  try {
                    await inviteMember(activeTeam.id, member.id, member.role);
                    // 서버 상태 동기화 (초대 알림은 받는 사람에게만 보이므로 여기선 팀 목록만)
                    const refreshed = await fetchMyTeams().catch(() => teams);
                    setTeams(refreshed);
                    setToast(
                      `${member.name}님에게 초대를 보냈습니다. 상대방이 수락하면 정식 팀원이 됩니다.`,
                    );
                  } catch (err: unknown) {
                    // 실패 시 원래 상태로 되돌림
                    const refreshed = await fetchMyTeams().catch(() => teams);
                    setTeams(refreshed);
                    setToast(
                      err instanceof Error
                        ? `초대 실패: ${err.message}`
                        : "초대에 실패했습니다.",
                    );
                  }
                }}
                onRemove={async (memberId) => {
                  if (role !== "admin" || !hasTeam) return;
                  const target = activeTeam.members.find(
                    (member) => member.id === memberId,
                  );
                  // 낙관적 업데이트
                  setTeams((items) =>
                    items.map((team) =>
                      team.id === activeTeam.id
                        ? {
                            ...team,
                            members: team.members.filter(
                              (member) => member.id !== memberId,
                            ),
                          }
                        : team,
                    ),
                  );
                  try {
                    await removeMemberRemote(activeTeam.id, memberId);
                    recordNotice(
                      `${target?.name ?? "팀원"}님을 팀에서 제거했습니다.`,
                    );
                  } catch (err: unknown) {
                    const refreshed = await fetchMyTeams().catch(() => teams);
                    setTeams(refreshed);
                    setToast(
                      err instanceof Error
                        ? `제거 실패: ${err.message}`
                        : "제거에 실패했습니다.",
                    );
                  }
                }}
                onLeave={async () => {
                  if (!hasTeam) return;
                  const leavingTeam = activeTeam;
                  try {
                    await leaveTeamRemote(leavingTeam.id);
                    const refreshed = await refreshTeamsAndInvitations();
                    // 나간 팀이 활성 팀이었으면 다른 팀으로 전환
                    setTeamId((prev) => {
                      if (prev !== leavingTeam.id) return prev;
                      return refreshed && refreshed.length > 0
                        ? refreshed[0].id
                        : null;
                    });
                    setToast(`${leavingTeam.name} 팀에서 나갔습니다.`);
                    if (!refreshed || refreshed.length === 0) {
                      go("overview");
                    }
                  } catch (err: unknown) {
                    setToast(
                      err instanceof Error
                        ? `탈퇴 실패: ${err.message}`
                        : "탈퇴에 실패했습니다.",
                    );
                  }
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
              팀·회의록·결정·업무·알림은 Supabase에 저장됩니다 · 회의 사진은
              아직 화면 시연 데이터입니다
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
  projectName,
  existing,
  meetings,
  admin,
  onSource,
  onApply,
  onClose,
}: {
  candidate: Candidate;
  projectName: string;
  existing: Decision[];
  meetings: Meeting[];
  admin: boolean;
  onSource: (source: Evidence) => void;
  onApply: (
    method: Resolution | "new",
    reason: string,
    previousDecisionId?: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  // 팝업을 열었을 때의 입력으로 비교하고, 재시도할 때만 다시 요청한다.
  const [input] = useState(() => ({ candidate, existing, meetings }));
  const hasExisting = input.existing.length > 0;
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [method, setMethod] = useState<Resolution>("hold");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hasExisting) return;

    const request = new AbortController();
    setComparison(null);
    setError("");
    setSelectedId("");
    compareDecision(input.candidate, input.existing, input.meetings, request.signal)
      .then((result) => {
        if (request.signal.aborted) return;
        setComparison(result);
        // 관련 결정이 여러 개면 사용자가 직접 비교 대상을 고른다.
        setSelectedId(result.matches.length === 1 ? result.matches[0].decisionId : "");
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) {
          setError(error instanceof Error ? error.message : "결정 비교에 실패했습니다.");
        }
      });
    return () => request.abort();
  }, [hasExisting, input, attempt]);

  const selectedMatch = comparison?.matches.find(
    (match) => match.decisionId === selectedId,
  );
  const previous = selectedMatch
    ? input.existing.find((decision) => decision.id === selectedMatch.decisionId)
    : undefined;
  const needsSelection = !!comparison?.matches.length && !previous;
  const ready = !hasExisting || (!!comparison && !error && !needsSelection);

  return (
    <Modal
      title={
        comparison?.matches.length
          ? "기존 결정과 새 후보 비교"
          : ready
            ? "신규 결정 검토"
            : "결정 후보 검토"
      }
      wide
      onClose={() => { if (!saving) onClose(); }}
    >
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!admin || !ready || !reason.trim() || saving) return;
          setSaving(true);
          try {
            await onApply(previous ? method : "new", reason, previous?.id);
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="muted">
          프로젝트: {projectName}
          {hasExisting
            ? ` · 다른 회의록의 유효 결정 ${input.existing.length}개와 비교합니다.`
            : " · 이 프로젝트에 비교할 다른 회의록의 유효 결정이 없습니다."}
        </p>
        {hasExisting && !comparison && !error && (
          <p className="notice-message" role="status">
            같은 업무에 대한 기존 결정을 찾고 차이점을 분석하고 있습니다.
          </p>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
        {(error || comparison) && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setComparison(null);
              setError("");
              setSelectedId("");
              setAttempt((value) => value + 1);
            }}
          >
            다시 비교
          </button>
        )}
        {!!comparison?.matches.length && (
          <label className="field">
            <span>비교할 기존 결정</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">기존 결정을 선택하세요</option>
              {comparison.matches.map((match) => {
                const decision = input.existing.find((item) => item.id === match.decisionId);
                return (
                  <option key={match.decisionId} value={match.decisionId}>
                    {comparisonLabels[match.relation]} · {decision?.title}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <div className="comparison-grid">
          {previous && (
            <section className="comparison-card">
              <span className="badge badge-gray">기존 확정 결정</span>
              <h3>{previous.title}</h3>
              <p className="muted">
                {previous.owner || "담당자 미확인"} · {previous.dueDate || "기한 미확인"}
              </p>
              <SourceButton source={previous.evidence} onSource={onSource} label="기존 결정 원문" />
            </section>
          )}
          <section className="comparison-card comparison-new">
            <span className="badge">새 결정 후보</span>
            <h3>{candidate.title}</h3>
            <p className="muted">
              {candidate.owner || "담당자 미확인"} · {candidate.dueDate || "기한 미확인"}
            </p>
            <SourceButton source={candidate.evidence} onSource={onSource} label="새 후보 원문" />
          </section>
        </div>
        {comparison && (
          <div className="subtle-panel">
            <strong>{selectedMatch ? comparisonLabels[selectedMatch.relation] : "AI 비교 결과"}</strong>
            <p>{selectedMatch?.reason ?? comparison.reason}</p>
            {needsSelection && <p>관련 기존 결정 중 비교할 항목을 선택해 주세요.</p>}
          </div>
        )}
        {admin ? (
          <>
            {previous && (
              <fieldset className="resolution-options">
                <legend>처리 방식 선택</legend>
                {(["keep", "replace", "exception", "hold"] as const).map((value) => (
                  <label key={value} className={method === value ? "selected" : ""}>
                    <input
                      type="radio"
                      name="resolution"
                      value={value}
                      checked={method === value}
                      onChange={() => setMethod(value)}
                    />
                    {resolutionLabels[value]}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="field">
              <span>처리 사유 <span className="required">필수</span></span>
              <textarea
                rows={3}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  previous
                    ? "양쪽 원문을 확인하고 처리 사유를 적어 주세요."
                    : "새 후보의 원문을 확인하고 반영 사유를 적어 주세요."
                }
              />
            </label>
            <div className="row-actions">
              <button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>
                취소
              </button>
              <button className="button button-primary" disabled={saving || !ready || !reason.trim()}>
                {previous ? "선택한 방식으로 처리" : "현재 결정에 반영"}
              </button>
            </div>
          </>
        ) : (
          <p className="notice-message">
            비교 내용과 원문을 확인할 수 있습니다. 최종 처리는 관리자 권한이 필요합니다.
          </p>
        )}
      </form>
    </Modal>
  );
}

// 후속 업무 후보 처리 다이얼로그 — 관리자가 사유를 적고 확정/제외를 고른다.
// 확정하면 apply_task_candidate RPC가 tasks에 업무를 만들고 담당자에게 알린다.
function TaskCandidateDialog({
  candidate,
  meetingTitle,
  meetingDate,
  admin,
  onSource,
  onApply,
  onClose,
}: {
  candidate: Candidate;
  meetingTitle: string;
  meetingDate: string;
  admin: boolean;
  onSource: (source: Evidence) => void;
  onApply: (method: "confirm" | "discard", reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (method: "confirm" | "discard") => {
    if (!admin || !reason.trim() || saving) return;
    setSaving(true);
    try {
      await onApply(method, reason);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="후속 업무 후보 처리"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit("confirm");
        }}
      >
        <div className="row-between">
          <span className="badge badge-amber">후속 업무</span>
          <SourceButton source={candidate.evidence} onSource={onSource} />
        </div>
        <h3>{candidate.title}</h3>
        <p className="muted">
          {meetingDate} · {meetingTitle} ·{" "}
          {candidate.owner || "담당자 미확인"} ·{" "}
          {candidate.dueDate || "기한 미확인"}
        </p>
        <p className="muted">
          확정하면 “내 업무” 화면에 등록되고 담당자에게 알림이 갑니다. 제외하면
          처리 사유만 기록됩니다.
        </p>
        <div className="field">
          <label htmlFor="task-candidate-reason">처리 사유</label>
          <textarea
            id="task-candidate-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="예: 담당자·기한 확인 완료"
          />
        </div>
        {!admin && (
          <p className="notice-message" role="status">
            최종 확정·제외는 관리자만 할 수 있습니다.
          </p>
        )}
        <div className="row-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={!admin || saving || !reason.trim()}
          >
            {saving ? "저장 중…" : "업무로 확정"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!admin || saving || !reason.trim()}
            onClick={() => void submit("discard")}
          >
            제외
          </button>
        </div>
      </form>
    </Modal>
  );
}

// 초대 수락/거절 버튼 — 클릭 시 로딩 상태 표시 후 onDone 호출
function InvitationActionButton({
  kind,
  onDone,
}: {
  teamId: string;
  kind: "accept" | "decline";
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={
        kind === "accept" ? "button button-primary" : "button button-secondary"
      }
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onDone();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "처리 중…" : kind === "accept" ? "수락" : "거절"}
    </button>
  );
}
