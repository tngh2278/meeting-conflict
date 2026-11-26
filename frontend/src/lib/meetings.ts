// 회의록 및 결정에 필요한 Supabase 데이터 접근을 담당한다.
import { supabase } from "./supabaseClient";
import type {
  Candidate,
  ChangeRecord,
  Decision,
  Meeting,
  Member,
  Project,
  Resolution,
  UploadDraft,
} from "../demo-data";
import type { ExtractedDocument } from "../document-api";

const MEETING_BUCKET = "meeting-files";

// ===========================================================================
// RPC Row 타입 — fetch_team_meetings 결과
// (users 가 users_select_self RLS 라 SECURITY DEFINER RPC 로 작성자 이름 조인)
// ===========================================================================
interface MeetingRpcRow {
  meeting_id: string;
  title: string;
  meeting_date: string | null; // DATE → "YYYY-MM-DD"
  location: string | null;
  tags: string; // TEXT 그대로 ("#a #b")
  file_name: string | null;
  file_format: "PDF" | "TXT" | null;
  file_url: string | null; // Storage 경로
  file_hash: string | null;
  file_size: number | null;
  status: Meeting["status"]; // 1:1
  summary: string | null;
  created_at: string;
  uploaded_by: string;
  uploaded_by_name: string | null;
}

function formatFallbackDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toMeeting(row: MeetingRpcRow, teamId: string): Meeting {
  const fileName = row.file_name ?? "";
  const format: Meeting["format"] =
    row.file_format ?? (/\.pdf$/i.test(fileName) ? "PDF" : "TXT");
  return {
    id: row.meeting_id,
    teamId,
    title: row.title,
    date: row.meeting_date ?? formatFallbackDate(row.created_at),
    location: row.location ?? "",
    author: row.uploaded_by_name ?? "알 수 없음",
    fileName,
    fileUrl: undefined, // 목록에선 불필요. 상세(fetchMeeting)에서 서명 URL 로 채움.
    format,
    tags: row.tags ?? "",
    paragraphs: [],
    status: row.status,
    example: false,
    candidates: [],
    photos: [], // meeting_photos 테이블 연동 전까지 빈 배열
  };
}

export async function fetchTeamProjects(teamId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("meeting_projects")
    .select("project_id, name")
    .eq("team_id", teamId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.project_id, teamId, name: row.name }));
}

export async function createTeamProject(teamId: string, name: string): Promise<Project> {
  const { data, error } = await supabase
    .from("meeting_projects")
    .insert({ team_id: teamId, name })
    .select("project_id, name")
    .single();
  if (error) throw error;
  return { id: data.project_id, teamId, name: data.name };
}

// 원문과 검토 후보를 함께 복원해 새로고침 직후에도 질문과 결정 처리를 할 수 있게 한다.
export async function fetchTeamMeetings(teamId: string): Promise<Meeting[]> {
  const { data, error } = await supabase.rpc("fetch_team_meetings", {
    target_team: teamId,
  });
  if (error) throw error;
  const meetings = ((data ?? []) as MeetingRpcRow[]).map((row) => toMeeting(row, teamId));
  if (!meetings.length) return [];

  const ids = meetings.map((meeting) => meeting.id);
  const [pages, paragraphs, candidates] = await Promise.all([
    fetchAllMeetingRows((start, end) => supabase
      .from("meeting_pages")
      .select("meeting_id, page_id, page_number, page_text")
      .in("meeting_id", ids)
      .order("page_number", { nullsFirst: true })
      .order("page_id")
      .range(start, end)),
    fetchAllMeetingRows((start, end) => supabase
      .from("meeting_paragraphs")
      .select("page_id, paragraph_number, paragraph_text, start_offset, end_offset")
      .in("meeting_id", ids)
      .order("paragraph_number")
      .order("paragraph_id")
      .range(start, end)),
    fetchAllMeetingRows((start, end) => supabase
      .from("conflict_candidates")
      .select("meeting_id, candidate_id, project_id, kind, decision_text, assignee_name, due_date, source_page_number, source_paragraph_number, source_text, status, resolution, resolution_reason")
      .eq("team_id", teamId)
      .in("meeting_id", ids)
      .order("created_at")
      .order("candidate_id")
      .range(start, end)),
  ]);

  const byPage = groupMeetingRows(paragraphs, (paragraph) => paragraph.page_id);
  const pagesByMeeting = groupMeetingRows(pages, (page) => page.meeting_id);
  const candidatesByMeeting = groupMeetingRows(candidates, (candidate) => candidate.meeting_id);
  return meetings.map((meeting) => {
    const documentPages: ExtractedDocument["pages"] = (pagesByMeeting.get(meeting.id) ?? [])
      .map((page) => ({
        pageNumber: page.page_number,
        text: page.page_text,
        paragraphs: (byPage.get(page.page_id) ?? []).map((paragraph) => ({
          paragraphNumber: paragraph.paragraph_number,
          text: paragraph.paragraph_text,
          startOffset: paragraph.start_offset,
          endOffset: paragraph.end_offset,
        })),
      }));
    return {
      ...meeting,
      paragraphs: documentPages.flatMap((page) => page.paragraphs.map((paragraph) => paragraph.text)),
      extractedDocument: documentPages.length ? {
        fileName: meeting.fileName || meeting.title,
        format: meeting.format,
        pages: documentPages,
      } : undefined,
      candidates: (candidatesByMeeting.get(meeting.id) ?? []).map((row) =>
        candidateRowToCandidate(row as CandidateRow, meeting.id),
      ),
    };
  });
}

function groupMeetingRows<Row, Key>(rows: Row[], keyOf: (row: Row) => Key) {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

async function fetchAllMeetingRows<Row>(
  fetchPage: (start: number, end: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const pageSize = 500;
  const rows: Row[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await fetchPage(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

// 원본 파일의 서명 URL은 상세나 출처를 열 때 가져온다.
export async function fetchMeetingFileUrl(teamId: string, meetingId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("meetings")
    .select("file_url")
    .eq("team_id", teamId)
    .eq("meeting_id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data?.file_url ? createMeetingFileSignedUrl(data.file_url) : null;
}

interface CandidateRow {
  candidate_id: string;
  project_id: string | null;
  kind: "change" | "new" | "action_item";
  decision_text: string;
  assignee_name: string | null;
  due_date: string | null; // DATE → "YYYY-MM-DD"
  source_page_number: number | null;
  source_paragraph_number: number | null;
  source_text: string | null;
  status: "pending" | "confirmed" | "resolved";
  resolution: "keep" | "replace" | "exception" | "hold" | "confirm" | "discard" | null;
  resolution_reason: string | null;
}

function candidateRowToCandidate(row: CandidateRow, meetingId: string): Candidate {
  return {
    id: row.candidate_id,
    projectId: row.project_id ?? undefined,
    title: row.decision_text,
    owner: row.assignee_name ?? "",
    dueDate: row.due_date ?? "",
    confirmed: row.status !== "pending",
    kind: row.kind,
    resolution: row.resolution ?? undefined,
    reason: row.resolution_reason ?? undefined,
    evidence: {
      documentId: meetingId,
      page: row.source_page_number ?? null,
      paragraph: row.source_paragraph_number ?? 0,
      startOffset: null, // 페이지별 page_id 오프셋은 저장하지 않으므로 null
      endOffset: null,
      quote: row.source_text ?? "",
    },
  };
}

// ===========================================================================
// 6. createMeeting — meetings 행 INSERT (status 지정, meeting_id = 클라이언트 UUID)
// RLS: 팀의 ACCEPTED 멤버 + uploaded_by = auth.uid()
// 클라이언트가 만든 UUID 를 meeting_id 로 쓰므로, 메모리 객체 id 와 DB id 가 일치.
// ===========================================================================
export async function createMeeting(input: {
  meetingId: string; // 클라이언트 crypto.randomUUID() → DB meeting_id
  teamId: string;
  uploadedBy: string; // = auth.users.id (auth.uid())
  title: string;
  meetingDate: string | null; // "YYYY-MM-DD" 또는 null
  location?: string;
  tags?: string; // "#a #b" 문자열 그대로
  fileName?: string;
  fileFormat?: "PDF" | "TXT";
  status: Meeting["status"];
}): Promise<void> {
  const { error } = await supabase
    .from("meetings")
    .insert({
      meeting_id: input.meetingId,
      team_id: input.teamId,
      uploaded_by: input.uploadedBy,
      title: input.title,
      meeting_date: input.meetingDate || null,
      location: input.location?.trim() || null,
      tags: input.tags ?? "",
      file_name: input.fileName ?? null,
      file_format: input.fileFormat ?? null,
      status: input.status,
    });
  if (error) throw error;
}

// ===========================================================================
// 7. sha256Hex — 브라우저에서 파일 SHA-256 (file_hash 중복 감지)
// ===========================================================================
export async function sha256Hex(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeFileName(name: string): string {
  // Supabase Storage 는 저장 주소(key)에 한글 등 유니코드 문자를 허용하지 않아서
  // "Invalid key" 오류가 난다. 그래서 저장용 주소는 영어·숫자 안전 문자로만 만들고,
  // 원본 파일 이름은 그대로 meetings.file_name 에 저장되어 화면에는 한글 그대로 보인다.
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot).replace(/[^\w.]/g, "") : "";
  const safeBase = base
    .replace(/[/\\]+/g, "_") // 경로 구분자 방지
    .replace(/[^\w-]+/g, "_") // 한글·공백 등 허용 밖 문자 → "_"
    .replace(/_+/g, "_") // 연속 언더바 정리
    .replace(/^_+|_+$/g, ""); // 앞뒤 언더바 제거
  return `${safeBase || "file"}${ext}`;
}

// ===========================================================================
// 8. uploadMeetingFile — Storage 업로드 + meetings 행에 파일 메타 갱신
// 경로 규칙: {team_id}/{meeting_id}/{filename}
// ===========================================================================
export async function uploadMeetingFile(
  teamId: string,
  meetingId: string,
  file: File,
): Promise<{ path: string; hash: string; size: number }> {
  const hash = await sha256Hex(file);
  const path = `${teamId}/${meetingId}/${sanitizeFileName(file.name)}`;
  const contentType =
    file.type ||
    (/\.pdf$/i.test(file.name)
      ? "application/pdf"
      : "text/plain;charset=utf-8");

  const { error: upErr } = await supabase.storage
    .from(MEETING_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase
    .from("meetings")
    .update({
      file_url: path,
      file_name: file.name,
      file_hash: hash,
      file_size: file.size,
      file_format: /\.pdf$/i.test(file.name) ? "PDF" : "TXT",
    })
    .eq("meeting_id", meetingId);
  if (updErr) throw updErr;

  return { path, hash, size: file.size };
}

// ===========================================================================
// 9. createMeetingFileSignedUrl — 비공개 버킷 원본을 1시간 서명 URL 로 열람
// ===========================================================================
export async function createMeetingFileSignedUrl(
  path: string,
  expiresIn = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(MEETING_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ===========================================================================
// 10. persistMeetingContent — extractedDocument → meeting_pages + meeting_paragraphs 저장
// 페이지별로 1행 INSERT → page_id 회수 → 전체 문단을 한 번에 batch INSERT.
// (RLS: meeting_in_my_team(meeting_id). meetings 행이 먼저 있어야 통과.)
// ===========================================================================
interface ParagraphInsertRow {
  meeting_id: string;
  page_id: string;
  paragraph_number: number;
  paragraph_text: string;
  start_offset: number;
  end_offset: number;
}

async function persistMeetingContent(
  meetingId: string,
  doc: ExtractedDocument,
): Promise<void> {
  const paragraphRows: ParagraphInsertRow[] = [];
  for (const page of doc.pages) {
    const { data, error } = await supabase
      .from("meeting_pages")
      .insert({
        meeting_id: meetingId,
        page_number: page.pageNumber ?? null,
        page_text: page.text,
      })
      .select("page_id")
      .single();
    if (error) throw error;
    const pageId = data.page_id as string;

    for (const para of page.paragraphs) {
      paragraphRows.push({
        meeting_id: meetingId,
        page_id: pageId,
        paragraph_number: para.paragraphNumber,
        paragraph_text: para.text,
        start_offset: para.startOffset,
        end_offset: para.endOffset,
      });
    }
  }

  if (paragraphRows.length > 0) {
    const { error } = await supabase
      .from("meeting_paragraphs")
      .insert(paragraphRows);
    if (error) throw error;
  }
}

// 업로드에서 만든 후보 UUID를 저장해 검토 화면에서도 같은 행을 편집한다.
// 분석 재시도(SFR-027)로 다시 저장할 때를 대비해 이미 있는 후보는 건너뛴다.
async function insertCandidateRows(
  meetingId: string,
  teamId: string,
  candidates: Candidate[],
  members: Member[],
): Promise<void> {
  if (!candidates.length) return;
  const { data: existing, error } = await supabase
    .from("conflict_candidates")
    .select("candidate_id")
    .eq("meeting_id", meetingId);
  if (error) throw error;
  const have = new Set((existing ?? []).map((row) => String(row.candidate_id)));
  const rows = candidates
    .filter((candidate) => !have.has(candidate.id))
    .map((candidate) => ({
      candidate_id: candidate.id,
      meeting_id: meetingId,
      team_id: teamId,
      kind: candidate.kind,
      decision_text: candidate.title,
      assignee_name: candidate.owner || null,
      assignee_user_id: members.find((member) => member.name === candidate.owner)?.id ?? null,
      due_date: candidate.dueDate || null,
      source_page_number: candidate.evidence.page,
      source_paragraph_number: candidate.evidence.paragraph,
      source_text: candidate.evidence.quote || null,
      status: candidate.confirmed ? "confirmed" : "pending",
    }));
  if (!rows.length) return;
  const { error: insertError } = await supabase.from("conflict_candidates").insert(rows);
  if (insertError) throw insertError;
}

// AI 분석 결과(원문·결정 후보·후속 업무)를 회의록에 저장한다.
// 업로드 실패 뒤 재시도(SFR-027)에서도 호출하므로 각 단계는 멱등하다.
// 후속 업무(is_action_item)는 이제 결정과 같은 conflict_candidates 에
// kind='action_item' 로 저장되고, 관리자 확정(apply_task_candidate RPC) 시
// tasks 테이블로 넘어간다 (SFR-016 검수 단계).
export async function persistMeetingAnalysis(input: {
  meetingId: string;
  teamId: string;
  doc: ExtractedDocument;
  candidates: Candidate[];
  members: Member[];
}): Promise<void> {
  const { data: existingPages, error: pagesError } = await supabase
    .from("meeting_pages")
    .select("page_id")
    .eq("meeting_id", input.meetingId)
    .limit(1);
  if (pagesError) throw pagesError;
  if (!existingPages?.length) {
    await persistMeetingContent(input.meetingId, input.doc);
  }
  await insertCandidateRows(input.meetingId, input.teamId, input.candidates, input.members);
}

export async function saveMeetingToSupabase(
  meeting: Meeting,
  draft: UploadDraft,
  userId: string,
  members: Member[],
): Promise<void> {
  await createMeeting({
    meetingId: meeting.id,
    teamId: meeting.teamId,
    uploadedBy: userId,
    title: meeting.title,
    meetingDate: meeting.date || null,
    location: meeting.location,
    tags: meeting.tags,
    fileName: meeting.fileName,
    fileFormat: meeting.format,
    status: meeting.status,
  });

  try {
    await uploadMeetingFile(meeting.teamId, meeting.id, draft.file);
    if (draft.extractedDocument) {
      await persistMeetingAnalysis({
        meetingId: meeting.id,
        teamId: meeting.teamId,
        doc: draft.extractedDocument,
        candidates: meeting.candidates,
        members,
      });
    }
  } catch (error) {
    // 실패한 업로드는 목록에서 숨겨 검토 가능한 회의록으로 보이지 않게 한다.
    await deleteMeeting(meeting.id).catch(() => {});
    throw error;
  }
}

// ===========================================================================
// 13. deleteMeeting — 소프트 삭제 (deleted_at)
// ===========================================================================
export async function deleteMeeting(meetingId: string): Promise<void> {
  const { error } = await supabase
    .from("meetings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("meeting_id", meetingId)
    .is("deleted_at", null)
    .select("meeting_id")
    .single();
  if (error) throw error;
}

// ===========================================================================
// 14. fetchTeamDecisions — 팀의 "현재 유효한 결정" 조회 (NEW, 1단계)
//     meeting_decisions.is_active = true 인 행만. 후속 업무(is_action_item=true)는
//     결정 목록에서 제외 — 업무 연동(4단계) 때 tasks 쪽으로 간다.
//     meetings !inner 조인으로 team_id 필터 + 소프트 삭제된 회의록 제외.
//     RLS: meeting_in_my_team(meeting_id) → 팀원만 조회 가능.
// ===========================================================================
interface DecisionDbRow {
  decision_id: string;
  meeting_id: string;
  project_id: string | null;
  decision_text: string;
  assignee_name: string | null;
  due_date: string | null;
  source_page_number: number | null;
  source_paragraph_number: number | null;
  source_text: string | null;
  is_exception: boolean;
}

export async function fetchTeamDecisions(teamId: string): Promise<Decision[]> {
  const { data, error } = await supabase
    .from("meeting_decisions")
    .select(
      "decision_id, meeting_id, project_id, decision_text, assignee_name, due_date, source_page_number, source_paragraph_number, source_text, is_exception, meetings!inner(team_id)",
    )
    .eq("is_active", true)
    .eq("is_action_item", false)
    .eq("meetings.team_id", teamId)
    .filter("meetings.deleted_at", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!data) return [];
  return (data as DecisionDbRow[]).map((row) => ({
    id: row.decision_id,
    teamId,
    projectId: row.project_id ?? undefined,
    title: row.decision_text,
    owner: row.assignee_name ?? "",
    dueDate: row.due_date ?? "",
    evidence: {
      documentId: row.meeting_id,
      page: row.source_page_number ?? null,
      paragraph: row.source_paragraph_number ?? 0,
      startOffset: null,
      endOffset: null,
      quote: row.source_text ?? "",
    },
    exception: row.is_exception,
  }));
}

// ===========================================================================
// 15. updateMeetingStatus — 회의록 상태 변경 (NEW, 2단계)
//     검토 제출(review → submitted/done)을 DB에 동기화.
//     RLS: 팀 멤버만 update 가능.
// ===========================================================================
export async function updateMeetingStatus(
  meetingId: string,
  status: Meeting["status"],
): Promise<void> {
  const { error } = await supabase
    .from("meetings")
    .update({ status })
    .eq("meeting_id", meetingId);
  if (error) throw error;
}

// ===========================================================================
// 16. updateConflictCandidate — 검토 화면의 후보 수정·확정/해제 동기화 (NEW, 3단계)
//     ReviewPage에서 제목·담당자·마감일을 고치거나 확정 체크를 바꿀 때 호출.
//     값을 넣은 것만 update한다(부분 수정).
// ===========================================================================
export async function updateConflictCandidate(
  candidate: Candidate,
  members: Member[],
): Promise<void> {
  const { data, error } = await supabase
    .from("conflict_candidates")
    .update({
      project_id: candidate.projectId || null,
      decision_text: candidate.title,
      assignee_name: candidate.owner || null,
      assignee_user_id: members.find((member) => member.name === candidate.owner)?.id ?? null,
      due_date: candidate.dueDate || null,
      status: candidate.confirmed ? "confirmed" : "pending",
    })
    .eq("candidate_id", candidate.id)
    .in("status", ["pending", "confirmed"])
    .select("candidate_id")
    .single();
  if (error) throw error;
  if (!data) throw new Error("수정할 결정 후보를 찾을 수 없습니다.");
}

// 선택한 기존 결정과 후보, 변경 이력을 DB에서 한 번에 반영한다.
export async function resolveCandidate(input: {
  candidateId: string;
  method: Resolution | "new";
  reason: string;
  previousDecisionId?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("apply_meeting_candidate_resolution", {
    p_candidate_id: input.candidateId,
    p_method: input.method,
    p_reason: input.reason,
    p_previous_decision_id: input.previousDecisionId ?? null,
  });
  if (error) throw error;
}

export async function invalidateDecision(decisionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("invalidate_meeting_decision", {
    p_decision_id: decisionId,
    p_reason: reason,
  });
  if (error) throw error;
}

// 후속 업무 후보 확정(confirm)/제외(discard) — 확정 시 DB가 tasks를 만들고
// 담당자에게 알림을 보낸다 (마이그레이션 202611220003).
export async function resolveTaskCandidate(input: {
  candidateId: string;
  method: "confirm" | "discard";
  reason: string;
}): Promise<void> {
  const { error } = await supabase.rpc("apply_task_candidate", {
    p_candidate_id: input.candidateId,
    p_method: input.method,
    p_reason: input.reason,
  });
  if (error) throw error;
}

// ===========================================================================
// 18. fetchTeamHistory — 결정 변경 이력 조회 (NEW, 3단계)
//     처리자 이름(users)은 users RLS 때문에 여기서 조인할 수 없어
//     actor 에 user_id를 담고, App.tsx 가 팀원 목록에서 이름으로 치환한다.
// ===========================================================================
interface HistoryRow {
  history_id: string;
  decision_id: string | null;
  meeting_id: string | null;
  method: ChangeRecord["method"];
  before_text: string | null;
  after_text: string | null;
  reason: string | null;
  actor_user_id: string | null;
  evidence_page_number: number | null;
  evidence_paragraph_number: number | null;
  evidence_text: string | null;
  created_at: string;
}

export async function fetchTeamHistory(teamId: string): Promise<ChangeRecord[]> {
  const { data, error } = await supabase
    .from("decision_history")
    .select(
      "history_id, decision_id, meeting_id, method, before_text, after_text, reason, actor_user_id, evidence_page_number, evidence_paragraph_number, evidence_text, created_at",
    )
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data) return [];
  return (data as HistoryRow[]).map((row) => ({
    id: row.history_id,
    teamId,
    title: (row.method === "invalidate" ? row.before_text : row.after_text)
      ?? row.before_text ?? "결정 처리",
    before: row.before_text ?? "",
    after: row.after_text ?? "",
    method: row.method,
    reason: row.reason ?? "",
    actor: row.actor_user_id ?? "", // App.tsx에서 팀원 이름으로 치환
    at: new Date(row.created_at).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
    }),
    evidence: {
      documentId: row.meeting_id ?? "",
      page: row.evidence_page_number,
      paragraph: row.evidence_paragraph_number ?? 0,
      startOffset: null,
      endOffset: null,
      quote: row.evidence_text ?? "",
    },
  }));
}
