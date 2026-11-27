package com.loading.meetingconfilct.photo;

import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/photos")
public class MeetingPhotoAddressController {

    private static final String FIND_COORDINATES = """
            select p.latitude, p.longitude
            from public.meeting_photos p
            join public.meetings m
              on m.meeting_id = p.meeting_id and m.team_id = p.team_id
            where p.photo_id = :photoId
              and p.consent = true
              and m.deleted_at is null
              and exists (
                select 1
                from public.team_members tm
                where tm.team_id = p.team_id
                  and tm.user_id = :userId
                  and tm.status = 'ACCEPTED'
              )
            """;

    private final JdbcClient db;
    private final RestClient kakao;
    private final String apiKey;

    public MeetingPhotoAddressController(
            JdbcClient db,
            @Value("${KAKAO_REST_API_KEY:}") String apiKey) {
        this.db = db;
        this.apiKey = apiKey.trim();

        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3_000);
        factory.setReadTimeout(5_000);

        this.kakao = RestClient.builder()
                .baseUrl("https://dapi.kakao.com")
                .requestFactory(factory)
                .build();
    }

    @GetMapping("/{photoId}/address")
    public ResponseEntity<PhotoAddress> address(
            @PathVariable("photoId") UUID photoId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(lookupAddress(findCoordinates(photoId, jwt)));
    }

    @GetMapping("/{photoId}/map")
    public ResponseEntity<byte[]> map(
            @PathVariable("photoId") UUID photoId,
            @AuthenticationPrincipal Jwt jwt) {
        Coordinates coordinates = findCoordinates(photoId, jwt);
        if (!hasValidGps(coordinates)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND, "사진의 GPS 좌표가 없습니다.");
        }
        if (apiKey.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE, "지도 API 키가 설정되지 않았습니다.");
        }

        // 카카오 정적 지도는 경도, 위도 순서로 받는다.
        String center = coordinates.longitude() + "," + coordinates.latitude();

        ResponseEntity<byte[]> map;
        try {
            map = kakao.get()
                    .uri(builder -> builder.path("/v2/maps/staticmap")
                            .queryParam("center", "{center}")
                            .queryParam("markers", "{marker}")
                            .queryParam("size", "560x320")
                            .queryParam("lv", 3)
                            .queryParam("scale", 1)
                            .queryParam("format", "png")
                            .build(center, "location:" + center))
                    .header(HttpHeaders.AUTHORIZATION, "KakaoAK " + apiKey)
                    .retrieve()
                    .toEntity(byte[].class);
        } catch (RestClientException exception) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY, "지도를 불러오지 못했습니다.");
        }

        byte[] image = map.getBody();
        if (image == null || image.length == 0
                || !MediaType.IMAGE_PNG.isCompatibleWith(map.getHeaders().getContentType())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY, "지도 이미지를 읽지 못했습니다.");
        }

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.IMAGE_PNG)
                .body(image);
    }

    private Coordinates findCoordinates(UUID photoId, Jwt jwt) {
        // 요청자가 속한 팀의 사진 좌표만 읽는다.
        return db.sql(FIND_COORDINATES)
                .param("photoId", photoId)
                .param("userId", UUID.fromString(jwt.getSubject()))
                .query((row, rowIndex) -> new Coordinates(
                        row.getObject("latitude", Double.class),
                        row.getObject("longitude", Double.class)))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "사진을 찾을 수 없습니다."));
    }

    private static boolean hasValidGps(Coordinates coordinates) {
        Double latitude = coordinates.latitude();
        Double longitude = coordinates.longitude();
        return latitude != null && longitude != null
                && Double.isFinite(latitude) && Double.isFinite(longitude)
                && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    }

    private PhotoAddress lookupAddress(Coordinates coordinates) {
        if (coordinates.latitude() == null || coordinates.longitude() == null) {
            return new PhotoAddress("missing-gps", null);
        }

        if (apiKey.isBlank() || !hasValidGps(coordinates)) {
            return new PhotoAddress("error", null);
        }

        try {
            // 카카오 API의 x는 경도, y는 위도다.
            JsonNode response = kakao.get()
                    .uri(builder -> builder.path("/v2/local/geo/coord2address.json")
                            .queryParam("x", coordinates.longitude())
                            .queryParam("y", coordinates.latitude())
                            .build())
                    .header(HttpHeaders.AUTHORIZATION, "KakaoAK " + apiKey)
                    .retrieve()
                    .body(JsonNode.class);

            return readAddress(response);
        } catch (RestClientException | JacksonException exception) {
            return new PhotoAddress("error", null);
        }
    }

    static PhotoAddress readAddress(JsonNode response) {
        if (response == null || !response.path("documents").isArray()) {
            return new PhotoAddress("error", null);
        }

        String landLot = "";
        for (JsonNode document : response.path("documents")) {
            String road = document.path("road_address").path("address_name").asString("");
            if (!road.isBlank())
                return new PhotoAddress("found", road);

            if (landLot.isBlank()) {
                landLot = document.path("address").path("address_name").asString("");
            }
        }

        return landLot.isBlank()
                ? new PhotoAddress("not-found", null)
                : new PhotoAddress("found", landLot);
    }

    private record Coordinates(Double latitude, Double longitude) {
    }

    public record PhotoAddress(String status, String address) {
    }
}