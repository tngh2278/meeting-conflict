import { useEffect, useState } from "react";
import MeetingPhotoFaceReview from "./MeetingPhotoFaceReview";
import Modal from "./components/Modal";
import { examplePhoto } from "./demo-data";
import type { MeetingPhoto, Member } from "./demo-data";
import {
  getMeetingPhotoAddress,
  getMeetingPhotoMap,
  getMeetingPhotoUrl,
  isSupportedMeetingPhoto,
  MEETING_PHOTO_ACCEPT,
  type PhotoAddressResult,
} from "./lib/meeting-photos";

function PhotoPreview({
  photo,
  url,
  loading,
}: {
  photo: MeetingPhoto;
  url?: string;
  loading: boolean;
}) {
  if (url) {
    return <img className="meeting-photo" src={url} alt={photo.name} />;
  }

  if (!photo.example) {
    return (
      <p className="muted">
        {loading ? "사진을 불러오는 중입니다." : "사진을 열 수 없습니다."}
      </p>
    );
  }

  return (
    <div
      className="photo-placeholder"
      role="img"
      aria-label="실제 인물이 없는 회의 사진 배치 예시"
    >
      <div className="room-window" />
      <div className="meeting-figures">
        {["01", "02", "03"].map((label) => (
          <div className="person-figure" key={label}>
            <div className="person-head">{label}</div>
            <div className="person-body" />
          </div>
        ))}
      </div>
      <div className="meeting-table" />
      <span className="illustration-caption">
        회의 사진 배치 예시 · 실제 인물 아님
      </span>
    </div>
  );
}

function LivePhotoAddress({ photoId }: { photoId: string }) {
  const [result, setResult] = useState<PhotoAddressResult>();

  useEffect(() => {
    const request = new AbortController();

    void getMeetingPhotoAddress(photoId, request.signal).then(
      (value) => {
        if (!request.signal.aborted) setResult(value);
      },
      () => {
        if (!request.signal.aborted) {
          setResult({ status: "error", address: null });
        }
      },
    );

    return () => request.abort();
  }, [photoId]);

  if (!result) return "주소 조회 중…";
  if (result.status === "found" && result.address) return result.address;
  if (result.status === "missing-gps") return "위치 정보 없음";
  if (result.status === "not-found")
    return "해당 좌표의 주소를 찾지 못했습니다";
  return "주소 조회 실패";
}

function LivePhotoMap({ photoId }: { photoId: string }) {
  const [mapUrl, setMapUrl] = useState<string | null>();

  useEffect(() => {
    const request = new AbortController();
    let objectUrl: string | undefined;

    void getMeetingPhotoMap(photoId, request.signal).then(
      (image) => {
        if (request.signal.aborted) return;
        objectUrl = URL.createObjectURL(image);
        setMapUrl(objectUrl);
      },
      () => {
        if (!request.signal.aborted) setMapUrl(null);
      },
    );

    return () => {
      request.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  if (mapUrl === undefined) return <p className="muted">지도 불러오는 중…</p>;
  if (mapUrl === null)
    return <p className="muted">지도를 불러오지 못했습니다.</p>;

  return (
    <img
      className="photo-location-map"
      src={mapUrl}
      alt="촬영 위치에 핀이 표시된 카카오 지도"
      onError={() => setMapUrl(null)}
    />
  );
}

export default function MeetingPhotos({
  photos,
  meetingLocation,
  members,
  onAdd,
  onChange,
  onDelete,
}: {
  photos: MeetingPhoto[];
  meetingLocation: string;
  members: Member[];
  onAdd: (files: File[], consent: boolean) => Promise<void>;
  onChange: (photo: MeetingPhoto) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(photos[0]?.id || "");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [storedPreview, setStoredPreview] = useState<{
    path: string;
    url?: string;
  }>();

  const selected = photos.find((photo) => photo.id === selectedId) || photos[0];
  const previewPath = selected?.storagePath;

  useEffect(() => {
    if (!previewPath) return;

    let current = true;
    void getMeetingPhotoUrl(previewPath).then(
      (url) => {
        if (current) setStoredPreview({ path: previewPath, url });
      },
      () => {
        if (current) setStoredPreview({ path: previewPath });
      },
    );

    return () => {
      current = false;
    };
  }, [previewPath]);

  const previewLoading = !!previewPath && storedPreview?.path !== previewPath;
  const previewUrl =
    selected?.url ??
    (storedPreview?.path === previewPath ? storedPreview?.url : undefined);
  const missing = selected
    ? members.filter(
        (member) => !selected.faces.some((face) => face.name === member.name),
      )
    : [];

  function addExample() {
    const photo = examplePhoto();
    photo.faces = [
      ...members.slice(0, 2).map((member, index) => ({
        id: `face-${index + 1}`,
        name: member.name,
        confirmed: false,
      })),
      { id: "face-unknown", name: "미등록 얼굴", confirmed: false },
    ];
    onChange(photo);
    setSelectedId(photo.id);
  }
  function changeLocationCase(value: MeetingPhoto["addressStatus"]) {
    if (!selected) return;
    const reference = examplePhoto();
    onChange({
      ...selected,
      latitude: value === "missing-gps" ? undefined : reference.latitude,
      longitude: value === "missing-gps" ? undefined : reference.longitude,
      address: value === "found" ? reference.address : undefined,
      addressStatus: value,
      reviewed: false,
    });
  }
  return (
    <div className="stack">
      <section className="card stack">
        <div className="row-between">
          <div>
            <h2>회의 사진</h2>
            <p className="muted">
              사진의 인물과 촬영 정보를 회의록에 연결해 확인합니다.
            </p>
          </div>
          <button className="button button-secondary" onClick={addExample}>
            예시 사진 분석 보기
          </button>
        </div>
        <label className="check-line">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          사진 원본과 촬영 정보 저장에 동의합니다.
        </label>

        <p className="small muted">
          실제 회의록에 추가한 사진 원본과 촬영 일시·GPS 좌표는 팀에 저장됩니다.
          사진을 삭제하면 함께 제거됩니다. 촬영 주소나 지도를 조회할 때는 사진의
          GPS 좌표를 카카오에 보냅니다.
        </p>

        <div className="row-actions">
          <label
            className={`button button-secondary file-label ${!consent || addingPhotos ? "is-disabled" : ""}`}
          >
            {addingPhotos ? "사진 저장 중" : "사진 추가"}
            <input
              aria-label="회의 사진 추가"
              disabled={!consent || addingPhotos}
              type="file"
              accept={MEETING_PHOTO_ACCEPT}
              multiple
              hidden
              onChange={async (event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";

                if (files.some((file) => !isSupportedMeetingPhoto(file))) {
                  setError(
                    "10 MB 이하의 원본 JPEG 또는 PNG 사진을 선택해 주세요.",
                  );
                  return;
                }

                if (!consent || !files.length) return;

                setError("");
                setAddingPhotos(true);
                try {
                  await onAdd(files, consent);
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "사진을 저장하지 못했습니다.",
                  );
                } finally {
                  setAddingPhotos(false);
                }
              }}
            />
          </label>
          <span className="small muted">원본 JPEG·PNG · 사진당 최대 10 MB</span>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </section>
      {selected ? (
        <>
          <div className="photo-tabs" aria-label="등록된 사진">
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                className={`photo-tab ${selected.id === photo.id ? "selected" : ""}`}
                onClick={() => setSelectedId(photo.id)}
              >
                <span>사진 {String(index + 1).padStart(2, "0")}</span>
                <strong>{photo.name}</strong>
                <span className="small muted">
                  {photo.reviewed ? "검수 완료" : "확인 필요"}
                </span>
              </button>
            ))}
          </div>
          <div className="photo-grid">
            <section className="card stack">
              <div className="row-between">
                <h2>사진 원본</h2>
                <button
                  className="text-button"
                  onClick={() => setExpanded(true)}
                >
                  크게 보기 ↗
                </button>
              </div>
              <PhotoPreview
                photo={selected}
                url={previewUrl}
                loading={previewLoading}
              />
              <p className="small muted">
                {selected.example
                  ? "아래 인물·촬영 정보는 화면 시연용 가상 결과입니다."
                  : "선택한 JPEG의 원본 미리보기입니다. 실제 얼굴 대조·EXIF 분석은 아직 연결되지 않았습니다."}
              </p>
              <div className="row-between">
                <span className="badge">
                  {selected.reviewed ? "검수 완료" : "검수 대기"}
                </span>
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    setDeleteError("");
                    setDeleting(true);
                  }}
                >
                  사진 삭제·동의 철회
                </button>
              </div>
            </section>
            <section className="card stack">
              <div className="row-between">
                <h2>촬영 정보</h2>
                {selected.example && (
                  <span className="badge badge-gray">예시 값</span>
                )}
              </div>
              <dl className="info-list">
                <div>
                  <dt>촬영 날짜·시간</dt>
                  <dd>
                    {(selected.takenAtLocal ?? selected.takenAt)?.replace(
                      "T",
                      " ",
                    ) || "확인 불가"}
                  </dd>
                </div>

                <div>
                  <dt>시간대</dt>
                  <dd>{selected.timezone || "시간대 미확인"}</dd>
                </div>

                <div>
                  <dt>GPS 좌표</dt>
                  <dd>
                    {selected.latitude !== undefined &&
                    selected.longitude !== undefined
                      ? `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`
                      : "사진에 GPS 정보가 없습니다."}
                  </dd>
                </div>

                <div>
                  <dt>촬영 주소</dt>
                  <dd aria-live="polite">
                    {selected.example ? (
                      selected.addressStatus === "found" ? (
                        selected.address
                      ) : selected.addressStatus === "error" ? (
                        "주소 조회 실패"
                      ) : selected.addressStatus === "not-found" ? (
                        "해당 좌표의 주소를 찾지 못했습니다"
                      ) : (
                        "위치 정보 없음"
                      )
                    ) : selected.latitude !== undefined &&
                      selected.longitude !== undefined ? (
                      <LivePhotoAddress
                        key={selected.id}
                        photoId={selected.id}
                      />
                    ) : (
                      "위치 정보 없음"
                    )}
                  </dd>
                </div>
              </dl>

              <div className="location-card">
                <span className="location-pin" aria-hidden="true">
                  ⌖
                </span>
                <div>
                  <strong>사진 촬영 위치</strong>
                  <p className="muted">
                    {selected.address ||
                      (selected.latitude !== undefined &&
                      selected.longitude !== undefined
                        ? "사진에서 GPS 좌표를 확인했습니다."
                        : "사진에 GPS 정보가 없습니다.")}
                  </p>
                  {!selected.example &&
                    selected.latitude !== undefined &&
                    selected.longitude !== undefined && (
                      <LivePhotoMap key={selected.id} photoId={selected.id} />
                    )}
                  {!selected.example &&
                    meetingLocation &&
                    (selected.latitude === undefined ||
                      selected.longitude === undefined) && (
                      <p className="small muted">
                        회의록 장소 (참고) · {meetingLocation}
                      </p>
                    )}
                </div>
              </div>
              {selected.example && (
                <>
                  <label className="field">
                    <span className="small">촬영 위치 시연 상황</span>
                    <select
                      aria-label="촬영 위치 시연 상황"
                      value={selected.addressStatus}
                      onChange={(event) =>
                        changeLocationCase(
                          event.target.value as MeetingPhoto["addressStatus"],
                        )
                      }
                    >
                      <option value="found">주소 조회 성공</option>
                      <option value="missing-gps">GPS 정보 없음</option>
                      <option value="not-found">주소 검색 결과 없음</option>
                      <option value="error">주소 API 오류</option>
                    </select>
                  </label>
                  {selected.addressStatus === "error" && (
                    <button
                      className="button button-secondary"
                      onClick={() => changeLocationCase("found")}
                    >
                      주소 조회 재시도 · 예시
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      onChange({
                        ...selected,
                        takenAt: undefined,
                        timezone: undefined,
                        reviewed: false,
                      })
                    }
                  >
                    촬영 일시 없는 상황 확인
                  </button>
                </>
              )}
              <p className="small muted">
                촬영 정보는 참고 자료입니다. 실제 회의 일시·장소로 자동 확정하지
                않습니다.
              </p>
            </section>
          </div>
          <section className="card stack">
            <div className="row-between">
              <h2>얼굴 대조 결과 검수</h2>
              <span className="small muted">
                일치 후보를 직접 확인해 주세요
              </span>
            </div>
            {selected.example ? (
              <>
                {selected.faces.length ? (
                  selected.faces.map((face, index) => (
                    <div className="face-row" key={face.id}>
                      <span className="avatar">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="face-description">
                        <strong>사진 속 얼굴 {index + 1}</strong>
                        <p className="small muted">
                          {face.name === "확인 불가"
                            ? "확인 불가 · 기준 정보 미등록 또는 동의 철회"
                            : face.name === "미등록 얼굴"
                              ? "등록 정보와 일치하지 않는 얼굴"
                              : face.confirmed
                                ? "사용자가 확인한 인물"
                                : "일치 후보 · 확인 필요"}
                        </p>
                      </div>
                      <select
                        aria-label={`얼굴 ${index + 1} 인물 수정`}
                        value={face.name}
                        onChange={(event) =>
                          onChange({
                            ...selected,
                            reviewed: false,
                            faces: selected.faces.map((item) =>
                              item.id === face.id
                                ? {
                                    ...item,
                                    name: event.target.value,
                                    confirmed: true,
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        <option>미등록 얼굴</option>
                        <option>확인 불가</option>
                        {members.map((member) => (
                          <option key={member.id}>{member.name}</option>
                        ))}
                      </select>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    이 예시 사진에는 대조 결과가 없습니다.
                  </p>
                )}
                <div className="subtle-panel">
                  <strong>사진에서 미확인된 팀원</strong>
                  <p>
                    {missing.map((member) => member.name).join(", ") ||
                      "모든 팀원이 사진에서 확인되었습니다."}
                  </p>
                  <p className="small muted">
                    사진에서 확인되지 않아도 불참으로 판단하지 않습니다.
                  </p>
                </div>
              </>
            ) : (
              <MeetingPhotoFaceReview
                key={selected.id}
                photoId={selected.id}
                members={members}
              />
            )}
            <div className="row-between">
              <p className="small muted">
                검수 결과는 현재 화면에서만 보관됩니다.
              </p>
              <button
                className="button button-primary"
                onClick={() =>
                  onChange({
                    ...selected,
                    reviewed: true,
                    faces: selected.faces.map((face) => ({
                      ...face,
                      confirmed: true,
                    })),
                  })
                }
              >
                {selected.reviewed
                  ? "검수 완료"
                  : selected.example
                    ? "사진 검수 결과 저장"
                    : "원본 확인 완료"}
              </button>
            </div>
          </section>
          {expanded && (
            <Modal
              title={selected.name}
              wide
              onClose={() => setExpanded(false)}
            >
              <PhotoPreview
                photo={selected}
                url={previewUrl}
                loading={previewLoading}
              />
              <p className="page-note">
                {selected.example
                  ? "실제 사진이 아닌 화면 배치 예시입니다."
                  : "선택한 JPEG 원본입니다."}
              </p>
            </Modal>
          )}
          {deleting && (
            <Modal
              title="사진과 관련 정보를 삭제할까요?"
              onClose={() => {
                if (!removingPhoto) setDeleting(false);
              }}
            >
              <div className="stack">
                <p>사진과 이 사진의 등록 정보를 삭제합니다.</p>

                {deleteError && (
                  <p className="error-message" role="alert">
                    {deleteError}
                  </p>
                )}

                <div className="row-actions">
                  <button
                    className="button button-secondary"
                    disabled={removingPhoto}
                    onClick={() => setDeleting(false)}
                  >
                    취소
                  </button>

                  <button
                    className="button button-danger"
                    disabled={removingPhoto}
                    onClick={async () => {
                      setDeleteError("");
                      setRemovingPhoto(true);
                      try {
                        await onDelete(selected.id);
                        setDeleting(false);
                      } catch (error) {
                        setDeleteError(
                          error instanceof Error
                            ? error.message
                            : "사진을 삭제하지 못했습니다.",
                        );
                      } finally {
                        setRemovingPhoto(false);
                      }
                    }}
                  >
                    {removingPhoto ? "삭제 중" : "삭제·동의 철회"}
                  </button>
                </div>
              </div>
            </Modal>
          )}
        </>
      ) : (
        <section className="card empty-state">
          <h2>등록된 회의 사진이 없습니다</h2>
          <p className="muted">
            JPEG 사진을 추가하거나 예시 사진으로 얼굴·촬영 정보 화면을 확인해
            보세요.
          </p>
          <button className="button button-secondary" onClick={addExample}>
            예시 사진 보기
          </button>
        </section>
      )}
    </div>
  );
}
