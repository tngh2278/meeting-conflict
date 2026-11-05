package com.loading.meetingconfilct.document;

import java.util.List;

public record ExtractedDocument(String fileName, Format format, List<Page> pages) {

    public ExtractedDocument {
        pages = List.copyOf(pages);
    }

    public enum Format {
        PDF, TXT
    }

    // TXT has no physical pages, so its pageNumber is null.
    public record Page(Integer pageNumber, String text, List<Paragraph> paragraphs) {

        public Page {
            paragraphs = List.copyOf(paragraphs);
        }
    }

    // Offsets use Java String indices: UTF-16, start inclusive, end exclusive.
    public record Paragraph(int paragraphNumber, String text, int startOffset, int endOffset) {
    }
}
