package com.loading.meetingconfilct.document;

public class DocumentExtractionException extends RuntimeException {

    private final Code code;

    public DocumentExtractionException(Code code, String message) {
        super(message);
        this.code = code;
    }

    public DocumentExtractionException(Code code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public Code getCode() {
        return code;
    }

    public enum Code {
        MISSING_FILE_NAME,
        UNSUPPORTED_FORMAT,
        EMPTY_FILE,
        FILE_TOO_LARGE,
        INVALID_TEXT_ENCODING,
        INVALID_TEXT_CONTENT,
        ENCRYPTED_PDF,
        INVALID_PDF,
        NO_EXTRACTABLE_TEXT
    }
}
