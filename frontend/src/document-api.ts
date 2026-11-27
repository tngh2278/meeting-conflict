import { supabase } from "./lib/supabaseClient";

export type ExtractedDocument = {
  fileName: string;
  format: "PDF" | "TXT";
  pages: {
    pageNumber: number | null;
    text: string;
    paragraphs: {
      paragraphNumber: number;
      text: string;
      startOffset: number;
      endOffset: number;
    }[];
  }[];
};

export type MeetingAnalysis = {
  fileName: string;
  extractedDocument: ExtractedDocument;
  decisions: {
    decision: string;
    assignee: string | null;
    dueDate: string | null;
    // 후속 업무(true)면 tasks 테이블로, 확정 결정(false)면 결정 후보로 간다.
    actionItem: boolean;
    source: {
      pageNumber: number | null;
      paragraphNumber: number;
      text: string | null;
    };
  }[];
};

export async function extractDocument(
  file: File,
  signal: AbortSignal,
): Promise<ExtractedDocument> {
  const response = await uploadDocument(file, signal, "extract");
  return response.json();
}

export async function analyzeDocument(
  file: File,
  signal: AbortSignal,
): Promise<MeetingAnalysis> {
  const response = await uploadDocument(file, signal, "analyze");
  return response.json();
}

export type MeetingBasicInfo = {
  date: string | null;
  time: string | null;
  location: string | null;
  attendees: string[];
};

export async function extractMeetingInfo(
  file: File,
  signal: AbortSignal,
): Promise<MeetingBasicInfo> {
  const response = await uploadDocument(file, signal, "meeting-info");
  return response.json();
}

async function uploadDocument(
  file: File,
  signal: AbortSignal,
  action: "extract" | "analyze" | "meeting-info",
): Promise<Response> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(
    /\/+$/,
    "",
  );
  if (!apiBaseUrl) {
    throw new Error(
      "백엔드 API 주소가 설정되지 않았습니다. VITE_API_BASE_URL을 확인해 주세요.",
    );
  }

  // 웹 로그인 세션에서 현재 토큰을 가져온다.
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error("로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.");
  }

  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/documents/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "분석 응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    throw new Error(
      "서버에 연결하지 못했습니다. 서버 상태와 API 주소를 확인한 뒤 다시 시도해 주세요.",
    );
  }

  if (response.status === 401) {
    throw new Error("로그인이 만료됐습니다. 다시 로그인해 주세요.");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string"
        ? error.detail
        : typeof error?.message === "string"
          ? error.message
          : `문서 처리에 실패했습니다. 잠시 후 다시 시도해 주세요. (${response.status})`,
    );
  }
  return response;
}
