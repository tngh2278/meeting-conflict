package com.loading.meetingconfilct;

import java.util.Map;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

// 연결 테스트
@RestController
@CrossOrigin(origins = {
    "https://meeting-conflict.pages.dev",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
})

public class HealthController {

    @GetMapping("/api/health")
    public Map<String, String> health() {
        return Map.of("status", "UP");
    }
}
