package com.loading.meetingconfilct.document;

import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.client.RestClient;

import tools.jackson.databind.json.JsonMapper;

class DecisionComparisonTests {
    private final JsonMapper json = JsonMapper.builder().build();
    private DecisionComparisonService service;
    private MockRestServiceServer gemini;
    private MockMvc api;

    @BeforeEach
    void setUp() {
        service = new DecisionComparisonService("test-key", json);
        RestClient.Builder builder = RestClient.builder()
                .baseUrl("https://generativelanguage.googleapis.com");
        gemini = MockRestServiceServer.bindTo(builder).build();
        ReflectionTestUtils.setField(service, "gemini", builder.build());
        api = MockMvcBuilders.standaloneSetup(new DecisionComparisonController(service)).build();
    }

    @Test
    void firstDecisionDoesNotRequireGeminiKeyOrNetwork() throws Exception {
        ReflectionTestUtils.setField(service, "apiKey", "");
        send(new DecisionComparisonService.Request("p1", item("new", "p1"), List.of()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.matches").isEmpty());
        gemini.verify();
    }

    @Test
    void rejectsCandidateFromAnotherProject() throws Exception {
        send(new DecisionComparisonService.Request("p1", item("new", "p2"), List.of()))
                .andExpect(status().isBadRequest());
        gemini.verify();
    }

    @Test
    void rejectsExistingDecisionFromAnotherProject() throws Exception {
        send(new DecisionComparisonService.Request("p1", item("new", "p1"), List.of(item("old", "p2"))))
                .andExpect(status().isBadRequest());
        gemini.verify();
    }

    @Test
    void rejectsRepeatedInputIds() throws Exception {
        send(new DecisionComparisonService.Request("p1", item("new", "p1"),
                List.of(item("old", "p1"), item("old", "p1"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsMissingCandidateAndOversizedInput() throws Exception {
        send(new DecisionComparisonService.Request("p1", null, List.of()))
                .andExpect(status().isBadRequest());
        var large = new DecisionComparisonService.Item("new", "p1", "Banner",
                "Lee", "2026-11-25", "x".repeat(60_001), false);
        send(new DecisionComparisonService.Request("p1", large, List.of()))
                .andExpect(status().isContentTooLarge());
    }

    @Test
    void returnsMatchedIdInsteadOfFirstDecision() throws Exception {
        respond("""
                {"reason":"Compare banner","matches":[
                {"decisionId":"second","relation":"CONFLICT","reason":"Different owner and deadline"}]}
                """);
        send(request()).andExpect(status().isOk())
                .andExpect(jsonPath("$.matches[0].decisionId").value("second"))
                .andExpect(jsonPath("$.matches[0].relation").value("CONFLICT"));
        gemini.verify();
    }

    @Test
    void returnsMultipleRelatedDecisionsForUserSelection() throws Exception {
        respond("""
                {"reason":"Two related decisions","matches":[
                {"decisionId":"first","relation":"REVIEW","reason":"Check scope"},
                {"decisionId":"second","relation":"CHANGE","reason":"Explicit approval"}]}
                """);
        send(request()).andExpect(status().isOk())
                .andExpect(jsonPath("$.matches.length()").value(2));
        gemini.verify();
    }

    @Test
    void acceptsNoRelatedExistingDecision() throws Exception {
        respond("{\"reason\":\"Different work\",\"matches\":[]}");
        send(request()).andExpect(status().isOk()).andExpect(jsonPath("$.matches").isEmpty());
        gemini.verify();
    }

    @Test
    void rejectsModelInventedId() throws Exception {
        respond("""
                {"reason":"Compare","matches":[
                {"decisionId":"not-provided","relation":"CONFLICT","reason":"Different"}]}
                """);
        send(request()).andExpect(status().isBadGateway());
        gemini.verify();
    }

    @Test
    void rejectsRepeatedModelIds() throws Exception {
        respond("""
                {"reason":"Compare","matches":[
                {"decisionId":"first","relation":"DUPLICATE","reason":"Same"},
                {"decisionId":"first","relation":"CONFLICT","reason":"Different"}]}
                """);
        send(request()).andExpect(status().isBadGateway());
        gemini.verify();
    }

    @Test
    void rejectsInvalidRelation() throws Exception {
        respond("""
                {"reason":"Compare","matches":[
                {"decisionId":"first","relation":"AUTO_APPROVED","reason":"Unsupported"}]}
                """);
        send(request()).andExpect(status().isBadGateway());
        gemini.verify();
    }

    @Test
    void preservesUpstreamFailureStatusInMessage() throws Exception {
        gemini.expect(requestTo(endpoint())).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE));
        send(request()).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.detail").value("Gemini 비교 요청 실패: 503"));
        gemini.verify();
    }

    @Test
    void reportsQuotaExceeded() throws Exception {
        gemini.expect(requestTo(endpoint())).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        send(request()).andExpect(status().isTooManyRequests());
        gemini.verify();
    }

    private ResultActions send(DecisionComparisonService.Request request) throws Exception {
        return api.perform(post("/api/decisions/compare").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(request)));
    }

    private DecisionComparisonService.Request request() {
        return new DecisionComparisonService.Request("p1", item("new", "p1"),
                List.of(item("first", "p1"), item("second", "p1")));
    }

    private DecisionComparisonService.Item item(String id, String project) {
        return new DecisionComparisonService.Item(id, project, "Banner final approval",
                "Lee", "2026-11-25", "Lee will finalize the banner by November 25.", false);
    }

    private void respond(String output) {
        String body = json.writeValueAsString(Map.of("candidates", List.of(Map.of(
                "finishReason", "STOP", "content", Map.of("parts", List.of(Map.of("text", output)))))));
        gemini.expect(requestTo(endpoint())).andExpect(header("x-goog-api-key", "test-key"))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
    }

    private String endpoint() {
        return "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";
    }
}
