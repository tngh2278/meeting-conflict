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
// RLS 정책에 의해 본인이 속한 팀만 조회됩니다.
//
// 반환: Team[] (각 팀의 members 배열 포함)
// ==========================================================================
export async function fetchMyTeams(): Promise<Team[]> {
    // 1) 내가 속한 팀 목록 조회
    const { data: myMemberships, error: e1 } = await supabase
        .from("team_members")
        .select("team_id");
    if (e1) throw e1;
    if (!myMemberships || myMemberships.length === 0) return [];

    const teamIds = myMemberships.map((m) => m.team_id as string);

    // 2) 해당 팀들의 메타 정보
    const { data: teams, error: e2 } = await supabase
        .from("teams")
        .select("team_id, name, description, creator_id")
        .in("team_id", teamIds);
    if (e2) throw e2;
    if (!teams) return [];

    // 3) 각 팀의 멤버 전체 조회 (같은 팀 멤버끼리만 RLS 허용)
    const { data: allMembers, error: e3 } = await supabase
        .from("team_members")
        .select(`
            team_member_id,
            team_id,
            user_id,
            role,
            users:user_id ( name, profile_image_url )
        `)
        .in("team_id", teamIds);
    if (e3) throw e3;

    // 4) 결과 조립
    return teams.map((t: TeamWithMembers) => {
        const members = (allMembers ?? [])
            .filter((m) => m.team_id === t.team_id)
            .map((m) => toMember(m as unknown as RawMemberRow));
        return {
            id: t.team_id,
            name: t.name,
            members,
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
// 3. addMember
// ==========================================================================
// 이미 가입된 사용자를 팀에 추가합니다.
// RLS 정책: 그 팀의 ADMIN만 호출 가능.
//
// userId: public.users.user_id (UUID)
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
//
// teamId, userId로 team_members 줄을 식별 (UNIQUE(team_id, user_id) 제약 덕분).
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
// 5. searchUserByEmail
// ==========================================================================
// 이메일로 가입된 사용자를 검색합니다. 팀원 추가 모달에서 사용.
// RLS 정책: users_select_self 정책 때문에 "본인만 조회 가능"으로 되어 있어,
// 실제로는 다른 사용자의 name/email을 직접 조회할 수 없습니다.
//
// 해결책: 검색 전용 RPC 함수(search_user_by_email)를 추가로 두어야 합니다.
// 아래 함수는 그 RPC를 호출합니다. RPC SQL은 별도 파일에 포함되어 있습니다.
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
// 6. leaveTeam / removeMember (선택)
// ==========================================================================
// 팀원 추방이나 탈퇴가 필요하면 아래 함수를 사용.
// 현재 UI에서 사용하지 않으면 지워도 됩니다.
// ==========================================================================
export async function removeMember(teamId: string, userId: string): Promise<void> {
    const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("team_id", teamId)
        .eq("user_id", userId);
    if (error) throw error;
}
