import { supabase } from "./lib/supabaseClient";
import type { Candidate, Decision, Evidence, Meeting } from "./demo-data";

export type ComparisonResult = {
  reason: string;
  matches: {
    decisionId: string;
    relation: "DUPLICATE" | "CONFLICT" | "CHANGE" | "REVIEW";
    reason: string;
  }[];
};

export const comparisonLabels = {
  DUPLICATE: "중복 후보",
  CONFLICT: "충돌 후보",
  CHANGE: "명시적 변경 후보",
  REVIEW: "추가 확인 필요",
} as const;

function sourceText(evidence: Evidence, meetings: Meeting[]) {
  const meeting = meetings.find((item) => item.id === evidence.documentId);
  return (
    meeting?.extractedDocument?.pages
      .find((page) => page.pageNumber === evidence.page)
      ?.paragraphs.find((paragraph) => paragraph.paragraphNumber === evidence.paragraph)
      ?.text ?? evidence.quote
  );
}

export async function compareDecision(
  candidate: Candidate,
  existing: Decision[],
  meetings: Meeting[],
  signal: AbortSignal,
): Promise<ComparisonResult> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl || !candidate.projectId) {
    throw new Error("API 주소와 후보의 프로젝트 분류를 확인해 주세요.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("다시 로그인해 주세요.");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/decisions/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({
        projectId: candidate.projectId,
        candidate: {
          id: candidate.id,
          projectId: candidate.projectId,
          title: candidate.title,
          owner: candidate.owner,
          dueDate: candidate.dueDate,
          text: sourceText(candidate.evidence, meetings),
          exception: false,
        },
        existing: existing.map((decision) => ({
          id: decision.id,
          projectId: decision.projectId,
          title: decision.title,
          owner: decision.owner,
          dueDate: decision.dueDate,
          text: sourceText(decision.evidence, meetings),
          exception: decision.exception ?? false,
        })),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("비교 시간이 초과됐습니다. 다시 비교해 주세요.");
    }
    throw new Error("백엔드 비교 API에 연결하지 못했습니다.");
  }
  if (response.status === 401) throw new Error("로그인이 만료됐습니다.");
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(
      typeof problem?.detail === "string"
        ? problem.detail
        : `결정 비교 요청 실패 (${response.status})`,
    );
  }
  return response.json();
}
