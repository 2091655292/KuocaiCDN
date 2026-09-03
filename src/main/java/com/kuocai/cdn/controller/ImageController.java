package com.kuocai.cdn.controller;

import com.kuocai.cdn.component.OssClient;
import io.minio.GetObjectResponse;
import io.minio.StatObjectResponse;
import io.minio.errors.ErrorResponseException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.time.Duration;
import java.util.Locale;

/** Serves uploaded image objects when the reverse proxy does not expose MinIO directly. */
@RestController
@Slf4j
public class ImageController {

    private final OssClient ossClient;

    public ImageController(OssClient ossClient) {
        this.ossClient = ossClient;
    }

    @GetMapping("/image/{objectName:.+}")
    public ResponseEntity<StreamingResponseBody> image(@PathVariable String objectName) {
        if (!ossClient.isPublicImageObjectName(objectName)) {
            return notFound();
        }

        StatObjectResponse stat;
        try {
            stat = ossClient.getStatObject(objectName);
        } catch (ErrorResponseException e) {
            if (isNotFound(e)) {
                return notFound();
            }
            log.warn("Unable to inspect public image object {}", objectName, e);
            return serviceUnavailable();
        } catch (Exception e) {
            log.warn("Unable to inspect public image object {}", objectName, e);
            return serviceUnavailable();
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(contentType(objectName));
        headers.setContentLength(stat.size());
        headers.setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic());
        headers.set("X-Content-Type-Options", "nosniff");

        StreamingResponseBody body = outputStream -> {
            try (GetObjectResponse inputStream = ossClient.getObject(objectName)) {
                StreamUtils.copy(inputStream, outputStream);
            } catch (Exception e) {
                log.warn("Unable to stream public image object {}", objectName, e);
                throw new IOException("Unable to read image", e);
            }
        };
        return new ResponseEntity<>(body, headers, HttpStatus.OK);
    }

    private MediaType contentType(String objectName) {
        String extension = objectName.substring(objectName.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "jpg":
            case "jpeg":
                return MediaType.IMAGE_JPEG;
            case "gif":
                return MediaType.IMAGE_GIF;
            case "svg":
                return MediaType.parseMediaType("image/svg+xml");
            case "ico":
                return MediaType.parseMediaType("image/x-icon");
            case "webp":
                return MediaType.parseMediaType("image/webp");
            case "bmp":
                return MediaType.parseMediaType("image/bmp");
            default:
                return MediaType.IMAGE_PNG;
        }
    }

    private boolean isNotFound(ErrorResponseException exception) {
        String code = exception.errorResponse() == null ? null : exception.errorResponse().code();
        return "NoSuchKey".equals(code) || "NoSuchObject".equals(code) || "NotFound".equals(code);
    }

    private ResponseEntity<StreamingResponseBody> notFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
    }

    private ResponseEntity<StreamingResponseBody> serviceUnavailable() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
    }
}
