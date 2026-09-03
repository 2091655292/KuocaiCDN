package com.kuocai.cdn.template;

import org.junit.jupiter.api.Test;
import org.thymeleaf.context.Context;
import org.thymeleaf.spring5.SpringTemplateEngine;
import org.thymeleaf.templateresolver.StringTemplateResolver;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

class SetupTemplateTest {

    @Test
    void setupTemplateContainsAllEightStagesAndApiActions() throws Exception {
        String html = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/setup.html")), StandardCharsets.UTF_8);

        for (int step = 1; step <= 8; step++) {
            assertTrue(html.contains("data-step=\"" + step + "\""));
        }
        assertTrue(html.contains("/api/setup/domain/verify"));
        assertTrue(html.contains("/api/setup/domain/apply"));
        assertTrue(html.contains("/api/setup/module/${name}/test"));
        assertTrue(html.contains("/api/setup/complete"));
        assertFalse(html.contains("授权状态"));
        assertFalse(html.contains("CDN 厂商账号"));
        assertFalse(html.contains("支付宝支付"));
        assertFalse(html.contains("微信支付"));
        assertFalse(html.contains("代理用户域名上限"));
    }

    @Test
    void setupTemplateRendersJavascriptArraysWithoutThymeleafExpressionErrors() throws Exception {
        String html = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/setup.html")), StandardCharsets.UTF_8);
        StringTemplateResolver resolver = new StringTemplateResolver();
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(resolver);

        String rendered = engine.process(html, new Context());

        assertTrue(rendered.contains("const schemas ="));
        assertTrue(rendered.contains("const rows=[ ["));
    }
}
