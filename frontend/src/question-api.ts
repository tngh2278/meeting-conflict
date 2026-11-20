import { supabase } from "./lib/supabaseClient";

export type QuestionSource = {
  documentId: string;
  fileName: string;
  pageNumber: number | null;
  paragraphNumber: number;
  text: string;
};

export type QuestionAnswer = {
  answer: string;
  sources: QuestionSource[];
};

export async function askQuestion(
  question: string,
  sources: QuestionSource[],
  signal: AbortSignal,
): Promise<QuestionAnswer> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");

  if (!baseUrl) {
    throw new Error("VITE_API_BASE_URL을 확인해 주세요.");
  }

  // 현재 로그인한 사용자의 토큰을 가져온다.
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    throw new Error("다시 로그인해 주세요.");
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/api/questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({ question, sources }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;

    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("답변 시간이 초과됐습니다. 다시 질문해 주세요.");
    }

    throw new Error("백엔드 서버에 연결하지 못했습니다.");
  }

  if (response.status === 401) {
    throw new Error("로그인이 만료됐습니다. 다시 로그인해 주세요.");
  }

  if (!response.ok) {
    const problem = await response.json().catch(() => null);

    throw new Error(
      typeof problem?.detail === "string"
        ? problem.detail
        : typeof problem?.message === "string"
          ? problem.message
          : `질의응답 요청에 실패했습니다. (${response.status})`,
    );
  }

  return response.json();
}
