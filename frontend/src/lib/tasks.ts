// 업무(SFR-016·017): tasks 테이블 조회·상태 변경을 담당한다.
// 후속 업무는 업로드 때 conflict_candidates(kind='action_item')로 저장되고,
// 관리자가 검토·확정하면 apply_task_candidate RPC가 여기에 업무를 만든다.
// 스키마는 마이그레이션 202611220001 이 보장하며, 컬럼 이름 차이에 대비해
// select(*) 결과를 관대하게 매핑한다.
import { supabase } from "./supabaseClient";
import type { Task } from "../demo-data";

type TaskRow = Record<string, unknown>;

function field(row: TaskRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function toTask(row: TaskRow, teamId: string): Task {
  return {
    id: field(row, ["task_id", "id"]),
    teamId: field(row, ["team_id"]) || teamId,
    title: field(row, ["title", "task_name"]),
    owner: field(row, ["owner_name", "assignee_name"]),
    dueDate: field(row, ["due_date", "due"]),
    status: (field(row, ["status"]) || "대기") as Task["status"],
    recheck: row.recheck === true,
    decisionId: field(row, ["decision_id"]),
    meetingId: field(row, ["meeting_id"]) || undefined,
  };
}

export async function fetchTeamTasks(teamId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as TaskRow[])
    .map((row) => toTask(row, teamId))
    .filter((task) => task.id);
}

export async function updateTaskRow(task: Task): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({
      title: task.title,
      owner_name: task.owner || null,
      due_date: task.dueDate || null,
      status: task.status,
      recheck: task.recheck,
    })
    .eq("task_id", task.id);
  if (error) throw error;
}
