package com.loading.meetingconfilct.photo;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;

import com.drew.imaging.FileType;
import com.drew.imaging.FileTypeDetector;
import com.drew.imaging.ImageMetadataReader;
import com.drew.imaging.ImageProcessingException;
import com.drew.lang.GeoLocation;
import com.drew.metadata.Metadata;
import com.drew.metadata.exif.ExifSubIFDDirectory;
import com.drew.metadata.exif.GpsDirectory;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/photos")
public class MeetingPhotoMetadataController {

    private static final DateTimeFormatter EXIF_DATE_TIME = DateTimeFormatter
            .ofPattern("uuuu:MM:dd HH:mm:ss")
            .withResolverStyle(ResolverStyle.STRICT);

    @PostMapping(value = "/metadata", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> extract(@RequestPart("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(new PhotoError("빈 사진 파일입니다."));
        }

        try (var input = new BufferedInputStream(file.getInputStream())) {
            // 파일 내용을 읽어서 실제 이미지 형식을 확인한다.
            FileType type = FileTypeDetector.detectFileType(input);
            if (type != FileType.Jpeg && type != FileType.Png) {
                return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                        .body(new PhotoError("JPEG 또는 PNG 사진을 선택해 주세요."));
            }

            Metadata metadata = ImageMetadataReader.readMetadata(input, file.getSize(), type);
            return ResponseEntity.ok(toResponse(type, metadata));
        } catch (ImageProcessingException | IOException exception) {
            return ResponseEntity.badRequest().body(new PhotoError("사진 파일을 읽지 못했습니다."));
        }
    }

    private static PhotoMetadata toResponse(FileType type, Metadata metadata) {
        ExifSubIFDDirectory exif = metadata.getFirstDirectoryOfType(ExifSubIFDDirectory.class);
        LocalDateTime localTime = exif == null
                ? null
                : parseLocalTime(exif.getString(ExifSubIFDDirectory.TAG_DATETIME_ORIGINAL));
        ZoneOffset offset = exif == null || localTime == null
                ? null
                : parseOffset(exif.getString(ExifSubIFDDirectory.TAG_TIME_ZONE_ORIGINAL));

        GpsDirectory gps = metadata.getFirstDirectoryOfType(GpsDirectory.class);
        GeoLocation location = gps == null ? null : gps.getGeoLocation();
        boolean hasGps = location != null
                && Double.isFinite(location.getLatitude())
                && Double.isFinite(location.getLongitude())
                && Math.abs(location.getLatitude()) <= 90
                && Math.abs(location.getLongitude()) <= 180;

        return new PhotoMetadata(
                type.getMimeType(),
                type.getCommonExtension(),
                localTime == null ? null : localTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME),
                offset == null ? null : localTime.atOffset(offset).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                offset == null ? null : offset.equals(ZoneOffset.UTC) ? "+00:00" : offset.getId(),
                hasGps ? location.getLatitude() : null,
                hasGps ? location.getLongitude() : null);
    }

    private static LocalDateTime parseLocalTime(String value) {
        if (value == null)
            return null;
        try {
            return LocalDateTime.parse(value.trim(), EXIF_DATE_TIME);
        } catch (DateTimeException exception) {
            return null;
        }
    }

    private static ZoneOffset parseOffset(String value) {
        if (value == null)
            return null;
        try {
            return ZoneOffset.of(value.trim());
        } catch (DateTimeException exception) {
            return null;
        }
    }

    public record PhotoMetadata(
            String contentType,
            String extension,
            String takenAtLocal,
            String takenAt,
            String timezone,
            Double latitude,
            Double longitude) {
    }

    public record PhotoError(String message) {
    }
}