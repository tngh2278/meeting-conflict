package com.loading.meetingconfilct.document;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

public record MeetingBasicInfo(
        String date,
        String time,
        String location,
        List<String> attendees) {

    private static final Pattern DATE = Pattern.compile(
            "(?<!\\d)(\\d{4})\\h*(?:년|[./-])\\h*(\\d{1,2})\\h*(?:월|[./-])\\h*(\\d{1,2})(?!\\d)");
    private static final Pattern TIME = Pattern.compile(
            "(?<!\\d)(?:(오전|오후)\\h*)?(\\d{1,2})(?::(\\d{2})|\\h*시(?:\\h*(\\d{1,2})\\h*분)?)(?!\\d)");

    public static MeetingBasicInfo from(ExtractedDocument document) {
        if (document.pages().isEmpty()) {
            return new MeetingBasicInfo(null, null, null, List.of());
        }

        String date = null;
        String time = null;
        String location = null;
        List<String> attendees = List.of();

        // 문서 앞부분의 항목명을 사용해 기한이나 후속 일정과 구분한다.
        var lines = document.pages().getFirst().text().lines().limit(30).toList();
        for (String line : lines) {
            String[] field = line.strip()
                    .replaceFirst("^[-*+•]\\h+", "")
                    .replace("**", "")
                    .split("[:：]", 2);

            if (field.length != 2 || field[1].isBlank())
                continue;

            String label = field[0].replaceAll("\\h+", "");
            String value = field[1].strip();

            switch (label) {
                case "일시", "회의일시" -> {
                    if (date == null)
                        date = readDate(value);
                    if (time == null)
                        time = readTime(value);
                }
                case "회의일", "회의일자", "회의날짜", "일자", "날짜" -> {
                    if (date == null)
                        date = readDate(value);
                }
                case "회의시간", "시간" -> {
                    if (time == null)
                        time = readTime(value);
                }
                case "회의장소", "장소" -> {
                    if (location == null)
                        location = value;
                }
                case "참석자", "회의참석자", "참석" -> {
                    if (attendees.isEmpty()) {
                        attendees = Arrays.stream(value.split("[,，、;·]"))
                                .map(String::strip)
                                .filter(name -> !name.isEmpty()
                                        && !List.of("없음", "미정", "-").contains(name))
                                .distinct()
                                .toList();
                    }
                }
                default -> {
                }
            }
        }

        return new MeetingBasicInfo(date, time, location, attendees);
    }

    private static String readDate(String value) {
        var match = DATE.matcher(value);
        if (!match.find())
            return null;

        try {
            return LocalDate.of(
                    Integer.parseInt(match.group(1)),
                    Integer.parseInt(match.group(2)),
                    Integer.parseInt(match.group(3))).toString();
        } catch (DateTimeException invalidDate) {
            return null;
        }
    }

    private static String readTime(String value) {
        var match = TIME.matcher(value);
        if (!match.find())
            return null;

        int hour = Integer.parseInt(match.group(2));
        String rawMinute = match.group(3) != null ? match.group(3) : match.group(4);
        int minute = rawMinute == null ? 0 : Integer.parseInt(rawMinute);
        String meridiem = match.group(1);

        if (meridiem != null) {
            if (hour < 1 || hour > 12)
                return null;
            hour = hour % 12 + ("오후".equals(meridiem) ? 12 : 0);
        }

        try {
            return LocalTime.of(hour, minute).toString();
        } catch (DateTimeException invalidTime) {
            return null;
        }
    }
}