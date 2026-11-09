package com.loading.meetingconfilct.document;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

import com.loading.meetingconfilct.document.DocumentExtractionException.Code;

@RestControllerAdvice
public class DocumentExceptionHandler {

    @ExceptionHandler(DocumentExtractionException.class)
    ResponseEntity<ApiError> extractionFailed(DocumentExtractionException exception) {
        HttpStatus status = exception.getCode() == Code.FILE_TOO_LARGE
                ? HttpStatus.CONTENT_TOO_LARGE : HttpStatus.BAD_REQUEST;
        return ResponseEntity.status(status).body(new ApiError(exception.getCode().name(), exception.getMessage()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ApiError> uploadTooLarge() {
        return ResponseEntity.status(HttpStatus.CONTENT_TOO_LARGE)
                .body(new ApiError("FILE_TOO_LARGE", "파일 크기는 10MB 이하여야 합니다."));
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    ResponseEntity<ApiError> missingFile() {
        return ResponseEntity.badRequest().body(new ApiError("MISSING_FILE", "회의록 파일을 선택해 주세요."));
    }

    @ExceptionHandler(MultipartException.class)
    ResponseEntity<ApiError> invalidUpload() {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_UPLOAD", "파일 전송 형식을 확인해 주세요."));
    }

    @ExceptionHandler(IOException.class)
    ResponseEntity<ApiError> fileReadFailed() {
        return ResponseEntity.internalServerError()
                .body(new ApiError("FILE_READ_FAILED", "전송된 파일을 읽지 못했습니다. 다시 시도해 주세요."));
    }

    public record ApiError(String code, String message) {
    }
}
