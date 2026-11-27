import { useEffect, useRef, useState } from "react";
import type { Member } from "./demo-data";
import { compareMeetingPhotoFaces, type PhotoFaceResult } from "./lib/meeting-photos";

export default function MeetingPhotoFaceReview({
  photoId,
  members,
}: {
  photoId: string;
  members: Member[];
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PhotoFaceResult>();
  const request = useRef<AbortController>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function compare() {
    if (!consent || busy) return;

    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult(undefined);

    try {
      const matches = await compareMeetingPhotoFaces(photoId, controller.signal);
      if (!controller.signal.aborted) setResult(matches);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "얼굴 대조에 실패했습니다.");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const names = new Map(members.map((member) => [member.id, member.name]));
  const matched = new Set(result?.faces.map((face) => face.userId));
  const missing = result?.referenceUserIds
    .filter((id) => !matched.has(id))
    .map((id) => names.get(id))
    .filter(Boolean);

  return (
    <>
      <label className="check-line">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => {
            setConsent(event.target.checked);
            if (!event.target.checked) setResult(undefined);
          }}
        />
        사진 속 인물에게 얼굴 대조 목적을 알리고 동의를 받았습니다.
      </label>
      <button
        type="button"
        className="button button-secondary"
        disabled={!consent || busy}
        onClick={() => void compare()}
      >
        {busy ? "얼굴 대조 중…" : result ? "다시 대조" : "얼굴 대조 시작"}
      </button>
      {error && <p className="error-message" role="alert">{error}</p>}
      {result && (
        <div className="stack" role="status">
          {!!result.faces.length && (
            <p className="small muted">비교 가능한 기준 사진 {result.referenceUserIds.length}장</p>
          )}
          {result.faces.length > 0 && result.referenceUserIds.length === 0 && (
            <p className="small muted">
              {result.registeredReferenceCount === 0
                ? "이 팀에 등록된 기준 사진이 없습니다."
                : "등록된 기준 사진에서 비교할 얼굴 한 명을 확인하지 못했습니다. 내 정보에서 얼굴 한 명이 선명하게 나온 사진을 확인해 주세요."}
            </p>
          )}
          {!result.faces.length && <p>사진에서 얼굴을 찾지 못했습니다.</p>}
          {result.faces.map((face, index) => (
            <div className="face-row" key={index}>
              <span className="avatar">{index + 1}</span>
              <div>
                <strong>얼굴 {index + 1}</strong>
                <p className="small muted">
                  {face.userId && names.has(face.userId)
                    ? `${names.get(face.userId)} · 일치 후보`
                    : "미확인"}
                </p>
              </div>
            </div>
          ))}
          {!!missing?.length && (
            <p className="small muted">일치 후보가 없는 팀원 · {missing.join(", ")}</p>
          )}
        </div>
      )}
    </>
  );
}
