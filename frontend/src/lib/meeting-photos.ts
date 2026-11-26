import type { MeetingPhoto } from "../demo-data";
import { supabase } from "./supabaseClient";

const PHOTO_BUCKET = "meeting-photos";
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
export const MEETING_PHOTO_ACCEPT = ".jpg,.jpeg,.png,image/jpeg,image/png";

export function isSupportedMeetingPhoto(file: File) {
  return (
    file.size > 0 &&
    file.size <= MAX_PHOTO_SIZE &&
    /\.(jpe?g|png)$/i.test(file.name)
  );
}

type PhotoMetadata = {
  contentType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
  takenAtLocal: string | null;
  takenAt: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
};

type MeetingPhotoRow = {
  photo_id: string;
  storage_path: string;
  file_name: string | null;
  consent: boolean;
  reviewed?: boolean;
  taken_at_local: string | null;
  taken_at: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  address_status: MeetingPhoto["addressStatus"] | null;
};

async function extractMeetingPhotoMetadata(file: File): Promise<PhotoMetadata> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(
    /\/+$/,
    "",
  );
  if (!apiBaseUrl) {
    throw new Error("백엔드 API 주소 VITE_API_BASE_URL을 확인해 주세요.");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error("사진을 등록하려면 다시 로그인해 주세요.");
  }

  const form = new FormData();
  form.append("file", file);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/photos/metadata`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      body: form,
      signal: AbortSignal.timeout(65_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "사진 분석 응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    throw new Error("사진 분석 서버에 연결하지 못했습니다.");
  }

  if (response.status === 401) {
    throw new Error("로그인이 만료됐습니다. 다시 로그인해 주세요.");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : `사진 분석에 실패했습니다. (${response.status})`,
    );
  }

  return response.json();
}

export async function saveMeetingPhoto(
  teamId: string,
  meetingId: string,
  file: File,
  consent: boolean,
) {
  if (!consent) throw new Error("사진 및 촬영 정보 저장에 동의해 주세요.");
  if (!isSupportedMeetingPhoto(file)) {
    throw new Error("10 MB 이하의 원본 JPEG 또는 PNG 사진을 선택해 주세요.");
  }

  const metadata = await extractMeetingPhotoMetadata(file);
  const photoId = crypto.randomUUID();

  // 서버에서 확인한 이미지 형식으로 저장 경로를 만든다.
  const path = `${teamId}/${meetingId}/${photoId}.${metadata.extension}`;

  const photo: MeetingPhotoRow & { team_id: string; meeting_id: string } = {
    photo_id: photoId,
    team_id: teamId,
    meeting_id: meetingId,
    storage_path: path,
    file_name: file.name,
    consent,
    taken_at_local: metadata.takenAtLocal,
    taken_at: metadata.takenAt,
    timezone: metadata.timezone,
    latitude: metadata.latitude,
    longitude: metadata.longitude,
    address_status: metadata.latitude === null ? "missing-gps" : null,
  };

  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: metadata.contentType,
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { error: saveError } = await supabase
    .from("meeting_photos")
    .insert(photo);
  if (saveError) {
    const { error: cleanupError } = await bucket.remove([path]);
    throw new Error(
      cleanupError
        ? "사진 정보 저장에 실패했고 업로드한 파일을 정리하지 못했습니다."
        : saveError.message,
    );
  }

  return photo;
}

export function toMeetingPhoto(row: MeetingPhotoRow): MeetingPhoto {
  return {
    id: row.photo_id,
    name: row.file_name ?? "회의 사진",
    storagePath: row.storage_path,
    example: false,
    reviewed: row.reviewed ?? false,
    consent: row.consent,
    takenAt: row.taken_at ?? undefined,
    takenAtLocal: row.taken_at_local ?? undefined,
    timezone: row.timezone ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    address: row.address ?? undefined,
    addressStatus: row.address_status ?? undefined,
    faces: [],
  };
}

export async function getMeetingPhotoUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, 3600);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "사진을 열 수 없습니다.");
  }

  return data.signedUrl;
}

export async function deleteSavedMeetingPhoto(
  teamId: string,
  meetingId: string,
  photo: MeetingPhoto,
) {
  if (!photo.storagePath) return;

  const { error: storageError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .remove([photo.storagePath]);

  if (storageError) throw new Error(storageError.message);

  const { data, error } = await supabase
    .from("meeting_photos")
    .delete()
    .eq("team_id", teamId)
    .eq("meeting_id", meetingId)
    .eq("photo_id", photo.id)
    .select("photo_id")
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      error?.message ??
        "사진 정보가 삭제되지 않았습니다. 목록을 확인해 주세요.",
    );
  }
}
