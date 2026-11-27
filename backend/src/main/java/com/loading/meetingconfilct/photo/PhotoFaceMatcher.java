package com.loading.meetingconfilct.photo;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;

import nu.pattern.OpenCV;
import org.opencv.core.Core;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.core.Size;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;
import org.opencv.objdetect.FaceDetectorYN;
import org.opencv.objdetect.FaceRecognizerSF;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class PhotoFaceMatcher {
    private static final int MAX_PIXELS = 24_000_000;
    private static final int MAX_SIDE = 1600;
    private static final int RETRY_MAX_SIDE = 640;
    // 로컬 테스트용 초기값. 다양한 사진으로 검증하고 조정한다.
    private static final double MIN_SCORE = 0.50;
    private static final double MIN_GAP = 0.08;

    private final Path modelDir;
    private FaceDetectorYN detector;
    private FaceRecognizerSF recognizer;

    PhotoFaceMatcher(@Value("${FACE_MODEL_DIR:models}") String modelDir) {
        this.modelDir = Path.of(modelDir);
    }

    // YuNet은 사진 크기에 맞춰 설정을 바꾸므로 한 번에 한 장씩 처리한다.
    synchronized List<float[]> features(byte[] bytes) {
        if (!readableImage(bytes)) return List.of();
        loadModels();

        MatOfByte input = new MatOfByte(bytes);
        Mat image = null;
        Mat smaller = new Mat();
        Mat faces = new Mat();
        Mat aligned = new Mat();
        Mat feature = new Mat();

        try {
            image = Imgcodecs.imdecode(input, Imgcodecs.IMREAD_COLOR);
            if (image.empty()) return List.of();

            Mat work = detectFaces(image, smaller, faces, MAX_SIDE);
            if (faces.empty() && Math.max(work.rows(), work.cols()) > RETRY_MAX_SIDE) {
                // 얼굴이 화면을 크게 채운 사진은 크기를 줄여 다시 검출한다.
                work = detectFaces(image, smaller, faces, RETRY_MAX_SIDE);
            }
            List<float[]> result = new ArrayList<>();

            for (int i = 0; i < faces.rows(); i++) {
                Mat row = faces.row(i);
                try {
                    recognizer.alignCrop(work, row, aligned);
                    recognizer.feature(aligned, feature);
                    Core.normalize(feature, feature);
                    float[] vector = new float[(int) feature.total()];
                    feature.get(0, 0, vector);
                    result.add(vector);
                } finally {
                    row.release();
                }
            }

            return result;
        } finally {
            feature.release();
            aligned.release();
            faces.release();
            smaller.release();
            if (image != null) image.release();
            input.release();
        }
    }

    private Mat detectFaces(Mat image, Mat smaller, Mat faces, int maxSide) {
        int longest = Math.max(image.rows(), image.cols());
        Mat work = image;
        if (longest > maxSide) {
            double scale = (double) maxSide / longest;
            Size shape = new Size(
                    Math.max(1, Math.round(image.cols() * scale)),
                    Math.max(1, Math.round(image.rows() * scale)));
            Imgproc.resize(image, smaller, shape, 0, 0, Imgproc.INTER_AREA);
            work = smaller;
        }

        detector.setInputSize(work.size());
        detector.detect(work, faces);
        return work;
    }

    static UUID bestMatch(float[] face, Map<UUID, float[]> references) {
        UUID userId = null;
        double best = Double.NEGATIVE_INFINITY;
        double second = Double.NEGATIVE_INFINITY;

        for (var entry : references.entrySet()) {
            float[] reference = entry.getValue();
            double score = 0;
            for (int i = 0; i < face.length; i++) {
                score += (double) face[i] * reference[i];
            }
            if (score > best) {
                second = best;
                best = score;
                userId = entry.getKey();
            } else if (score > second) {
                second = score;
            }
        }

        return best >= MIN_SCORE && best - second >= MIN_GAP ? userId : null;
    }

    private void loadModels() {
        if (recognizer != null) return;

        Path yuNet = modelDir.resolve("face_detection_yunet_2023mar.onnx");
        Path sFace = modelDir.resolve("face_recognition_sface_2021dec.onnx");
        if (!Files.isRegularFile(yuNet) || !Files.isRegularFile(sFace)) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE, "얼굴 대조 모델 파일을 확인해 주세요.");
        }

        OpenCV.loadLocally();
        detector = FaceDetectorYN.create(yuNet.toString(), "", new Size(320, 320));
        recognizer = FaceRecognizerSF.create(sFace.toString(), "");
    }

    // 큰 사진이나 깨진 파일을 네이티브 디코더에 보내기 전에 크기를 확인한다.
    private static boolean readableImage(byte[] bytes) {
        if (bytes.length == 0 || bytes.length > 10 * 1024 * 1024) return false;

        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) return false;

            var reader = readers.next();
            try {
                String format = reader.getFormatName();
                if (!format.equalsIgnoreCase("JPEG") && !format.equalsIgnoreCase("PNG")) {
                    return false;
                }
                reader.setInput(input);
                return (long) reader.getWidth(0) * reader.getHeight(0) <= MAX_PIXELS;
            } finally {
                reader.dispose();
            }
        } catch (IOException exception) {
            return false;
        }
    }
}
