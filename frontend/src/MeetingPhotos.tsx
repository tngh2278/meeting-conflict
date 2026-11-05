import { useState } from "react";
import Modal from "./components/Modal";
import { examplePhoto } from "./demo-data";
import type { MeetingPhoto, Member } from "./demo-data";

function PhotoPreview({ photo }: { photo: MeetingPhoto }) {
  return photo.url ? (
    <img className="meeting-photo" src={photo.url} alt={photo.name} />
  ) : (
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

export default function MeetingPhotos({
  photos,
  members,
  onAdd,
  onChange,
  onDelete,
}: {
  photos: MeetingPhoto[];
  members: Member[];
  onAdd: (files: File[]) => void;
  onChange: (photo: MeetingPhoto) => void;
  onDelete: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(photos[0]?.id || "");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selected = photos.find((photo) => photo.id === selectedId) || photos[0];
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
          회의 사진의 얼굴·위치 정보 처리 안내를 확인했습니다.
        </label>
        <p className="small muted">
          목적: 사진 속 인물 및 촬영 정보 확인. 시연 파일은 외부로 전송되지
          않으며 새로고침 시 사라집니다. 등록된 얼굴·위치 정보는 사진 삭제로
          제거할 수 있습니다.
        </p>
        <div className="row-actions">
          <label
            className={`button button-secondary file-label ${!consent ? "is-disabled" : ""}`}
          >
            JPEG 사진 추가
            <input
              aria-label="회의 JPEG 사진 추가"
              disabled={!consent}
              type="file"
              accept=".jpg,.jpeg,image/jpeg"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                if (
                  files.some(
                    (file) =>
                      !/\.jpe?g$/i.test(file.name) ||
                      file.type !== "image/jpeg" ||
                      !file.size ||
                      file.size > 10 * 1024 * 1024,
                  )
                ) {
                  setError("10 MB 이하의 원본 JPEG 사진을 선택해 주세요.");
                  return;
                }
                setError("");
                onAdd(files);
              }}
            />
          </label>
          <span className="small muted">원본 JPEG · 사진당 최대 10 MB</span>
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
              <PhotoPreview photo={selected} />
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
                  onClick={() => setDeleting(true)}
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
                    {selected.example
                      ? selected.takenAt || "확인 불가"
                      : "분석 대기"}
                  </dd>
                </div>
                <div>
                  <dt>시간대</dt>
                  <dd>
                    {selected.example
                      ? selected.timezone || "확인 불가"
                      : "분석 대기"}
                  </dd>
                </div>
                <div>
                  <dt>GPS 좌표</dt>
                  <dd>
                    {!selected.example
                      ? "분석 대기"
                      : selected.latitude !== undefined
                        ? `${selected.latitude}, ${selected.longitude}`
                        : "위치 정보 없음"}
                  </dd>
                </div>
                <div>
                  <dt>촬영 주소</dt>
                  <dd>
                    {!selected.example
                      ? "분석 대기"
                      : selected.addressStatus === "found"
                        ? selected.address
                        : selected.addressStatus === "error"
                          ? "주소 조회 실패"
                          : selected.addressStatus === "not-found"
                            ? "해당 좌표의 주소를 찾지 못했습니다"
                            : "위치 정보 없음"}
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
                    {!selected.example
                      ? "촬영 위치는 분석 연결 후 확인할 수 있습니다."
                      : selected.address ||
                        (selected.latitude !== undefined
                          ? "좌표는 확인되었으나 주소가 없습니다."
                          : "사진에 GPS 정보가 없습니다.")}
                  </p>
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
                실제 얼굴 대조 결과는 서버 연동 후 표시됩니다.
              </p>
            )}
            <div className="subtle-panel">
              <strong>사진에서 미확인된 팀원</strong>
              <p>
                {selected.example
                  ? missing.map((member) => member.name).join(", ") ||
                    "모든 팀원이 사진에서 확인되었습니다."
                  : "분석 전에는 팀원 확인 여부를 판단하지 않습니다."}
              </p>
              <p className="small muted">
                사진에서 확인되지 않아도 불참으로 판단하지 않습니다.
              </p>
            </div>
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
              <PhotoPreview photo={selected} />
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
              onClose={() => setDeleting(false)}
            >
              <div className="stack">
                <p>
                  해당 사진과 얼굴 대조 결과, 촬영 일시·위치 정보를 시연
                  데이터에서 함께 제거합니다.
                </p>
                <div className="row-actions">
                  <button
                    className="button button-secondary"
                    onClick={() => setDeleting(false)}
                  >
                    취소
                  </button>
                  <button
                    className="button button-danger"
                    onClick={() => {
                      onDelete(selected.id);
                      setDeleting(false);
                    }}
                  >
                    삭제·동의 철회
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
