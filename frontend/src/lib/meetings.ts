// ============================================================================
// meetings.ts — 회의록 데이터 레이어 (v4.1 — 검토·처리 흐름 DB 연동 + Storage 한글 파일명 수정)
// teams.ts 와 같은 패턴: 모든 회의록 관련 Supabase 호출을 이 파일로 통일.
//
// 다루는 테이블: meetings, meeting_pages, meeting_paragraphs,
//               conflict_candidates(NEW), meeting_decisions, decision_history(NEW),
//               notifications(NEW)
// Storage 버킷: meeting-files (경로 규칙 {team_id}/{meeting_id}/{filename})
//
// v3 → v4 바뀐 점 (1~3단계 DB 연동):
//   1) AI 추출 결과 저장처 변경: meeting_decisions → conflict_candidates (05 설계)
//      · meeting_decisions = "확정된 최종 결정" 전용 (is_active/is_exception 관리)
//      · conflict_candidates = 검토 화면의 후보 (pending/confirmed/resolved)
//      · → 예전(v3)에 저장한 테스트 회의록은 후보가 안 보이니 새로 업로드할 것.
//        (옛 결정 행은 SQL Editor에서 is_active=false로 숨기는 방법은 README 참고)
//   2) fetchMeetingDecisions: conflict_candidates에서 후보를 읽어
//      confirmed/resolution/reason까지 복원 (새로고침에도 검토 상태 유지!)
//   3) 신규 함수 6개:
//      · fetchTeamDecisions       팀의 현재 유효한 결정(is_active=true) 조회 → 결정 사항 화면
//      · fetchTeamHistory         결정 변경 이력 조회 → 히스토리 탭
//      · updateMeetingStatus      검토 제출(review→submitted/done) 상태 동기화
//      · updateConflictCandidate  검토 화면에서 후보 수정·확정/해제 동기화
//      · resolveCandidate         관리자 처리(유지/교체/예외/보류/신규) 전체 DB 반영
//                                 (후보 resolved + 결정 반영 + 변경 이력 + 담당자 알림)
//   4) saveMeetingToSupabase: 팀원 목록을 받아 담당자 이름 → user_id 매칭,
//      저장된 후보의 DB id 목록을 반환 (검토 화면이 DB 행과 바로 연결됨)
//
// 아직 미구현 (4~6단계):
//   - tasks 연동 (결정 확정 시 후속 업무 생성, 내 업무 화면 조회·상태 변경)
//   - 알림 목록 조회(헤더 종 모양) — 처리 결과 알림 "생성"은 resolveCandidate가 함
//   - meeting_photos 연동 (사진 등록·수정·삭제)
//
// 참고: meetings.status 가 프론트 Meeting.status 와 1:1
//       (ready/analyzing/failed/review/submitted/done) — 변환 함수 불필요.
// ============================================================================

import { supabase } from "./supabaseClient";
import type {
  Candidate,
  ChangeRecord,
  Decision,
  Meeting,
  Member,
  UploadDraft,
} from "../demo-data";
import type { ExtractedDocument, MeetingAnalysis } from "../document-api";

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

function toMeeting(row: MeetingRpcRow, teamId: string, paragraphs: string[] = []): Meeting {
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
    paragraphs,
    status: row.status,
    example: false,
    candidates: [], // fetchMeeting 에서 conflict_candidates → candidates 로 채움
    photos: [], // meeting_photos 테이블 연동 전까지 빈 배열
  };
}

// ===========================================================================
// 1. fetchTeamMeetings — 팀 회의록 목록 (문단·결정 미포함, 상세 진입 시 fetchMeeting)
// ===========================================================================
export async function fetchTeamMeetings(teamId: string): Promise<Meeting[]> {
  const { data, error } = await supabase.rpc("fetch_team_meetings", {
    target_team: teamId,
  });
  if (error) throw error;
  if (!data) return [];
  return (data as MeetingRpcRow[]).map((row) => toMeeting(row, teamId));
}

// ===========================================================================
// 2. fetchMeeting — 단일 회의록 상세 (평탄화 문단 + 후보 + 서명 URL)
// ===========================================================================
export async function fetchMeeting(
  teamId: string,
  meetingId: string,
): Promise<Meeting | null> {
  const { data, error } = await supabase.rpc("fetch_team_meetings", {
    target_team: teamId,
  });
  if (error) throw error;
  const row = (data as MeetingRpcRow[] | null)?.find(
    (r) => r.meeting_id === meetingId,
  );
  if (!row) return null;

  const paragraphs = await fetchMeetingParagraphs(meetingId);
  const candidates = await fetchMeetingDecisions(meetingId);
  const meeting = toMeeting(row, teamId, paragraphs);
  meeting.candidates = candidates;

  if (row.file_url) {
    const signed = await createMeetingFileSignedUrl(row.file_url);
    if (signed) meeting.fileUrl = signed;
  }
  return meeting;
}

// ===========================================================================
// 3. fetchMeetingParagraphs — 페이지·문단 순으로 평탄화해 content 만 반환
//    프론트 Meeting.paragraphs(string[]) 용. 페이지 경계는 무시(이후 개선).
//    RLS: meeting_in_my_team(meeting_id).
//    페이지 순서 보장을 위해 pages 와 paragraphs 를 따로 가져와 클라이언트 조인.
// ===========================================================================
export async function fetchMeetingParagraphs(meetingId: string): Promise<string[]> {
  const { data: pages, error: pErr } = await supabase
    .from("meeting_pages")
    .select("page_id, page_number")
    .eq("meeting_id", meetingId)
    .order("page_number", { ascending: true, nullsFirst: true });
  if (pErr) throw pErr;
  if (!pages || pages.length === 0) return [];

  const { data: paras, error: paraErr } = await supabase
    .from("meeting_paragraphs")
    .select("page_id, paragraph_number, paragraph_text")
    .eq("meeting_id", meetingId)
    .order("paragraph_number", { ascending: true });
  if (paraErr) throw paraErr;
  if (!paras) return [];

  const byPage = new Map<string, string[]>();
  for (const p of paras) {
    const arr = byPage.get(p.page_id);
    if (arr) arr.push(p.paragraph_text);
    else byPage.set(p.page_id, [p.paragraph_text]);
  }
  const result: string[] = [];
  for (const pg of pages) {
    const arr = byPage.get(pg.page_id);
    if (arr) result.push(...arr);
  }
  return result;
}

// ===========================================================================
// 4. fetchMeetingDecisions — conflict_candidates → 프론트 Candidate[] 매핑 (v4 변경)
//    AI가 추출해 검토 화면에 띄울 후보를 복원한다.
//    · status   pending → confirmed=false (제안·논의 사항)
//               confirmed/resolved → confirmed=true (검수 완료)
//    · resolution/reason 도 함께 복원 → 새로고침해도 처리 완료 상태가 유지된다.
//    RLS: is_team_member(team_id) — team_id 컬럼이 있어 바로 비교.
// ===========================================================================
interface CandidateRow {
  candidate_id: string;
  kind: "change" | "new";
  decision_text: string;
  assignee_name: string | null;
  due_date: string | null; // DATE → "YYYY-MM-DD"
  source_page_number: number | null;
  source_paragraph_number: number | null;
  source_text: string | null;
  status: "pending" | "confirmed" | "resolved";
  resolution: "keep" | "replace" | "exception" | "hold" | null;
  resolution_reason: string | null;
}

function candidateRowToCandidate(row: CandidateRow, meetingId: string): Candidate {
  return {
    id: row.candidate_id,
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

export async function fetchMeetingDecisions(
  meetingId: string,
): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("conflict_candidates")
    .select(
      "candidate_id, kind, decision_text, assignee_name, due_date, source_page_number, source_paragraph_number, source_text, status, resolution, resolution_reason",
    )
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!data) return [];
  return (data as CandidateRow[]).map((row) =>
    candidateRowToCandidate(row, meetingId),
  );
}

// ===========================================================================
// 5. fetchMeetingStructure — 페이지·문단 전체 구조 (근거 하이라이트 등 향후용)
// ===========================================================================
export interface MeetingParagraphFull {
  paragraphId: string;
  pageId: string;
  pageNumber: number | null;
  paragraphNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export async function fetchMeetingStructure(
  meetingId: string,
): Promise<MeetingParagraphFull[]> {
  const { data: pages, error: pErr } = await supabase
    .from("meeting_pages")
    .select("page_id, page_number")
    .eq("meeting_id", meetingId)
    .order("page_number", { ascending: true, nullsFirst: true });
  if (pErr) throw pErr;
  if (!pages || pages.length === 0) return [];

  const { data: paras, error: paraErr } = await supabase
    .from("meeting_paragraphs")
    .select("paragraph_id, page_id, paragraph_number, paragraph_text, start_offset, end_offset")
    .eq("meeting_id", meetingId)
    .order("paragraph_number", { ascending: true });
  if (paraErr) throw paraErr;
  if (!paras) return [];

  const pageNumberByPageId = new Map<string, number | null>(
    pages.map((pg) => [pg.page_id, pg.page_number]),
  );
  const byPage = new Map<string, typeof paras>();
  for (const p of paras) {
    const arr = byPage.get(p.page_id);
    if (arr) arr.push(p);
    else byPage.set(p.page_id, [p]);
  }
  const result: MeetingParagraphFull[] = [];
  for (const pg of pages) {
    const arr = byPage.get(pg.page_id);
    if (!arr) continue;
    for (const p of arr) {
      result.push({
        paragraphId: p.paragraph_id,
        pageId: p.page_id,
        pageNumber: pageNumberByPageId.get(p.page_id) ?? null,
        paragraphNumber: p.paragraph_number,
        text: p.paragraph_text,
        startOffset: p.start_offset,
        endOffset: p.end_offset,
      });
    }
  }
  return result;
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

// ===========================================================================
// 11. persistConflictCandidates — analysis.decisions → conflict_candidates (v4 변경)
//     예전에는 meeting_decisions에 바로 넣었지만, 05_conflicts 설계에 따라
//     "검토 전 후보"로 저장한다. 최종 결정은 관리자 처리(resolveCandidate) 때만
//     meeting_decisions에 생긴다.
//     · kind='new'         중복·충돌 감지(SFR-012/013) 연결 전까지 전부 신규로 저장
//     · status='confirmed' 화면과 동일하게 AI 추출 항목은 확정 상태로 시작
//                          (검토 화면에서 해제하면 updateConflictCandidate가 pending으로 바꿈)
//     · assignee_user_id   담당자 이름이 팀원 목록에 있으면 회원으로 연결 → 알림 가능
//     반환: 저장된 후보의 candidate_id 목록 (분석 순서와 동일 → 화면 id 교체용)
// ===========================================================================
async function persistConflictCandidates(
  meetingId: string,
  teamId: string,
  analysis: MeetingAnalysis,
  members: Member[],
): Promise<string[]> {
  if (!analysis.decisions.length) return [];
  const userIdByName = new Map(
    members.map((m) => [m.name, m.id] as const),
  );
  const rows = analysis.decisions.map((d) => ({
    meeting_id: meetingId,
    team_id: teamId,
    kind: "new" as const,
    decision_text: d.decision,
    assignee_name: d.assignee ?? null,
    assignee_user_id:
      d.assignee ? userIdByName.get(d.assignee) ?? null : null,
    due_date: d.dueDate ?? null, // "YYYY-MM-DD" 문자열 → DATE 컬럼
    source_page_number: d.source.pageNumber ?? null,
    source_paragraph_number: d.source.paragraphNumber,
    source_text: d.source.text ?? null,
    status: "confirmed" as const,
  }));
  const { data, error } = await supabase
    .from("conflict_candidates")
    .insert(rows)
    .select("candidate_id");
  if (error) throw error;
  return (data ?? []).map((r) => r.candidate_id as string);
}

// ===========================================================================
// 12. saveMeetingToSupabase — 업로드 전체 저장 (App.saveDraft 실제 흐름용) (v4 변경)
// 팀원의 UploadPage 가 미리 구한 extractedDocument + analysis 를 그대로 저장:
//   1) meetings 행 INSERT (meeting_id = 클라이언트 UUID, status = 분석 결과 상태)
//   2) Storage 업로드 + file_url/file_hash/file_size 갱신
//   3) meeting_pages + meeting_paragraphs 저장 (추출 원문)
//   4) conflict_candidates 저장 (AI 결정 → 검토 화면 후보)
// members(팀원 목록)를 주면 담당자 이름을 user_id로 연결한다.
// 반환: 저장된 후보의 DB id 목록 (분석이 없으면 null).
//       화면 후보 id를 DB id로 교체할 때 사용.
// ===========================================================================
export async function saveMeetingToSupabase(
  meeting: Meeting,
  draft: UploadDraft,
  userId: string,
  members: Member[] = [],
): Promise<string[] | null> {
  // 1) meetings 행
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

  // 2) Storage + 파일 메타
  await uploadMeetingFile(meeting.teamId, meeting.id, draft.file);

  // 3) 페이지·문단 (추출 원문이 있을 때)
  if (draft.extractedDocument) {
    await persistMeetingContent(meeting.id, draft.extractedDocument);
  }

  // 4) AI 결정 후보 (분석 결과가 있을 때)
  if (draft.analysis) {
    return await persistConflictCandidates(
      meeting.id,
      meeting.teamId,
      draft.analysis,
      members,
    );
  }
  return null;
}

// ===========================================================================
// 13. deleteMeeting — 소프트 삭제 (deleted_at)
// ===========================================================================
export async function deleteMeeting(meetingId: string): Promise<void> {
  const { error } = await supabase
    .from("meetings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("meeting_id", meetingId);
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
      "decision_id, meeting_id, decision_text, assignee_name, due_date, source_page_number, source_paragraph_number, source_text, is_exception, meetings!inner(team_id)",
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
  candidateId: string,
  patch: {
    decisionText?: string;
    assigneeName?: string | null;
    dueDate?: string | null;
    status?: "pending" | "confirmed" | "resolved";
  },
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.decisionText !== undefined) values.decision_text = patch.decisionText;
  if (patch.assigneeName !== undefined) values.assignee_name = patch.assigneeName;
  if (patch.dueDate !== undefined) values.due_date = patch.dueDate || null;
  if (patch.status !== undefined) values.status = patch.status;
  if (Object.keys(values).length === 0) return;

  const { error } = await supabase
    .from("conflict_candidates")
    .update(values)
    .eq("candidate_id", candidateId);
  if (error) throw error;
}

// ===========================================================================
// 17. resolveCandidate — 관리자 충돌 처리 전체를 DB에 반영 (NEW, 3단계 핵심)
//     UI method: keep / replace / exception / hold / new
//     DB에는 이 순서로 저장한다:
//       1) conflict_candidates: status='resolved' + resolution + 사유 + 처리자·시각
//       2) 결정 반영:
//          · replace   : 옛 결정 is_active=false → 새 결정 행 INSERT
//                        (matched가 없는 신규 후보면 새 결정만 INSERT)
//          · new       : 새 결정 행 INSERT
//          · exception : 옛 결정 is_exception=true (matched 없으면 예외 신규 INSERT)
//          · keep/hold : 결정 변경 없음
//       3) decision_history INSERT (before/after + 사유 + 근거) — 수정·삭제 불가
//       4) 담당자가 회원으로 연결돼 있고 처리자 본인이 아니면 notifications INSERT
//     ※ DB resolution 허용값은 keep/replace/exception/hold 네 가지라
//       UI 'new'(신규 반영)는 resolution='replace'로 저장(의미: 반영 완료),
//       이력 method는 'new' 그대로 기록한다.
// ===========================================================================
export type ResolutionMethod = "keep" | "replace" | "exception" | "hold" | "new";

export async function resolveCandidate(input: {
  candidateId: string;
  teamId: string;
  meetingId: string;
  method: ResolutionMethod;
  reason: string;
  actorId: string;
}): Promise<void> {
  // 1) 후보 행 읽기 (옛 결정 id·담당자·근거가 필요)
  const { data: row, error: rowErr } = await supabase
    .from("conflict_candidates")
    .select(
      "candidate_id, meeting_id, team_id, kind, decision_text, assignee_name, assignee_user_id, due_date, matched_decision_id, source_page_number, source_paragraph_number, source_text",
    )
    .eq("candidate_id", input.candidateId)
    .single();
  if (rowErr) throw rowErr;

  const dbResolution = input.method === "new" ? "replace" : input.method;

  // 2) 후보 상태: resolved + 처리 방식
  const { error: upErr } = await supabase
    .from("conflict_candidates")
    .update({
      status: "resolved",
      resolution: dbResolution,
      resolution_reason: input.reason,
      resolved_by: input.actorId,
      resolved_at: new Date().toISOString(),
    })
    .eq("candidate_id", input.candidateId);
  if (upErr) throw upErr;

  let beforeText: string | null = null;
  let afterText: string | null = null;
  let newDecisionId: string | null = null;

  const insertDecision = async (isException: boolean): Promise<string | null> => {
    const { data, error } = await supabase
      .from("meeting_decisions")
      .insert({
        meeting_id: row.meeting_id,
        decision_text: row.decision_text,
        assignee_name: row.assignee_name,
        assignee_user_id: row.assignee_user_id,
        due_date: row.due_date,
        source_page_number: row.source_page_number,
        source_paragraph_number: row.source_paragraph_number,
        source_text: row.source_text,
        is_action_item: false,
        is_exception: isException,
      })
      .select("decision_id")
      .single();
    if (error) throw error;
    return (data?.decision_id as string) ?? null;
  };

  const readOldText = async (decisionId: string): Promise<string | null> => {
    const { data } = await supabase
      .from("meeting_decisions")
      .select("decision_text")
      .eq("decision_id", decisionId)
      .single();
    return data?.decision_text ?? null;
  };

  // 3) 결정 반영
  if (input.method === "replace" && row.matched_decision_id) {
    beforeText = await readOldText(row.matched_decision_id);
    const { error } = await supabase
      .from("meeting_decisions")
      .update({ is_active: false })
      .eq("decision_id", row.matched_decision_id);
    if (error) throw error;
  }

  if (input.method === "replace" || input.method === "new") {
    afterText = row.decision_text;
    newDecisionId = await insertDecision(false);
  }

  if (input.method === "exception") {
    if (row.matched_decision_id) {
      beforeText = await readOldText(row.matched_decision_id);
      afterText = `${beforeText ?? ""} (예외로 유지)`;
      const { error } = await supabase
        .from("meeting_decisions")
        .update({ is_exception: true })
        .eq("decision_id", row.matched_decision_id);
      if (error) throw error;
    } else {
      afterText = `${row.decision_text} (예외로 유지)`;
      newDecisionId = await insertDecision(true);
    }
  }

  // 4) 변경 이력 기록 (RLS가 select/insert만 허용 → 팀원이 지울 수 없음)
  const { error: histErr } = await supabase.from("decision_history").insert({
    team_id: input.teamId,
    decision_id: row.matched_decision_id,
    new_decision_id: newDecisionId,
    meeting_id: row.meeting_id,
    method: input.method,
    before_text: beforeText,
    after_text: afterText,
    reason: input.reason,
    actor_user_id: input.actorId,
    evidence_page_number: row.source_page_number,
    evidence_paragraph_number: row.source_paragraph_number,
    evidence_text: row.source_text,
  });
  if (histErr) throw histErr;

  // 5) 담당자 알림 (담당자가 회원으로 연결돼 있고, 처리자 본인이 아닐 때만)
  if (row.assignee_user_id && row.assignee_user_id !== input.actorId) {
    const label: Record<ResolutionMethod, string> = {
      keep: "기존 결정 유지",
      replace: "새 결정으로 교체",
      exception: "예외로 두기",
      hold: "논의 중으로 보류",
      new: "신규 결정 반영",
    };
    const { error: notifErr } = await supabase.from("notifications").insert({
      team_id: input.teamId,
      user_id: row.assignee_user_id,
      type: "result",
      title: "결정 처리 결과",
      body: `‘${row.decision_text}’ 항목이 ${label[input.method]}(으)로 처리되었습니다.`,
      decision_id: newDecisionId ?? row.matched_decision_id,
      candidate_id: row.candidate_id,
    });
    if (notifErr) throw notifErr;
  }
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
  method: "new" | "keep" | "replace" | "exception" | "hold";
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
    title: row.after_text ?? row.before_text ?? "결정 처리",
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
