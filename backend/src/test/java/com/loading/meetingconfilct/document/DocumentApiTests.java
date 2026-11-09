package com.loading.meetingconfilct.document;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

import com.loading.meetingconfilct.ApiCorsConfiguration;
import com.loading.meetingconfilct.HealthController;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(classes = DocumentApiTests.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DocumentApiTests {

    private static final String ORIGIN = "https://meeting-conflict.pages.dev";
    private static final String BOUNDARY = "meeting-document-test-boundary";
    private final HttpClient client = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper mapper;

    @Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration(exclude = {DataSourceAutoConfiguration.class, HibernateJpaAutoConfiguration.class})
    @Import({DocumentController.class, DocumentTextExtractor.class, DocumentExceptionHandler.class,
            ApiCorsConfiguration.class, HealthController.class})
    static class TestApplication {
    }

    @Test
    void uploadsUtf8TextAndReturnsExactParagraphLocations() throws Exception {
        HttpResponse<String> response = upload("minutes.txt", "  회의 😀\r\n\r\n마감 확정  ".getBytes(StandardCharsets.UTF_8));
        assertThat(response.statusCode()).isEqualTo(200);
        assertCors(response);
        JsonNode document = mapper.readTree(response.body());
        assertThat(document.get("fileName").asString()).isEqualTo("minutes.txt");
        assertThat(document.get("format").asString()).isEqualTo("TXT");
        JsonNode page = document.get("pages").get(0);
        assertThat(page.get("pageNumber").isNull()).isTrue();
        assertThat(page.get("paragraphs").size()).isEqualTo(2);
        for (JsonNode paragraph : page.get("paragraphs")) {
            String slice = page.get("text").asString().substring(
                    paragraph.get("startOffset").asInt(), paragraph.get("endOffset").asInt());
            assertThat(slice).isEqualTo(paragraph.get("text").asString());
        }
        assertThat(page.get("paragraphs").get(1).get("paragraphNumber").asInt()).isEqualTo(2);
        assertThat(page.get("paragraphs").get(1).get("text").asString()).isEqualTo("마감 확정");
    }

    @Test
    void uploadsPdfAndPreservesPhysicalPageNumbers() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (PDDocument document = new PDDocument()) {
            for (String text : new String[]{"First page decision", "Second page task"}) {
                PDPage page = new PDPage();
                document.addPage(page);
                try (PDPageContentStream stream = new PDPageContentStream(document, page)) {
                    stream.beginText();
                    stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                    stream.newLineAtOffset(50, 700);
                    stream.showText(text);
                    stream.endText();
                }
            }
            document.save(bytes);
        }
        HttpResponse<String> response = upload("minutes.pdf", bytes.toByteArray());
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode pages = mapper.readTree(response.body()).get("pages");
        assertThat(pages.size()).isEqualTo(2);
        assertThat(pages.get(0).get("pageNumber").asInt()).isEqualTo(1);
        assertThat(pages.get(1).get("pageNumber").asInt()).isEqualTo(2);
        assertThat(pages.get(1).get("text").asString()).contains("Second page task");
    }

    @Test
    void rejectsUnsupportedFilesWithReadableJson() throws Exception {
        assertError(upload("minutes.hwp", new byte[]{1}), 400, "UNSUPPORTED_FORMAT");
    }

    @Test
    void rejectsEmptyFiles() throws Exception {
        assertError(upload("minutes.txt", new byte[0]), 400, "EMPTY_FILE");
    }

    @Test
    void rejectsInvalidPdfContents() throws Exception {
        assertError(upload("minutes.pdf", "not a PDF".getBytes(StandardCharsets.UTF_8)), 400, "INVALID_PDF");
    }

    @Test
    void rejectsInvalidUtf8WithoutReplacingCharacters() throws Exception {
        assertError(upload("minutes.txt", new byte[]{(byte) 0xff}), 400, "INVALID_TEXT_ENCODING");
    }

    @Test
    void acceptsTheTenMiBLimitOverHttp() throws Exception {
        byte[] content = "a".repeat(DocumentTextExtractor.MAX_FILE_SIZE_BYTES).getBytes(StandardCharsets.UTF_8);
        assertThat(upload("minutes.txt", content).statusCode()).isEqualTo(200);
    }

    @Test
    void servletRejectsFilesOverTenMiBAndStillReturnsCorsHeaders() throws Exception {
        assertError(upload("minutes.txt", new byte[DocumentTextExtractor.MAX_FILE_SIZE_BYTES + 1]),
                413, "FILE_TOO_LARGE");
    }

    @Test
    void servletRejectsRequestsOverElevenMiBWithJson() throws Exception {
        assertError(upload("minutes.txt", new byte[11 * 1024 * 1024]), 413, "FILE_TOO_LARGE");
    }

    @Test
    void reportsMissingFilePart() throws Exception {
        byte[] body = ("--" + BOUNDARY + "--\r\n").getBytes(StandardCharsets.UTF_8);
        assertError(sendMultipart(body), 400, "MISSING_FILE");
    }

    @Test
    void acceptsPreflightFromDeployedFrontend() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri("/api/documents/extract"))
                .header("Origin", ORIGIN)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "content-type")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertCors(response);
    }

    @Test
    void rejectsRequestsFromUnlistedOrigins() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri("/api/documents/extract"))
                .header("Origin", "https://unlisted.example.com")
                .header("Access-Control-Request-Method", "POST")
                .method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        assertThat(client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(403);
    }

    @Test
    void keepsHealthEndpointAvailableWithCors() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri("/api/health")).header("Origin", ORIGIN).build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(mapper.readTree(response.body()).get("status").asString()).isEqualTo("UP");
        assertCors(response);
    }

    private HttpResponse<String> upload(String fileName, byte[] content) throws Exception {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(("--" + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\""
                + fileName + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(content);
        body.write(("\r\n--" + BOUNDARY + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return sendMultipart(body.toByteArray());
    }

    private HttpResponse<String> sendMultipart(byte[] body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri("/api/documents/extract"))
                .header("Origin", ORIGIN)
                .header("Content-Type", "multipart/form-data; boundary=" + BOUNDARY)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
        return client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private void assertError(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertCors(response);
        JsonNode error = mapper.readTree(response.body());
        assertThat(error.get("code").asString()).isEqualTo(code);
        assertThat(error.get("message").asString()).isNotBlank();
    }

    private void assertCors(HttpResponse<String> response) {
        assertThat(response.headers().firstValue("access-control-allow-origin")).contains(ORIGIN);
    }
}
