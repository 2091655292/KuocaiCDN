package com.kuocai.cdn.controller;

import com.kuocai.cdn.component.OssClient;
import io.minio.StatObjectResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ImageControllerTest {

    @Test
    void rejectsNonImageObjectsWithoutCallingStorage() {
        OssClient ossClient = mock(OssClient.class);
        when(ossClient.isPublicImageObjectName("report.pdf")).thenReturn(false);

        ImageController controller = new ImageController(ossClient);

        assertEquals(HttpStatus.NOT_FOUND, controller.image("report.pdf").getStatusCode());
        verify(ossClient).isPublicImageObjectName("report.pdf");
    }

    @Test
    void returnsImageMetadataAndStreamingBodyForExistingObject() throws Exception {
        OssClient ossClient = mock(OssClient.class);
        StatObjectResponse stat = mock(StatObjectResponse.class);
        when(ossClient.isPublicImageObjectName("logo.png")).thenReturn(true);
        when(ossClient.getStatObject("logo.png")).thenReturn(stat);
        when(stat.size()).thenReturn(128L);

        ImageController controller = new ImageController(ossClient);

        org.springframework.http.ResponseEntity<?> response = controller.image("logo.png");
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(128L, response.getHeaders().getContentLength());
        assertEquals("image/png", response.getHeaders().getFirst("Content-Type"));
        assertNotNull(response.getBody());
        verify(ossClient).getStatObject("logo.png");
    }
}
