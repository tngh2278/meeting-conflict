// useAuth 훅
// 이 훅은 Supabase 인증 상태를 React에서 쓰기 편하게 감싸준 것입니다.
// App.tsx에서 기존 `const [user, setUser] = useState(null);` 대신 사용합니다.

import { useEffect, useState, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

// 기존 App.tsx에서 쓰던 Member 타입과 비슷하게 맞춰줍니다.
// Member 타입 정의가 demo-data.ts에 있으므로, 그 타입과 호환되게 만듭니다.
export interface AuthUser {
  id: string;          // Supabase auth.users.id (UUID)
  email: string;       // 로그인 이메일
  name: string;        // public.users.name에서 가져온 이름
  profileImageUrl?: string | null;  // public.users.profile_image_url
  role: "admin" | "member";         // 기본값은 member. 팀별 역할은 team_members 테이블에서 별도 조회
}

export interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean;            // 초기 로딩 중일 때 true (이때는 스플래시 화면 표시)
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  // public.users 테이블에서 현재 로그인한 사용자의 추가 정보(이름 등)를 가져옵니다.
  // 아까 만든 RLS 정책(users_select_self)이 작동해서 본인 정보만 조회됩니다.
  const fetchProfile = useCallback(
    async (sbUser: User): Promise<AuthUser | null> => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("name, profile_image_url")
          .eq("user_id", sbUser.id)
          .single();

        if (error) {
          // 트리거가 아직 안 돌았거나 레코드가 없는 경우
          // auth.users의 이메일에서 @ 앞부분을 임시 이름으로 사용
          return {
            id: sbUser.id,
            email: sbUser.email ?? "",
            name: sbUser.email?.split("@")[0] ?? "사용자",
            profileImageUrl: null,
            role: "member",
          };
        }

        return {
          id: sbUser.id,
          email: sbUser.email ?? "",
          name: data.name ?? "사용자",
          profileImageUrl: data.profile_image_url ?? null,
          role: "member",
        };
      } catch {
        return null;
      }
    },
    [],
  );

  // 초기 로딩: 페이지 새로고침 시 저장된 세션 복원
  useEffect(() => {
    let mounted = true;

    // 1. 이미 저장된 세션 가져오기
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        const profile = await fetchProfile(data.session.user);
        if (mounted) setUser(profile);
      }
      if (mounted) setLoading(false);
    });

    // 2. 세션 변화 감지 (로그인/로그아웃/토큰 갱신)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      if (newSession?.user) {
        const profile = await fetchProfile(newSession.user);
        if (mounted) setUser(profile);
      } else {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // 회원가입
  // Supabase가 auth.users에 레코드를 만들고,
  // 아까 만든 트리거(on_auth_user_created)가 public.users에도 자동으로 레코드를 만듭니다.
  // → name은 일단 auth.users의 email 앞부분이 들어가고,
  //   실제 입력한 name으로 덮어쓰려면 가입 직후 public.users를 UPDATE합니다.
  const signUp = useCallback(
    async (email: string, password: string, name: string): Promise<{ error: string | null }> => {
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) return { error: translateAuthError(error.message) };
        if (!data.user) return { error: "회원가입에 실패했습니다. 다시 시도해 주세요." };

        // 방금 만든 public.users 레코드의 name을 사용자가 입력한 이름으로 덮어씁니다.
        // RLS 정책(users_update_self)이 본인 수정만 허용하므로 자동으로 안전합니다.
        // 단, 이 단계가 실패하더라도 회원가입 자체는 성공한 상태입니다.
        if (data.session) {
          // 이메일 인증 없이 바로 세션이 생긴 경우 (Supabase 기본 설정)
          await supabase
            .from("users")
            .update({ name })
            .eq("user_id", data.user.id);
        }

        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다." };
      }
    },
    [],
  );

  // 로그인
  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) return { error: translateAuthError(error.message) };
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다." };
      }
    },
    [],
  );

  // 로그아웃
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  // 프로필 새로고침 (사용자가 프로필 수정한 뒤 호출)
  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    const profile = await fetchProfile(session.user);
    setUser(profile);
  }, [session, fetchProfile]);

  return { user, loading, signUp, signIn, signOut, refreshProfile };
}

// Supabase 에러 메시지를 한국어로 번역
// 자주 발생하는 에러만 처리하고, 나머지는 원문 그대로 표시
function translateAuthError(message: string): string {
  const map: Record<string, string> = {
    "Invalid login credentials": "이메일 또는 비밀번호가 올바르지 않습니다.",
    "User already registered": "이미 가입된 이메일입니다. 로그인을 이용해 주세요.",
    "Password should be at least 6 characters": "비밀번호는 최소 6자 이상이어야 합니다.",
    "Unable to validate email address: invalid format": "이메일 형식이 올바르지 않습니다.",
    "Email not confirmed": "이메일 인증이 필요합니다. 메일함을 확인해 주세요.",
  };
  return map[message] ?? message;
}
