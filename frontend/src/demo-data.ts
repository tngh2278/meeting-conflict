// ============================================================================
// 타입 정의 + 회의록/결정/업무 데모 데이터
// ============================================================================
// 팀·팀원 관련 더미 데이터는 제거되었습니다 (Supabase로 대체).
// 아래 데모 데이터(meetings/decisions/tasks)는 회의록 기능이 Supabase로
// 옮겨지기 전까지 로컬 시연용으로만 사용됩니다.
// ============================================================================

export type Role = "admin" | "member";
export type Page =
  | "overview"
  | "meetings"
  | "upload"
  | "meeting"
  | "review"
  | "decisions"
  | "tasks"
  | "chat"
  | "team"
  | "profile";
export type Navigate = (page: Page, id?: string) => void;
export type Resolution = "keep" | "replace" | "exception" | "hold";
export type Evidence = {
  documentId: string;
  page: number | null;
  paragraph: number;
  startOffset: number;
  endOffset: number;
  quote: string;
};
export type Candidate = {
  id: string;
  title: string;
  owner: string;
  dueDate: string;
  confirmed: boolean;
  kind: "change" | "new";
  evidence: Evidence;
  resolution?: Resolution;
  reason?: string;
};
export type FaceMatch = { id: string; name: string; confirmed: boolean };
export type MeetingPhoto = {
  id: string;
  name: string;
  url?: string;
  example: boolean;
  reviewed: boolean;
  consent: boolean;
  takenAt?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  addressStatus: "found" | "missing-gps" | "not-found" | "error";
  faces: FaceMatch[];
};
export type Meeting = {
  id: string;
  teamId: string;
  title: string;
  date: string;
  location: string;
  author: string;
  fileName: string;
  fileUrl?: string;
  format: "PDF" | "TXT";
  tags: string;
  paragraphs: string[];
  status: "ready" | "analyzing" | "failed" | "review" | "submitted" | "done";
  example: boolean;
  candidates: Candidate[];
  photos: MeetingPhoto[];
};
export type Member = { id: string; name: string; email: string; role: Role };
export type Team = { id: string; name: string; members: Member[] };
export type Decision = {
  id: string;
  teamId: string;
  title: string;
  owner: string;
  dueDate: string;
  evidence: Evidence;
  exception?: boolean;
};
export type ChangeRecord = {
  id: string;
  teamId: string;
  title: string;
  before: string;
  after: string;
  method: Resolution | "new";
  reason: string;
  actor: string;
  at: string;
  evidence: Evidence;
};
export type Task = {
  id: string;
  teamId: string;
  title: string;
  owner: string;
  dueDate: string;
  status: "대기" | "진행 중" | "완료";
  recheck: boolean;
  decisionId: string;
};
export type UploadDraft = {
  file: File;
  title: string;
  date: string;
  location: string;
  tags: string;
  example: boolean;
  text: string;
  photos: File[];
  photoConsent: boolean;
};

export const DEMO_DATE = "2026-10-13";
export function daysLeft(date: string) {
  const difference = Math.round(
    (Date.parse(`${date}T00:00:00+09:00`) -
      Date.parse(`${DEMO_DATE}T00:00:00+09:00`)) /
      86400000,
  );
  return difference === 0
    ? "D-Day"
    : difference > 0
      ? `D-${difference}`
      : `D+${Math.abs(difference)}`;
}
export const resolutionLabels: Record<Resolution | "new", string> = {
  keep: "기존 결정 유지",
  replace: "새 결정으로 교체",
  exception: "예외로 두기",
  hold: "논의 중으로 보류",
  new: "신규 결정 반영",
};
export const statusLabels: Record<Meeting["status"], string> = {
  ready: "분석 대기",
  analyzing: "분석 중",
  failed: "분석 실패",
  review: "검토 필요",
  submitted: "관리자 확인 대기",
  done: "처리 완료",
};

// ---------------------------------------------------------------------------
// 회의록 시연용 단락 (예시 데이터 — Supabase meetings 테이블 연동 전까지 사용)
// ---------------------------------------------------------------------------
export const oldParagraphs = [
  "행사 준비 기준 회의 · 2026년 10월 6일\n참석자: 송채은, 장준경, 정수호",
  "행사 준비 자료는 2026년 10월 15일 18:00까지 제출하기로 확정한다. 송채은이 자료를 취합하고, 장준경은 안내문 초안을 작성한다.",
  "행사 안내문 초안은 10월 16일까지 공유한다. 자료 제출 마감 변경 시 안내문에 반영할 내용을 다시 확인한다.",
];
export const newParagraphs = [
  "행사 준비 회의 · 2026년 10월 13일\n참석자: 장준경, 송채은, 정수호\n장소: 학생회관 회의실",
  "행사 준비 자료의 제출 마감을 2026년 10월 15일 18:00에서 같은 날 20:00으로 변경하기로 확정한다. 송채은은 10월 14일까지 변경 내용을 공지한다.",
  "장준경은 2026년 10월 16일까지 행사 안내문 초안을 작성하고, 변경된 자료 제출 마감을 포함한다.",
  "회의록은 업로드 후 이틀 안에 검토하자는 제안이 나왔다. 구체적인 담당자와 기한은 다음 회의에서 다시 논의한다.",
];
export function evidence(
  documentId: string,
  paragraph: number,
  quote: string,
): Evidence {
  return {
    documentId,
    page: null,
    paragraph,
    startOffset: 0,
    endOffset: quote.length,
    quote,
  };
}
export function exampleCandidates(documentId: string): Candidate[] {
  return [
    {
      id: `${documentId}-deadline`,
      title: "행사 준비 자료 제출 마감을 10월 15일 20:00으로 변경",
      owner: "송채은",
      dueDate: "2026-10-15",
      confirmed: true,
      kind: "change",
      evidence: evidence(documentId, 2, newParagraphs[1]),
    },
    {
      id: `${documentId}-guide`,
      title: "변경된 마감을 포함한 행사 안내문 초안 작성",
      owner: "장준경",
      dueDate: "2026-10-16",
      confirmed: true,
      kind: "new",
      evidence: evidence(documentId, 3, newParagraphs[2]),
    },
    {
      id: `${documentId}-proposal`,
      title: "회의록 업로드 후 이틀 내 검토 제안",
      owner: "",
      dueDate: "",
      confirmed: false,
      kind: "new",
      evidence: evidence(documentId, 4, newParagraphs[3]),
    },
  ];
}
export function examplePhoto(): MeetingPhoto {
  return {
    id: `photo-example-${Date.now()}`,
    name: "회의 사진 예시",
    example: true,
    reviewed: false,
    consent: true,
    takenAt: "2026-10-13 14:30:00",
    timezone: "+09:00",
    latitude: 37.5665,
    longitude: 126.978,
    address: "서울특별시 중구 세종대로 110 (가상 회의 예시)",
    addressStatus: "found",
    faces: [
      { id: "face-1", name: "장준경", confirmed: false },
      { id: "face-2", name: "정수호", confirmed: false },
      { id: "face-3", name: "미등록 얼굴", confirmed: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// 회의록/결정/업무 초기 데모 데이터
// ---------------------------------------------------------------------------
// 주의: teamId가 "service"로 하드코딩되어 있습니다.
// 이 데이터는 회의록 기능이 Supabase로 옮겨지기 전까지 임시로 표시되며,
// 새로 만든 팀에서는 회의록이 비어 있게 됩니다.
// ---------------------------------------------------------------------------
export const initialMeetings: Meeting[] = [
  {
    id: "meeting-new",
    teamId: "service",
    title: "행사 준비 회의",
    date: DEMO_DATE,
    location: "학생회관 회의실",
    author: "장준경",
    fileName: "행사_준비_회의.txt",
    format: "TXT",
    tags: "#행사준비 #마감변경",
    paragraphs: newParagraphs,
    status: "review",
    example: true,
    candidates: exampleCandidates("meeting-new"),
    photos: [examplePhoto()],
  },
  {
    id: "meeting-old",
    teamId: "service",
    title: "행사 준비 기준 회의",
    date: "2026-10-06",
    location: "학생회관 회의실",
    author: "송채은",
    fileName: "행사_준비_기준.txt",
    format: "TXT",
    tags: "#행사준비",
    paragraphs: oldParagraphs,
    status: "done",
    example: true,
    candidates: [],
    photos: [],
  },
];
export const initialDecisions: Decision[] = [
  {
    id: "decision-deadline",
    teamId: "service",
    title: "행사 준비 자료는 10월 15일 18:00까지 제출",
    owner: "송채은",
    dueDate: "2026-10-15",
    evidence: evidence("meeting-old", 2, oldParagraphs[1]),
  },
];
export const initialTasks: Task[] = [
  {
    id: "task-guide",
    teamId: "service",
    title: "행사 안내문 초안 작성",
    owner: "장준경",
    dueDate: "2026-10-16",
    status: "진행 중",
    recheck: false,
    decisionId: "decision-deadline",
  },
  {
    id: "task-check",
    teamId: "service",
    title: "행사 안내문에 자료 제출 마감 반영",
    owner: "장준경",
    dueDate: "2026-10-15",
    status: "대기",
    recheck: false,
    decisionId: "decision-deadline",
  },
  {
    id: "task-collect",
    teamId: "service",
    title: "행사 준비 자료 취합",
    owner: "송채은",
    dueDate: "2026-10-15",
    status: "대기",
    recheck: false,
    decisionId: "decision-deadline",
  },
];
