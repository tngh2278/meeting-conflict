package com.loading.meetingconfilct.document;

import java.io.IOException;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.loading.meetingconfilct.document.DocumentExtractionException.Code;

@RestController
@RequestMapping("/api/documents")
public class DocumentController {

    private final DocumentTextExtractor extractor;

    public DocumentController(DocumentTextExtractor extractor) {
        this.extractor = extractor;
    }

    @PostMapping(path = "/extract", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ExtractedDocument extract(@RequestParam("file") MultipartFile file) throws IOException {
        if (file.getSize() > DocumentTextExtractor.MAX_FILE_SIZE_BYTES) {
            throw new DocumentExtractionException(Code.FILE_TOO_LARGE, "파일 크기는 10MB 이하여야 합니다.");
        }
        return extractor.extract(file.getOriginalFilename(), file.getBytes());
    }
}
