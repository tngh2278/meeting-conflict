package com.loading.meetingconfilct.security;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * "내 정보 조회" 예시 컨트롤러.
 *
 * 목적: 백엔드에서 JWT로부터 사용자 정보를 어떻게 꺼내는지 보여주는 예시.
 * 프론트에서 로그인한 사용자가 자기 user_id를 백엔드에서 가져올 수 있는지 확인하는 용도.
 *
 * 사용법 (프론트):
 *   const { data: { session } } = await supabase.auth.getSession();
 *   const token = session.access_token;
 *   fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
 *
 * 그러면 백엔드가 JWT를 검증하고, 그 안의 sub 클레임(auth.users.id)을 꺼내서 돌려줍니다.
 */
@RestController
public class MeController {

    @GetMapping("/api/me")
    public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
        // Supabase JWT의 "sub" 클레임은 auth.users.id(UUID)와 동일합니다.
        String userId = jwt.getSubject();
        String email = jwt.getClaimAsString("email");

        return Map.of(
            "user_id", userId,
            "email", email,
            "message", "Supabase JWT 검증 성공"
        );
    }
}
