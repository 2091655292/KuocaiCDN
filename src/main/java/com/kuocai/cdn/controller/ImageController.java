package com.kuocai.cdn.controller;

import com.kuocai.cdn.component.LocalStorageClient;
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
import java.io.InputStream;
import java.time.Duration;
import java.util.Locale;

/** Serves uploaded images from local storage via the same-origin endpoint. */
@RestController
@Slf4j
public class ImageController {

    private final LocalStorageClient localStorageClient;

    public ImageController(LocalStorageClient localStorageClient) {
        this.localStorageClient = localStorageClient;
    }

    @GetMapping("/image/{objectName:.+}")
    public ResponseEntity<StreamingResponseBody> image(@PathVariable String objectName) {
        if (!localStorageClient.isPublicImageObjectName(objectName)) {
            return notFound();
        }

        long size;
        try {
            size = localStorageClient.getObjectSize(objectName);
        } catch (Exception e) {
            log.warn("Unable to inspect public image object {}", objectName, e);
            return notFound();
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(contentType(objectName));
        headers.setContentLength(size);
        headers.setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic());
        headers.set("X-Content-Type-Options", "nosniff");

        StreamingResponseBody body = outputStream -> {
            try (InputStream inputStream = localStorageClient.getObject(objectName)) {
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
                return MediaType.IMAGE_PNG;
            default:
                return MediaType.IMAGE_PNG;
        }
    }

    private ResponseEntity<StreamingResponseBody> notFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
    }
}
