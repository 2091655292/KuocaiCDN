package com.kuocai.cdn.controller.rest;

import com.kuocai.cdn.exception.BusinessException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SysConfigControllerTest {

    @Test
    void acceptsHttpsSvgWebsiteIconUrl() throws Exception {
        assertEquals("https://cdn.example.com/favicon.svg?v=2",
                SysConfigController.validateWebsiteIconUrl("https://cdn.example.com/favicon.svg?v=2"));
    }

    @Test
    void acceptsSameOriginSvgWebsiteIconPath() throws Exception {
        assertEquals("/images/favicon.svg",
                SysConfigController.validateWebsiteIconUrl("/images/favicon.svg"));
    }

    @Test
    void rejectsUnsafeWebsiteIconUrls() {
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteIconUrl("javascript:alert(1)"));
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteIconUrl("data:image/svg+xml,test"));
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteIconUrl("//cdn.example.com/favicon.svg"));
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteIconUrl("/images/../favicon.svg"));
    }

    @Test
    void acceptsHttpsLogoUrl() throws Exception {
        assertEquals("https://cdn.example.com/logo.png?v=2",
                SysConfigController.validateWebsiteLogoUrl("https://cdn.example.com/logo.png?v=2"));
    }

    @Test
    void acceptsSameOriginLogoPath() throws Exception {
        assertEquals("/image/logo.png",
                SysConfigController.validateWebsiteLogoUrl("/image/logo.png"));
    }

    @Test
    void rejectsUnsafeLogoProtocols() {
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteLogoUrl("javascript:alert(1)"));
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteLogoUrl("data:image/svg+xml,test"));
    }

    @Test
    void rejectsProtocolRelativeAndTraversalPaths() {
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteLogoUrl("//cdn.example.com/logo.png"));
        assertThrows(BusinessException.class,
                () -> SysConfigController.validateWebsiteLogoUrl("/images/../secret.png"));
    }

}
