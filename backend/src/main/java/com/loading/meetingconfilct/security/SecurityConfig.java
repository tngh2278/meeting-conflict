package com.loading.meetingconfilct.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

import javax.crypto.spec.SecretKeySpec;

/**
 * Spring Security 설정.
 *
 * 역할을 비전공자 눈높이로 설명하면:
 * - "이 백엔드에 요청을 보내는 사람이 진짜 Supabase 로그인한 사용자인지 검사"합니다.
 * - 프론트에서 "Authorization: Bearer eyJxxx..." 헤더를 붙여서 보내면,
 *   Spring Security가 그 JWT를 Supabase의 비밀키로 검증합니다.
 * - 검증 통과하면 컨트롤러로 요청이 들어가고,
 *   실패하면 401 Unauthorized 응답이 나갑니다.
 *
 * 공개 경로(/health, /actuator/**)는 인증 없이 접근 가능합니다.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    // Supabase JWT 비밀키. application.properties에서 환경변수로 주입받습니다.
    // 값은 Supabase 대시보드 → Project Settings → API → JWT Settings → "JWT Secret" 입니다.
    // ⚠️ 이 값은 절대 GitHub에 올리면 안 됩니다! 환경변수로만 관리하세요.
    @Value("${supabase.jwt.secret}")
    private String jwtSecret;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtDecoder jwtDecoder)
            throws Exception {
        http
            // 백엔드는 API만 제공하므로 CSRF 보호는 끕니다 (쿠키 안 쓰기 때문)
            .csrf(csrf -> csrf.disable())
            // 세션을 만들지 않습니다 — 매 요청마다 JWT로 인증합니다 (stateless)
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // 어떤 경로는 인증 없이, 어떤 경로는 인증 필요
            .authorizeHttpRequests(auth -> auth
                // 헬스체크: 배포 플랫폼(Railway/Render)이 서버 살아있는지 확인용
                .requestMatchers("/health", "/actuator/**").permitAll()
                // 그 외 모든 요청은 인증 필요
                .anyRequest().authenticated())
            // JWT 검증을 OAuth2 Resource Server에 맡김
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.decoder(jwtDecoder)));

        return http.build();
    }

    /**
     * Supabase JWT를 검증하는 디코더.
     *
     * Supabase는 HS256 알고리즘(대칭키)으로 JWT를 서명합니다.
     * 그래서 Supabase 대시보드에서 복사한 "JWT Secret" 문자열을 그대로 key로 씁니다.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        // 비밀키 문자열을 바이트 배열로 변환해서 SecretKeySpec을 만듭니다.
        SecretKeySpec key = new SecretKeySpec(jwtSecret.getBytes(), "HmacSHA256");
        return NimbusJwtDecoder.withSecretKey(key)
            .macAlgorithm(MacAlgorithm.HS256)
            .build();
    }
}
