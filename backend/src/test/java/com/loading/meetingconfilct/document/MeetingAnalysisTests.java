package com.loading.meetingconfilct.document;

import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestClient;

import tools.jackson.databind.json.JsonMapper;

class MeetingAnalysisTests {

    private final JsonMapper json = JsonMapper.builder().build();
    private MockRestServiceServer gemini;
    private MockMvc api;

    @BeforeEach
    void setUp() {
        MeetingAnalysisService service = new MeetingAnalysisService("test-key", json);
        RestClient.Builder builder = RestClient.builder().baseUrl("https://generativelanguage.googleapis.com");
        gemini = MockRestServiceServer.bindTo(builder).build();
        ReflectionTestUtils.setField(service, "gemini", builder.build());
        api = MockMvcBuilders.standaloneSetup(
                new MeetingAnalysisController(new DocumentTextExtractor(), service)).build();
    }

    @Test
    void returnsAnalysisAndExtractedPdfPagesTogether() throws Exception {
        respond("""
                {"decisions":[{"decision":"Draft","assignee":"Lee","dueDate":"2026-11-20",
                "sourceId":2,"actionItem":true,"sourceQuote":"Lee will draft by November 20."}]}
                """);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (PDDocument document = new PDDocument()) {
            for (String text : List.of("Meeting title", "Lee will draft by November 20.")) {
                PDPage page = new PDPage();
                document.addPage(page);
                try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                    content.beginText();
                    content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                    content.newLineAtOffset(50, 700);
                    content.showText(text);
                    content.endText();
                }
            }
            document.save(bytes);
        }
        api.perform(multipart("/api/documents/analyze").file(
                new MockMultipartFile("file", "meeting.pdf", "application/pdf", bytes.toByteArray())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decisions[0].assignee").value("Lee"))
                .andExpect(jsonPath("$.decisions[0].dueDate").value("2026-11-20"))
                .andExpect(jsonPath("$.decisions[0].source.pageNumber").value(2))
                .andExpect(jsonPath("$.extractedDocument.pages[1].pageNumber").value(2))
                .andExpect(jsonPath("$.extractedDocument.pages[1].paragraphs[0].text")
                        .value("Lee will draft by November 20."));
        gemini.verify();
    }

    @Test
    void excludesEventDateAndUnverifiedQuote() throws Exception {
        respond("""
                {"decisions":[{"decision":"Launch","assignee":null,"dueDate":"2026-12-01",
                "sourceId":1,"actionItem":false,"sourceQuote":"Quote absent from source"}]}
                """);
        api.perform(multipart("/api/documents/analyze").file(textFile()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decisions[0].dueDate").isEmpty())
                .andExpect(jsonPath("$.decisions[0].source.text").isEmpty())
                .andExpect(jsonPath("$.extractedDocument.pages[0].paragraphs[0].text").value("Launch on December 1."));
        gemini.verify();
    }

    @Test
    void acceptsEmptyDecisionList() throws Exception {
        respond("{\"decisions\":[]}");
        api.perform(multipart("/api/documents/analyze").file(textFile()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.decisions").isEmpty());
        gemini.verify();
    }

    @Test
    void reportsUpstreamUnavailableWithoutLosingErrorCode() throws Exception {
        gemini.expect(requestTo("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent"))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        api.perform(multipart("/api/documents/analyze").file(textFile()))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.detail").value("Gemini 요청이 실패했습니다. 응답 코드 503"));
        gemini.verify();
    }

    private void respond(String modelOutput) {
        String body = json.writeValueAsString(Map.of("candidates", List.of(Map.of(
                "finishReason", "STOP",
                "content", Map.of("parts", List.of(Map.of("text", modelOutput)))))));
        gemini.expect(requestTo("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("x-goog-api-key", "test-key"))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
    }

    private MockMultipartFile textFile() {
        return new MockMultipartFile("file", "meeting.txt", "text/plain",
                "Launch on December 1.".getBytes(StandardCharsets.UTF_8));
    }
}
