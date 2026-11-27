package com.loading.meetingconfilct.photo;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/photos")
public class MeetingPhotoFaceController {
    private static final String FIND_PHOTO = """
            select p.team_id, p.meeting_id, p.storage_path
            from public.meeting_photos p
            join public.meetings m
              on m.meeting_id = p.meeting_id and m.team_id = p.team_id
            where p.photo_id = :photoId and p.consent = true
              and m.deleted_at is null
              and exists (
                select 1 from public.team_members tm
                where tm.team_id = p.team_id and tm.user_id = :userId
                  and tm.status = 'ACCEPTED'
              )
            """;

    private static final String FIND_REFERENCES = """
            select distinct tm.user_id
            from public.team_members tm
            join storage.objects o
              on o.bucket_id = 'face-references'
             and o.name = tm.user_id::text || '/reference.jpg'
            where tm.team_id = :teamId and tm.status = 'ACCEPTED'
            """;

    private final JdbcClient db;
    private final PhotoFaceMatcher matcher;
    private final RestClient storage;
    private final String secretKey;

    public MeetingPhotoFaceController(
            JdbcClient db,
            PhotoFaceMatcher matcher,
            @Value("${SUPABASE_URL}") String url,
            @Value("${SUPABASE_SECRET_KEY:}") String secretKey) {
        this.db = db;
        this.matcher = matcher;
        this.secretKey = secretKey.trim();

        var timeout = new SimpleClientHttpRequestFactory();
        timeout.setConnectTimeout(3000);
        timeout.setReadTimeout(5000);
        this.storage = RestClient.builder().baseUrl(url).requestFactory(timeout).build();
    }

    @PostMapping("/{photoId}/face-matches")
    public ResponseEntity<MatchResult> match(
            @PathVariable("photoId") UUID photoId,
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody Consent consent) {
        if (!consent.confirmed()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "사진 속 인물의 동의를 확인해 주세요.");
        }

        // 사진을 읽기 전에 로그인한 사용자의 팀 소속을 확인한다.
        Photo photo = db.sql(FIND_PHOTO)
                .param("photoId", photoId)
                .param("userId", UUID.fromString(jwt.getSubject()))
                .query((row, index) -> new Photo(
                        row.getObject("team_id", UUID.class),
                        row.getObject("meeting_id", UUID.class),
                        row.getString("storage_path")))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "이 회의 사진을 찾을 수 없습니다."));

        String path = photo.storagePath();
        String base = photo.teamId() + "/" + photo.meetingId() + "/" + photoId;
        if (!((base + ".jpg").equals(path) || (base + ".jpeg").equals(path)
                || (base + ".png").equals(path))) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND, "회의 사진 저장 경로를 확인해 주세요.");
        }

        byte[] image = download("meeting-photos", path);
        if (image == null) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND, "저장된 회의 사진을 찾을 수 없습니다.");
        }

        List<float[]> faces = matcher.features(image);
        Map<UUID, float[]> references = new LinkedHashMap<>();
        List<UUID> members = faces.isEmpty() ? List.of()
                : db.sql(FIND_REFERENCES)
                    .param("teamId", photo.teamId())
                    .query(UUID.class)
                    .list();

        for (UUID member : members) {
            byte[] reference = download("face-references", member + "/reference.jpg");
            if (reference == null) continue;

            List<float[]> features = matcher.features(reference);
            if (features.size() == 1) references.put(member, features.getFirst());
        }

        List<FaceCandidate> candidates = faces.stream()
                .map(face -> new FaceCandidate(PhotoFaceMatcher.bestMatch(face, references)))
                .toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new MatchResult(members.size(), List.copyOf(references.keySet()), candidates));
    }

    private byte[] download(String bucket, String path) {
        if (secretKey.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE, "서버의 Supabase Secret Key 설정을 확인해 주세요.");
        }

        try {
            return storage.get()
                    .uri(builder -> builder
                            .pathSegment("storage", "v1", "object", "authenticated", bucket)
                            .pathSegment(path.split("/"))
                            .build())
                    .header("apikey", secretKey)
                    .retrieve()
                    .body(byte[].class);
        } catch (HttpClientErrorException.NotFound exception) {
            return null;
        } catch (RestClientException exception) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY, "저장소에서 사진을 불러오지 못했습니다.");
        }
    }

    private record Photo(UUID teamId, UUID meetingId, String storagePath) {}
    public record Consent(boolean confirmed) {}
    public record FaceCandidate(UUID userId) {}
    public record MatchResult(
            int registeredReferenceCount, List<UUID> referenceUserIds, List<FaceCandidate> faces) {}
}
