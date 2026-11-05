package com.loading.meetingconfilct.document;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;

import com.loading.meetingconfilct.document.DocumentExtractionException.Code;
import com.loading.meetingconfilct.document.ExtractedDocument.Format;
import com.loading.meetingconfilct.document.ExtractedDocument.Page;
import com.loading.meetingconfilct.document.ExtractedDocument.Paragraph;

@Service
public class DocumentTextExtractor {

    public static final int MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
    private static final Pattern PARAGRAPH_BREAK = Pattern.compile("\n[\t ]*\n+");

    public ExtractedDocument extract(String fileName, byte[] content) {
        if (fileName == null || fileName.isBlank()) {
            throw new DocumentExtractionException(Code.MISSING_FILE_NAME, "파일 이름이 필요합니다.");
        }
        String lowerName = fileName.toLowerCase(Locale.ROOT);
        Format format;
        if (lowerName.endsWith(".pdf")) {
            format = Format.PDF;
        } else if (lowerName.endsWith(".txt")) {
            format = Format.TXT;
        } else {
            throw new DocumentExtractionException(Code.UNSUPPORTED_FORMAT, "PDF 또는 TXT 회의록만 지원합니다.");
        }
        if (content == null || content.length == 0) {
            throw new DocumentExtractionException(Code.EMPTY_FILE, "빈 파일은 분석할 수 없습니다.");
        }
        if (content.length > MAX_FILE_SIZE_BYTES) {
            throw new DocumentExtractionException(Code.FILE_TOO_LARGE, "파일 크기는 10MB 이하여야 합니다.");
        }

        List<Page> pages = format == Format.PDF ? extractPdf(content) : List.of(page(null, decodeText(content)));
        if (pages.stream().allMatch(p -> p.paragraphs().isEmpty())) {
            throw new DocumentExtractionException(Code.NO_EXTRACTABLE_TEXT,
                    "추출할 텍스트가 없습니다. 스캔 PDF는 지원하지 않습니다. 텍스트가 있는 PDF 또는 TXT를 사용해 주세요.");
        }
        return new ExtractedDocument(fileName, format, pages);
    }

    private String decodeText(byte[] content) {
        try {
            // Do not silently replace malformed Korean text with replacement characters.
            String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(content)).toString();
            if (text.startsWith("\uFEFF")) {
                text = text.substring(1);
            }
            if (text.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t' && c != '\f')) {
                throw new DocumentExtractionException(Code.INVALID_TEXT_CONTENT, "텍스트가 아닌 제어 문자가 포함된 TXT 파일입니다.");
            }
            return text;
        } catch (CharacterCodingException exception) {
            throw new DocumentExtractionException(Code.INVALID_TEXT_ENCODING,
                    "TXT 파일을 UTF-8 인코딩으로 저장한 뒤 다시 등록해 주세요.", exception);
        }
    }

    private List<Page> extractPdf(byte[] content) {
        try (PDDocument document = Loader.loadPDF(content)) {
            if (document.isEncrypted()) {
                throw new DocumentExtractionException(Code.ENCRYPTED_PDF, "암호화된 PDF는 지원하지 않습니다. 암호화를 해제해 주세요.");
            }
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            stripper.setLineSeparator("\n");
            stripper.setParagraphEnd("\n\n");
            stripper.setPageStart("");
            stripper.setPageEnd("");
            List<Page> pages = new ArrayList<>();
            for (int number = 1; number <= document.getNumberOfPages(); number++) {
                stripper.setStartPage(number);
                stripper.setEndPage(number);
                pages.add(page(number, stripper.getText(document)));
            }
            return pages;
        } catch (InvalidPasswordException exception) {
            throw new DocumentExtractionException(Code.ENCRYPTED_PDF, "암호화된 PDF는 지원하지 않습니다. 암호화를 해제해 주세요.", exception);
        } catch (IOException exception) {
            throw new DocumentExtractionException(Code.INVALID_PDF, "PDF를 읽을 수 없습니다. 파일 손상 또는 형식을 확인해 주세요.", exception);
        }
    }

    private Page page(Integer pageNumber, String extractedText) {
        String text = extractedText.replace("\r\n", "\n").replace('\r', '\n');
        List<Paragraph> paragraphs = new ArrayList<>();
        Matcher breaks = PARAGRAPH_BREAK.matcher(text);
        int start = 0;
        while (breaks.find()) {
            addParagraph(paragraphs, text, start, breaks.start());
            start = breaks.end();
        }
        addParagraph(paragraphs, text, start, text.length());
        return new Page(pageNumber, text, paragraphs);
    }

    private void addParagraph(List<Paragraph> paragraphs, String text, int start, int end) {
        while (start < end && Character.isWhitespace(text.charAt(start))) {
            start++;
        }
        while (end > start && Character.isWhitespace(text.charAt(end - 1))) {
            end--;
        }
        if (start < end) {
            paragraphs.add(new Paragraph(paragraphs.size() + 1, text.substring(start, end), start, end));
        }
    }
}
