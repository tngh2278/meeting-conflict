package com.loading.meetingconfilct.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    // 백엔드에 들어오는 요청 중 어떤 요청에 로그인이 필요한지 정한다.
    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                // 이 API는 로그인 쿠키 대신 Authorization 헤더의 토큰을 사용하므로
                // 쿠키 기반 인증을 보호하는 CSRF 검사를 끈다.
                .csrf(csrf -> csrf.disable())

                // 로그인 상태를 서버 세션에 저장하지 않는다.
                // 인증이 필요한 요청마다 프론트엔드가 보낸 토큰을 확인한다.
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

                .authorizeHttpRequests(auth -> auth
                        // Render가 서버 상태를 확인할 수 있도록 이 경로들은
                        // 로그인 토큰 없이도 접근할 수 있게 한다.
                        .requestMatchers("/health", "/api/health", "/actuator/**").permitAll()

                        // /api/me를 포함한 나머지 경로에는 유효한 로그인 토큰이 필요하다.
                        .anyRequest().authenticated())

                // Authorization: Bearer <토큰> 형식으로 전달된 JWT를 검증한다.
                // application.properties에 설정한 Supabase 공개 키 주소(JWKS)에서
                // 공개 키를 가져와 ES256 서명을 검증하고, 발급자·대상·만료도 확인한다.
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));

        return http.build();
    }
}