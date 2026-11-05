package com.loading.meetingconfilct.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import com.loading.meetingconfilct.document.DocumentExtractionException.Code;
import com.loading.meetingconfilct.document.ExtractedDocument.Format;
import com.loading.meetingconfilct.document.ExtractedDocument.Page;

class DocumentTextExtractorTests {

    private final DocumentTextExtractor extractor = new DocumentTextExtractor();

    @Test
    void extractsKoreanTextAndMapsParagraphOffsets() {
        String input = "  행사 준비 회의\r\n참석자: 정수호, 송채은, 장준경\r\n \t\r\n자료 제출 마감은 20:00로 확정했습니다.  \r\n";
        ExtractedDocument result = extractor.extract("회의록.txt", utf8(input));

        assertThat(result.fileName()).isEqualTo("회의록.txt");
        assertThat(result.format()).isEqualTo(Format.TXT);
        assertThat(result.pages()).hasSize(1);
        Page page = result.pages().getFirst();
        assertThat(page.pageNumber()).isNull();
        assertThat(page.text()).doesNotContain("\r");
        assertThat(page.paragraphs()).hasSize(2);
        assertThat(page.paragraphs().getFirst().text()).isEqualTo("행사 준비 회의\n참석자: 정수호, 송채은, 장준경");
        assertThat(page.paragraphs().getLast().paragraphNumber()).isEqualTo(2);
        assertThat(page.paragraphs().getLast().text()).isEqualTo("자료 제출 마감은 20:00로 확정했습니다.");
        assertOffsets(result);
    }

    @Test
    void handlesUtf8BomOldMacLineEndingsAndEmojiWithoutLosingOffsets() {
        ExtractedDocument result = extractor.extract("회의록.TXT", utf8("\uFEFF결정 😀\r\r후속 업무"));
        Page page = result.pages().getFirst();
        assertThat(page.text()).isEqualTo("결정 😀\n\n후속 업무");
        assertThat(page.paragraphs()).hasSize(2);
        assertThat(page.paragraphs().getFirst().startOffset()).isZero();
        assertOffsets(result);
    }

    @Test
    void leavesSingleNewlinesInsideOneParagraph() {
        Page page = extractor.extract("minutes.txt", utf8("first line\nsecond line")).pages().getFirst();
        assertThat(page.paragraphs()).hasSize(1);
        assertThat(page.paragraphs().getFirst().text()).isEqualTo(page.text());
    }

    @Test
    void keepsDistinctOffsetsWhenTheSameParagraphAppearsTwice() {
        ExtractedDocument result = extractor.extract("minutes.txt", utf8("마감 확정\n\n마감 확정"));
        Page page = result.pages().getFirst();
        assertThat(page.paragraphs()).hasSize(2);
        assertThat(page.paragraphs().getFirst().startOffset()).isZero();
        assertThat(page.paragraphs().getLast().startOffset()).isEqualTo(7);
        assertOffsets(result);
    }

    @Test
    void acceptsTheDocumentedTenMiBLimit() {
        byte[] content = utf8("a".repeat(DocumentTextExtractor.MAX_FILE_SIZE_BYTES));
        assertThat(extractor.extract("minutes.txt", content).pages().getFirst().text()).hasSize(content.length);
    }

    @Test
    void rejectsFilesAboveTenMiB() {
        assertFailure(Code.FILE_TOO_LARGE, "minutes.txt", new byte[DocumentTextExtractor.MAX_FILE_SIZE_BYTES + 1]);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void rejectsMissingFileNames(String name) {
        assertFailure(Code.MISSING_FILE_NAME, name, utf8("text"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"minutes.hwp", "minutes.docx", "minutes", "minutes.pdf.exe", "minutes.xlsx"})
    void rejectsUnsupportedFormats(String name) {
        assertFailure(Code.UNSUPPORTED_FORMAT, name, utf8("text"));
    }

    @Test
    void rejectsMissingAndEmptyFiles() {
        assertFailure(Code.EMPTY_FILE, "minutes.txt", null);
        assertFailure(Code.EMPTY_FILE, "minutes.pdf", new byte[0]);
    }

    @ParameterizedTest
    @ValueSource(strings = {" ", "\r\n \t\n", "\uFEFF"})
    void rejectsTextFilesWithoutBodyText(String text) {
        assertFailure(Code.NO_EXTRACTABLE_TEXT, "minutes.txt", utf8(text));
    }

    @Test
    void rejectsMalformedUtf8RatherThanSilentlyReplacingCharacters() {
        assertFailure(Code.INVALID_TEXT_ENCODING, "minutes.txt", new byte[] {(byte) 0xC3, 0x28});
    }

    @Test
    void asksForUtf8WhenAKoreanFileUsesCp949() {
        assertFailure(Code.INVALID_TEXT_ENCODING, "회의록.txt", "회의록".getBytes(Charset.forName("MS949")));
    }

    @Test
    void rejectsBinaryControlCharactersInTxtFiles() {
        assertFailure(Code.INVALID_TEXT_CONTENT, "minutes.txt", utf8("text\u0000binary"));
    }

    @Test
    void extractsPdfPagesSeparately() throws Exception {
        ExtractedDocument result = extractor.extract("minutes.PDF", pdf("Deadline: 20:00", "Owner: Jun. Due: 2026-10-16"));
        assertThat(result.format()).isEqualTo(Format.PDF);
        assertThat(result.pages()).extracting(Page::pageNumber).containsExactly(1, 2);
        assertThat(result.pages().getFirst().text()).contains("Deadline: 20:00").doesNotContain("Owner:");
        assertThat(result.pages().getLast().text()).contains("Owner: Jun.").doesNotContain("Deadline:");
        assertThat(result.pages()).allSatisfy(p -> assertThat(p.paragraphs().getFirst().paragraphNumber()).isEqualTo(1));
        assertOffsets(result);
    }

    @Test
    void preservesEmptyPdfPagesSoFollowingPageNumbersDoNotShift() throws Exception {
        ExtractedDocument result = extractor.extract("minutes.pdf", pdf("First decision", "", "Third page decision"));
        assertThat(result.pages()).extracting(Page::pageNumber).containsExactly(1, 2, 3);
        assertThat(result.pages().get(1).paragraphs()).isEmpty();
        assertThat(result.pages().getLast().text()).contains("Third page decision");
        assertOffsets(result);
    }

    @Test
    void rejectsARealImageOnlyScannedPdf() throws Exception {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            document.addPage(page);
            BufferedImage image = new BufferedImage(20, 20, BufferedImage.TYPE_INT_RGB);
            try (PDPageContentStream stream = new PDPageContentStream(document, page)) {
                stream.drawImage(LosslessFactory.createFromImage(document, image), 20, 20);
            }
            document.save(output);
            assertFailure(Code.NO_EXTRACTABLE_TEXT, "scan.pdf", output.toByteArray());
        }
    }

    @Test
    void rejectsBlankPdfDocuments() throws Exception {
        assertFailure(Code.NO_EXTRACTABLE_TEXT, "empty.pdf", pdf(""));
    }

    @Test
    void rejectsDamagedFilesDespiteTheirPdfExtension() {
        assertFailure(Code.INVALID_PDF, "minutes.pdf", utf8("This is not a PDF."));
    }

    @ParameterizedTest
    @ValueSource(strings = {"secret", ""})
    void rejectsEncryptedPdfDocumentsEvenIfTheirOpeningPasswordIsEmpty(String password) throws Exception {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            document.addPage(new PDPage());
            StandardProtectionPolicy protection = new StandardProtectionPolicy("owner-secret", password, new AccessPermission());
            protection.setEncryptionKeyLength(128);
            document.protect(protection);
            document.save(output);
            assertFailure(Code.ENCRYPTED_PDF, "locked.pdf", output.toByteArray());
        }
    }

    @Test
    void returnsReadOnlyPageAndParagraphLists() {
        ExtractedDocument result = extractor.extract("minutes.txt", utf8("Decision"));
        assertThatThrownBy(() -> result.pages().clear()).isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> result.pages().getFirst().paragraphs().clear()).isInstanceOf(UnsupportedOperationException.class);
    }

    private void assertFailure(Code code, String fileName, byte[] content) {
        DocumentExtractionException failure = assertThrows(DocumentExtractionException.class, () -> extractor.extract(fileName, content));
        assertThat(failure.getCode()).isEqualTo(code);
        assertThat(failure.getMessage()).isNotBlank();
    }

    private static void assertOffsets(ExtractedDocument document) {
        for (Page page : document.pages()) {
            int previousEnd = 0;
            for (var paragraph : page.paragraphs()) {
                assertThat(paragraph.startOffset()).isGreaterThanOrEqualTo(previousEnd);
                assertThat(page.text().substring(paragraph.startOffset(), paragraph.endOffset())).isEqualTo(paragraph.text());
                previousEnd = paragraph.endOffset();
            }
        }
    }

    private static byte[] utf8(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] pdf(String... pageTexts) throws Exception {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            for (String text : pageTexts) {
                PDPage page = new PDPage();
                document.addPage(page);
                if (!text.isEmpty()) {
                    try (PDPageContentStream stream = new PDPageContentStream(document, page)) {
                        stream.beginText();
                        stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                        stream.newLineAtOffset(50, 700);
                        stream.showText(text);
                        stream.endText();
                    }
                }
            }
            document.save(output);
            return output.toByteArray();
        }
    }
}
