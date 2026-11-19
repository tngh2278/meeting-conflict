// 팀 데이터 레이어
// 모든 팀 관련 Supabase 호출은 이 파일 하나로 통일합니다.
// App.tsx / TeamPage 등 컴포넌트는 이 함수들만 호출하고, 직접 supabase 쿼리를 짜지 않습니다.

import { supabase } from "./supabaseClient";
import type { Member, Role, Team } from "../demo-data";

// DB enum: member_role = ('ADMIN', 'DECIDER', 'MEMBER')
// 프론트 타입: Role = 'admin' | 'member'
// DECIDER는 현재 UI에서 다루지 않으므로 member로 매핑.
function dbRoleToFrontend(role: string): Role {
    if (role === "ADMIN") return "admin";
    return "member"; // MEMBER, DECIDER 모두 member 취급
}

function frontendRoleToDb(role: Role): "ADMIN" | "MEMBER" {
    return role === "admin" ? "ADMIN" : "MEMBER";
}

// DB에서 가져온 team_members + users 조인 결과를 프론트 Member 타입으로 변환
interface RawMemberRow {
    team_member_id: string;
    user_id: string;
    role: string;
    status: string;
    users: { name: string | null; profile_image_url: string | null } | null;
}

function toMember(row: RawMemberRow): Member {
    return {
        id: row.user_id,
        name: row.users?.name ?? "알 수 없음",
        email: "", // team_members JOIN users 결과에는 email이 없음. 별도 조회 필요시 fetchUserEmail 사용
        role: dbRoleToFrontend(row.role),
    };
}

// DB에서 가져온 teams + team_members 조인 결과를 프론트 Team 타입으로 변환
interface TeamWithMembers {
    team_id: string;
    name: string;
    description: string | null;
    creator_id: string;
}

// ==========================================================================
// 1. fetchMyTeams
// ==========================================================================
// 현재 로그인한 사용자가 속한 모든 팀과 각 팀의 멤버 목록을 가져옵니다.
// RLS 정책에 의해 본인이 ACCEPTED 상태로 속한 팀만 조회됩니다.
//
// 반환: Team[] (각 팀의 members: 정식 팀원, pendingMembers: 초대 대기중)
// ==========================================================================
export async function fetchMyTeams(): Promise<Team[]> {
    // 1) 내가 속한 팀 목록 조회 (RLS: ACCEPTED 팀 + 내 PENDING/DECLINED 줄)
    const { data: myMemberships, error: e1 } = await supabase
        .from("team_members")
        .select("team_id, status");
    if (e1) throw e1;
    if (!myMemberships || myMemberships.length === 0) return [];

    // ACCEPTED 상태인 팀만 정식 팀 목록에 포함
    const teamIds = myMemberships
        .filter((m) => m.status === "ACCEPTED")
        .map((m) => m.team_id as string);
    if (teamIds.length === 0) return [];

    // 2) 해당 팀들의 메타 정보
    const { data: teams, error: e2 } = await supabase
        .from("teams")
        .select("team_id, name, description, creator_id")
        .in("team_id", teamIds);
    if (e2) throw e2;
    if (!teams) return [];

    // 3) 각 팀의 멤버 전체 조회 (같은 팀 멤버끼리만 RLS 허용)
    //    status 컬럼까지 가져와 ACCEPTED/PENDING 을 나눔.
    const { data: allMembers, error: e3 } = await supabase
        .from("team_members")
        .select(`
            team_member_id,
            team_id,
            user_id,
            role,
            status,
            users:user_id ( name, profile_image_url )
        `)
        .in("team_id", teamIds);
    if (e3) throw e3;

    // 4) 결과 조립 — members(ACCEPTED) / pendingMembers(PENDING)
    return teams.map((t: TeamWithMembers) => {
        const rows = (allMembers ?? []).filter((m) => m.team_id === t.team_id);
        const members = rows
            .filter((m) => m.status === "ACCEPTED")
            .map((m) => toMember(m as unknown as RawMemberRow));
        const pendingMembers = rows
            .filter((m) => m.status === "PENDING")
            .map((m) => toMember(m as unknown as RawMemberRow));
        return {
            id: t.team_id,
            name: t.name,
            members,
            pendingMembers,
        };
    });
}

// ==========================================================================
// 2. createTeam
// ==========================================================================
// 새 팀을 만들고 호출자를 ADMIN으로 등록합니다.
// RLS 부트스트랩 문제 때문에 RPC 함수(create_team_with_admin)를 사용합니다.
//
// 반환: 새 팀 ID
// ==========================================================================
export async function createTeam(name: string, description?: string): Promise<string> {
    const { data, error } = await supabase.rpc("create_team_with_admin", {
        team_name: name.trim(),
        team_description: description?.trim() || null,
    });
    if (error) throw error;
    if (!data) throw new Error("팀 생성 응답이 비어 있습니다.");
    return data as string;
}

// ==========================================================================
// 3. inviteMember (팀원 초대 — 수락 대기)
// ==========================================================================
// 이미 가입된 사용자를 팀에 "초대"합니다. PENDING 상태로 들어가며,
// 초대받은 사용자가 acceptInvitation() 으로 수락해야 정식 팀원이 됩니다.
// RPC(invite_team_member)를 사용: 호출자가 해당 팀의 ACCEPTED ADMIN 인지 서버에서 검증.
// ==========================================================================
export async function inviteMember(
    teamId: string,
    userId: string,
    role: Role = "member",
): Promise<void> {
    const { error } = await supabase.rpc("invite_team_member", {
        target_team_id: teamId,
        target_user_id: userId,
        target_role: frontendRoleToDb(role),
    });
    if (error) throw error;
}

// ==========================================================================
// 3b. addMember (즉시 추가 — 레거시)
// ==========================================================================
// 과거 즉시 추가 방식. RLS INSERT 정책(team_members_insert_if_team_admin)에 의존.
// 초대(수락) 흐름으로 바뀌었으므로 신규 UI에서는 inviteMember() 사용.
// ==========================================================================
export async function addMember(
    teamId: string,
    userId: string,
    role: Role = "member",
): Promise<void> {
    const { error } = await supabase.from("team_members").insert({
        team_id: teamId,
        user_id: userId,
        role: frontendRoleToDb(role),
    });
    if (error) throw error;
}

// ==========================================================================
// 4. changeMemberRole
// ==========================================================================
// 팀원의 역할을 변경합니다.
// RLS 정책: 그 팀의 ADMIN만 호출 가능.
// 마지막 ADMIN을 MEMBER로 강등하는 것은 애플리케이션 단에서 차단 (Supabase는 모름).
// ==========================================================================
export async function changeMemberRole(
    teamId: string,
    userId: string,
    nextRole: Role,
): Promise<void> {
    const { error } = await supabase
        .from("team_members")
        .update({ role: frontendRoleToDb(nextRole) })
        .eq("team_id", teamId)
        .eq("user_id", userId);
    if (error) throw error;
}

// ==========================================================================
// 5. acceptInvitation / declineInvitation
// ==========================================================================
// 본인이 받은 초대를 수락/거절합니다. RPC(SECURITY DEFINER)로 처리.
// ==========================================================================
export async function acceptInvitation(teamId: string): Promise<void> {
    const { error } = await supabase.rpc("accept_invitation", {
        target_team_id: teamId,
    });
    if (error) throw error;
}

export async function declineInvitation(teamId: string): Promise<void> {
    const { error } = await supabase.rpc("decline_invitation", {
        target_team_id: teamId,
    });
    if (error) throw error;
}

// ==========================================================================
// 6. leaveTeam (본인 탈퇴)
// ==========================================================================
// 본인이 자발적으로 팀에서 탈퇴합니다. 마지막 ADMIN은 탈퇴 불가 (RPC에서 검증).
// ==========================================================================
export async function leaveTeam(teamId: string): Promise<void> {
    const { error } = await supabase.rpc("leave_team", {
        target_team_id: teamId,
    });
    if (error) throw error;
}

// ==========================================================================
// 7. removeMember (팀원 강퇴)
// ==========================================================================
// ADMIN이 다른 팀원을 팀에서 제거합니다.
// RLS 정책: 그 팀의 ADMIN(ACCEPTED)만 호출 가능.
// ==========================================================================
export async function removeMember(teamId: string, userId: string): Promise<void> {
    const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("team_id", teamId)
        .eq("user_id", userId);
    if (error) throw error;
}

// ==========================================================================
// 8. searchUserByEmail
// ==========================================================================
// 이메일로 가입된 사용자를 검색합니다. 팀원 추가 모달에서 사용.
// 검색 전용 RPC(search_user_by_email)를 호출.
//
// 반환: 사용자가 없으면 null
// ==========================================================================
export interface UserSearchResult {
    id: string;
    name: string;
    email: string;
}

export async function searchUserByEmail(
    email: string,
): Promise<UserSearchResult | null> {
    const { data, error } = await supabase.rpc("search_user_by_email", {
        email_input: email.trim().toLowerCase(),
    });
    if (error) throw error;
    if (!data || (Array.isArray(data) && data.length === 0)) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return {
        id: row.user_id,
        name: row.name ?? row.email?.split("@")[0] ?? "사용자",
        email: row.email ?? "",
    };
}

// ==========================================================================
// 9. fetchMyPendingInvitations
// ==========================================================================
// 본인이 "받은" 초대(PENDING) 목록을 가져옵니다. 상단 알림 배지에 사용.
// RLS: team_members SELECT 정책이 (user_id = auth.uid() AND status = 'PENDING') 허용.
//      teams SELECT 정책이 PENDING 초대 팀의 이름까지 노출하도록 보완됨(06 SQL).
//
// currentUserId: App 쪽의 user.id (auth.users.id). RLS 와 일치해야 함.
// ==========================================================================
export interface PendingInvitation {
    teamId: string;
    teamName: string;
    role: Role;
}

export async function fetchMyPendingInvitations(
    currentUserId: string,
): Promise<PendingInvitation[]> {
    const { data, error } = await supabase
        .from("team_members")
        .select(`
            team_id,
            role,
            teams:team_id ( name )
        `)
        .eq("user_id", currentUserId)
        .eq("status", "PENDING");
    if (error) throw error;
    return (data ?? []).map(
        (row: { team_id: string; role: string; teams: { name: string | null }[] }) => ({
            teamId: row.team_id,
            teamName: row.teams?.[0]?.name ?? "알 수 없는 팀",
            role: dbRoleToFrontend(row.role),
        }),
    );
}
