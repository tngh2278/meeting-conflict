package com.loading.meetingconfilct.document;

import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class DecisionComparisonController {
    private final DecisionComparisonService service;

    public DecisionComparisonController(DecisionComparisonService service) {
        this.service = service;
    }

    // 같은 프로젝트의 기존 결정과 새 후보를 비교한다.
    @PostMapping(path = "/api/decisions/compare", consumes = MediaType.APPLICATION_JSON_VALUE)
    public DecisionComparisonService.Result compare(
            @RequestBody DecisionComparisonService.Request request) {
        return service.compare(request);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ProblemDetail handle(ResponseStatusException exception) {
        return exception.getBody();
    }
}
