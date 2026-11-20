package com.loading.meetingconfilct.document;

import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/questions")
public class MeetingQuestionController {

    private final MeetingQuestionService service;

    public MeetingQuestionController(MeetingQuestionService service) {
        this.service = service;
    }

    // 질문과 원문을 받아 답변을 반환한다.
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public MeetingQuestionService.Answer ask(
            @RequestBody MeetingQuestionService.QuestionRequest request) {
        return service.ask(request);
    }

    // 오류 사유를 프론트엔드에 전달한다.
    @ExceptionHandler(ResponseStatusException.class)
    public ProblemDetail handle(ResponseStatusException exception) {
        return exception.getBody();
    }
}