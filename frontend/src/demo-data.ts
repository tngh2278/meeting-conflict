import type { ExtractedDocument, MeetingAnalysis } from "./document-api";

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
// confirm/discard 는 후속 업무(kind='action_item') 후보의 처리 결과다.
export type Resolution =
  | "keep"
  | "replace"
  | "exception"
  | "hold"
  | "confirm"
  | "discard";
export type Evidence = {
  documentId: string;
  page: number | null;
  paragraph: number;
  startOffset: number | null;
  endOffset: number | null;
  quote: string;
};
export type Project = {
  id: string;
  teamId: string;
  name: string;
};

export type Candidate = {
  id: string;
  projectId?: string;
  title: string;
  owner: string;
  dueDate: string;
  confirmed: boolean;
  // "new"/"change" = 결정 후보, "action_item" = 후속 업무 후보 (검토 후 tasks로 감)
  kind: "change" | "new" | "action_item";
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
  extractedDocument?: ExtractedDocument;
  status: "ready" | "analyzing" | "failed" | "review" | "submitted" | "done";
  example: boolean;
  candidates: Candidate[];
  photos: MeetingPhoto[];
};
export type Member = { id: string; name: string; email: string; role: Role };
// pendingMembers: 초대를 보냈지만 아직 수락 전(PENDING)인 사용자.
// Supabase 실제 데이터에만 존재하며, 로컬 시연 데이터(initialTeams)에는 사용하지 않음.
export type Team = {
  id: string;
  name: string;
  members: Member[];
  pendingMembers?: Member[];
};
export type Decision = {
  id: string;
  projectId?: string;
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
  method: Resolution | "new" | "invalidate";
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
  meetingId?: string;
};
export type UploadDraft = {
  file: File;
  title: string;
  date: string;
  location: string;
  tags: string;
  example: boolean;
  extractedDocument?: ExtractedDocument;
  analysis?: MeetingAnalysis;
  // 분석 실패 시 원본만 저장하고 재시도(SFR-027)할 수 있게 실패 사유를 전달한다.
  analysisError?: string;
  photos: File[];
  photoConsent: boolean;
};

export const DEMO_DATE = "2026-10-13";
// D-Day는 오늘 날짜(한국 시간)를 기준으로 계산한다. (SFR-021)
export function daysLeft(date: string) {
  // 마감일이 없는 업무(결정에 마감일이 null인 경우)는 D-Day 대신 빈 값을 보여 준다.
  if (!date || isNaN(Date.parse(`${date}T00:00:00+09:00`))) return "";
  const kstToday = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const difference = Math.round(
    (Date.parse(`${date}T00:00:00+09:00`) -
      Date.parse(`${kstToday}T00:00:00+09:00`)) /
      86400000,
  );
  return difference === 0
    ? "D-Day"
    : difference > 0
      ? `D-${difference}`
      : `D+${Math.abs(difference)}`;
}
export const resolutionLabels: Record<ChangeRecord["method"], string> = {
  keep: "기존 결정 유지",
  replace: "새 결정으로 교체",
  exception: "예외로 두기",
  hold: "논의 중으로 보류",
  new: "신규 결정 반영",
  invalidate: "무효 처리",
  confirm: "후속 업무 확정",
  discard: "후속 업무 제외",
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
// 업무(Task)는 demo 데이터를 쓰지 않는다 — lib/tasks.ts 로 Supabase tasks 테이블을
// 직접 조회한다 (SFR-016).
