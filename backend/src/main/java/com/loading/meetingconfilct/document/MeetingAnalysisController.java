package com.loading.meetingconfilct.document;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/documents")
public class MeetingAnalysisController {

    private final DocumentTextExtractor extractor;
    private final MeetingAnalysisService analysisService;

    public MeetingAnalysisController(DocumentTextExtractor extractor, MeetingAnalysisService analysisService) {
        this.extractor = extractor;
        this.analysisService = analysisService;
    }

    @PostMapping(path = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public MeetingAnalysisService.AnalysisResult analyze(@RequestParam("file") MultipartFile file) throws IOException {
        if (file.getSize() > DocumentTextExtractor.MAX_FILE_SIZE_BYTES) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "파일 크기는 10MB 이하여야 합니다.");
        }

        // 파일에서 문단을 추출한 뒤 AI 분석에 넘긴다.
        ExtractedDocument document = extractor.extract(file.getOriginalFilename(), file.getBytes());
        return analysisService.analyze(document);
    }

    @ExceptionHandler(DocumentExtractionException.class)
    ProblemDetail extractionFailed(DocumentExtractionException exception) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, exception.getMessage());
    }

    @ExceptionHandler(ResponseStatusException.class)
    ProblemDetail analysisFailed(ResponseStatusException exception) {
        return exception.getBody();
    }
}