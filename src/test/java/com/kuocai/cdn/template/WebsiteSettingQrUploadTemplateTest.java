package com.kuocai.cdn.template;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WebsiteSettingQrUploadTemplateTest {

    @Test
    void qrUploadUsesExplicitChooserPreviewAndPersistedSource() throws Exception {
        String template = read(
                "src/main/resources/templates/admin/settings/website-setting.html");
        String script = read("src/main/resources/static/common/custom_cmo.js");

        assertTrue(template.contains(
                "onclick=\"openWebsiteQrCodeFileChooser('updateWechatQrCodeFile')\""));
        assertTrue(template.contains(
                "onclick=\"openWebsiteQrCodeFileChooser('updateQqGroupQrCodeFile')\""));
        assertTrue(template.contains(
                "handleWebsiteQrCodeFileChange(this, 'wechatQrCodeImg'"));
        assertTrue(template.contains(
                "handleWebsiteQrCodeFileChange(this, 'qqGroupQrCodeImg'"));
        assertTrue(template.contains("data-persisted-src"));
        assertTrue(template.contains("20260727-qr-upload"));
        assertFalse(template.contains("common/images/59872277_1707142593.jpeg"));
        assertFalse(template.contains("common/images/4583752_1709117981.jpeg"));

        assertTrue(script.contains("function openWebsiteQrCodeFileChooser"));
        assertTrue(script.contains("function handleWebsiteQrCodeFileChange"));
        assertTrue(script.contains("const persistedSrc = image.attr(\"data-persisted-src\")"));
        assertTrue(script.contains("file.size > 10 * 1024 * 1024"));
    }

    private String read(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }
}
