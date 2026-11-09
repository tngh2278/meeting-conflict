import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Modal from "./components/Modal";
import { extractDocument } from "./document-api";
import { DEMO_DATE, newParagraphs } from "./demo-data";
import type { UploadDraft } from "./demo-data";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function UploadPage({
  onSave,
  onCancel,
}: {
  onSave: (draft: UploadDraft) => void;
  onCancel: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef("");
  const uploadRequest = useRef<AbortController | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(DEMO_DATE);
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [location, setLocation] = useState("");
  const [example, setExample] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => () => {
    URL.revokeObjectURL(previewRef.current);
    uploadRequest.current?.abort();
  }, []);

  function selectFile(file: File) {
    setError("");
    setExample(false);
    URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreviewUrl("");
    setPreviewText("");

    if (!/\.(pdf|txt)$/i.test(file.name)) {
      setSelectedFile(null);
      setError("PDF 또는 TXT 파일만 선택할 수 있습니다.");
      return;
    }

    if (file.size === 0) {
      setSelectedFile(null);
      setError("내용이 없는 파일입니다. 다른 파일을 선택해 주세요.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null);
      setError("파일 크기는 최대 10 MB까지 가능합니다.");
      return;
    }

    setSelectedFile(file);
    const isPdf = /\.pdf$/i.test(file.name);
    const url = URL.createObjectURL(
      new Blob([file], {
        type: isPdf ? "application/pdf" : "text/plain;charset=utf-8",
      }),
    );
    previewRef.current = url;
    setPreviewUrl(url);
    if (!isPdf)
      void file.text().then((text) => {
        if (previewRef.current === url) setPreviewText(text);
      });
  }

  function loadExample() {
    const content = newParagraphs.join("\n\n");

    selectFile(
      new File([content], "예시_회의록_2026-10-13.txt", {
        type: "text/plain;charset=utf-8",
      }),
    );

    setMeetingTitle("행사 준비 회의");
    setMeetingDate(DEMO_DATE);
    setTags("#행사준비 #마감변경");
    setLocation("학생회관 회의실");
    setExample(true);
  }

  function resetForm() {
    setSelectedFile(null);
    URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreviewUrl("");
    setPreviewText("");
    setMeetingTitle("");
    setMeetingDate(DEMO_DATE);
    setTags("");
    setError("");
    setLocation("");
    setPhotos([]);
    setExample(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadRequest.current) return;
    setError("");

    if (!selectedFile) {
      setError("회의록 파일을 먼저 선택해 주세요.");
      return;
    }

    if (!meetingTitle.trim()) {
      setError("회의 제목을 입력해 주세요.");
      return;
    }

    if (!meetingDate) {
      setError("회의일을 선택해 주세요.");
      return;
    }

    if (photos.length && !photoConsent) {
      setError("회의 사진의 얼굴·위치 정보 처리 안내를 확인해 주세요.");
      return;
    }
    const request = new AbortController();
    uploadRequest.current = request;
    setUploading(true);
    try {
      const extractedDocument = example
        ? undefined
        : await extractDocument(selectedFile, request.signal);
      onSave({
        file: selectedFile,
        title: meetingTitle.trim(),
        date: meetingDate,
        location,
        tags,
        example,
        extractedDocument,
        photos,
        photoConsent,
      });
    } catch (error) {
      if (!request.signal.aborted) {
        setError(error instanceof Error ? error.message : "텍스트 추출에 실패했습니다. 다시 시도해 주세요.");
      }
    } finally {
      uploadRequest.current = null;
      if (!request.signal.aborted) setUploading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <h1>회의록 등록</h1>
        <p>회의록 파일에서 텍스트를 추출하고 페이지·문단별 내용을 확인합니다.</p>
      </div>

      <form className="upload-form" onSubmit={handleSubmit} aria-busy={uploading}>
        <fieldset className="upload-form upload-fields" disabled={uploading}>
        <section className="upload-card" aria-labelledby="file-heading">
          <h2 id="file-heading">
            {selectedFile ? selectedFile.name : "회의록 파일을 선택하세요"}
          </h2>

          <p className="file-description">
            {selectedFile
              ? `${selectedFile.name.split(".").pop()?.toUpperCase()} · ${(selectedFile.size / 1024).toFixed(1)} KB · 선택 완료`
              : "텍스트가 있는 PDF 또는 TXT · 최대 10 MB"}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            aria-label="회의록 파일 선택"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              if (file) {
                selectFile(file);
              }

              event.currentTarget.value = "";
            }}
          />

          <div className="file-actions">
            <button
              type="button"
              className="button button-secondary file-button"
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? "파일 다시 선택" : "파일 선택"}
            </button>

            <button
              type="button"
              className="button button-secondary example-button"
              onClick={loadExample}
            >
              예시 회의록 불러오기
            </button>

            {selectedFile && previewUrl && (
              <button
                type="button"
                className="button button-secondary file-button"
                onClick={() => setPreviewOpen(true)}
              >
                원문 미리보기
              </button>
            )}
          </div>
        </section>

        <div className="field-row">
          <div className="field">
            <label htmlFor="meeting-title">회의 제목</label>
            <input
              id="meeting-title"
              type="text"
              placeholder="행사 준비 회의"
              value={meetingTitle}
              onChange={(event) => setMeetingTitle(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="meeting-date">회의일</label>
            <input
              id="meeting-date"
              type="date"
              value={meetingDate}
              onChange={(event) => setMeetingDate(event.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="meeting-location">
            회의 장소 <span className="muted">선택</span>
          </label>
          <input
            id="meeting-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="사용자가 확인한 회의 장소"
          />
        </div>

        <div className="field">
          <label htmlFor="meeting-tags">태그</label>
          <input
            id="meeting-tags"
            type="text"
            placeholder="#행사준비  #마감변경"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </div>

        <section className="card stack" aria-labelledby="photo-upload-heading">
          <div>
            <h2 id="photo-upload-heading">
              회의 사진 첨부 <span className="muted small">선택</span>
            </h2>
            <p className="muted">
              원본 JPEG 사진을 해당 회의록에 연결합니다. 사진이 없어도 문서를
              등록할 수 있습니다.
            </p>
          </div>
          <label className="button button-secondary file-label">
            사진 선택
            <input
              hidden
              type="file"
              accept=".jpg,.jpeg,image/jpeg"
              multiple
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (
                  selected.some(
                    (file) =>
                      !/\.jpe?g$/i.test(file.name) ||
                      file.type !== "image/jpeg" ||
                      file.size === 0 ||
                      file.size > MAX_FILE_SIZE,
                  )
                ) {
                  setError(
                    "회의 사진은 10 MB 이하의 원본 JPEG 파일만 선택할 수 있습니다.",
                  );
                  return;
                }
                setError("");
                setPhotos((previous) => [...previous, ...selected]);
              }}
            />
          </label>
          {photos.map((photo, index) => (
            <div
              className="row-between file-row"
              key={`${photo.name}-${index}`}
            >
              <span>
                {photo.name}{" "}
                <span className="muted">
                  · {(photo.size / 1024).toFixed(0)} KB
                </span>
              </span>
              <button
                type="button"
                className="text-button danger-text"
                onClick={() =>
                  setPhotos((items) => items.filter((_, i) => i !== index))
                }
              >
                제거
              </button>
            </div>
          ))}
          <label className="check-line">
            <input
              type="checkbox"
              checked={photoConsent}
              onChange={(event) => setPhotoConsent(event.target.checked)}
            />
            얼굴·위치 정보 처리 안내를 확인했습니다.
          </label>
          <p className="small muted">
            처리 목적: 회의 사진의 인물·촬영 정보 확인. 현재 회의 사진은
            외부로 보내지 않으며, 새로고침 시 선택한 파일과 정보가 사라집니다.
          </p>
        </section>
        </fieldset>

        <p className="form-description">
          직접 선택한 문서는 텍스트 추출을 위해 서버로 전송됩니다. 원본과 추출
          결과의 영구 저장은 아직 지원하지 않으며, 새로고침하면 등록 내용이 사라집니다.
        </p>

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}

        <p className="small muted">
          예시 회의록은 고정된 분석 결과로 화면 흐름을 시연합니다. 직접 선택한
          파일은 텍스트만 추출하며, AI 결정 추출은 다음 단계에서 연결됩니다.
        </p>

        {uploading && (
          <p className="notice-message" role="status">
            파일 전송 및 텍스트 추출 중입니다. 서버가 대기 상태였다면 첫 요청에
            1분 정도 걸릴 수 있습니다.
          </p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="button button-secondary cancel-button"
            onClick={() => {
              resetForm();
              onCancel();
            }}
          >
            취소
          </button>

          <button type="submit" className="button button-primary submit-button" disabled={uploading}>
            {uploading ? "처리 중…" : example ? "예시 분석 시작" : "텍스트 추출하기"}
          </button>
        </div>
      </form>
      {previewOpen && (
        <Modal title="원문 미리보기" wide onClose={() => setPreviewOpen(false)}>
          {/\.pdf$/i.test(selectedFile?.name ?? "") ? (
            <iframe
              className="pdf-preview"
              title="선택한 PDF 원문"
              src={previewUrl}
            />
          ) : (
            <pre className="paper-text">{previewText}</pre>
          )}
        </Modal>
      )}
    </>
  );
}

export default UploadPage;
