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

export async function extractDocument(
  file: File,
  signal: AbortSignal,
): Promise<ExtractedDocument> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!apiBaseUrl) {
    throw new Error("백엔드 API 주소가 설정되지 않았습니다. VITE_API_BASE_URL을 확인해 주세요.");
  }

  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/documents/extract`, {
      method: "POST",
      body: form,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("서버에 연결하지 못했습니다. 서버 상태와 API 주소를 확인한 뒤 다시 시도해 주세요.");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : `텍스트 추출에 실패했습니다. 잠시 후 다시 시도해 주세요. (${response.status})`,
    );
  }
  return response.json();
}
