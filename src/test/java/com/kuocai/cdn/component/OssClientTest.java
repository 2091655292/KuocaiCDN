package com.kuocai.cdn.component;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OssClientTest {

    private OssClient ossClient;

    @BeforeEach
    void setUp() {
        ossClient = new OssClient();
        ReflectionTestUtils.setField(ossClient, "bucketName", "image");
    }

    @Test
    void extractsObjectNameFromHistoricalAbsoluteUrl() {
        assertEquals("abc123.png", ossClient.extractObjectName(
                "https://files.example.com/image/abc123.png?old=true"));
    }

    @Test
    void extractsObjectNameFromSameOriginPath() {
        assertEquals("abc123.png", ossClient.extractObjectName("/image/abc123.png"));
    }

    @Test
    void rejectsPathTraversalObjectName() {
        assertNull(ossClient.extractObjectName("../secret.key"));
    }

    @Test
    void onlyAllowsImageExtensionsForPublicServing() {
        assertTrue(ossClient.isPublicImageObjectName("logo.png"));
        assertTrue(ossClient.isPublicImageObjectName("logo.svg"));
        assertFalse(ossClient.isPublicImageObjectName("report.pdf"));
        assertFalse(ossClient.isPublicImageObjectName("../logo.png"));
    }
}
