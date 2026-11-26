// 알림(SFR-018): notifications 테이블을 직접 조회해 화면 상단 알림 버튼에 표시한다.
// 결정 처리·재검토·무효 처리 트리거/RPC 가 남긴 알림을 본인 user_id 로 읽어 온다.
// 스키마 차이(PK 이름 등)에 대비해 select(*) 결과를 관대하게 매핑한다.
import { supabase } from "./supabaseClient";

export type AppNotification = {
  id: string;
  teamId: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = Record<string, unknown>;

function field(row: NotificationRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function optionalField(row: NotificationRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: field(row, ["notification_id", "id"]),
    teamId: field(row, ["team_id"]),
    type: field(row, ["type"]) || "result",
    title: field(row, ["title"]),
    body: field(row, ["body"]),
    readAt: optionalField(row, ["read_at", "readAt"]),
    createdAt: optionalField(row, ["created_at", "createdAt"]) ?? "",
  };
}

export async function fetchMyNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return [];
  const { data: rows, error: queryError } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (queryError) throw queryError;
  return ((rows ?? []) as NotificationRow[])
    .map(toNotification)
    .filter((item) => item.id);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("notification_id", ids);
  if (error) throw error;
}
