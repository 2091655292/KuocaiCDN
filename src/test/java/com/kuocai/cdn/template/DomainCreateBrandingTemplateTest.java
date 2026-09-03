package com.kuocai.cdn.template;

import org.junit.jupiter.api.Test;
import org.thymeleaf.context.Context;
import org.thymeleaf.spring5.SpringTemplateEngine;
import org.thymeleaf.templateresolver.StringTemplateResolver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DomainCreateBrandingTemplateTest {

    @Test
    void serviceAreaHintsUseCurrentWebsiteNameWithoutExposingRouteMembers() throws IOException {
        Path templatePath = Paths.get(
                "src/main/resources/templates/admin/domain/domain-create.html");
        String template = new String(Files.readAllBytes(templatePath), StandardCharsets.UTF_8);

        assertTrue(template.contains("currentWebsiteName=${websiteBaseConfig.websiteName}"));
        assertTrue(template.contains("th:title=\"|${currentWebsiteName}境内加速服务|"));
        assertTrue(template.contains("th:title=\"|${currentWebsiteName}境外加速服务|"));
        assertTrue(template.contains("th:title=\"|${currentWebsiteName}全球加速服务|"));
        assertFalse(template.contains("'线路组：' + overseasRouteDescription"));
        assertFalse(template.contains("'线路组：' + globalRouteDescription"));
    }

    @Test
    void websiteNameExpressionRendersBrandedOverseasAccelerationService() {
        StringTemplateResolver resolver = new StringTemplateResolver();
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(resolver);
        String template = "<i "
                + "th:with=\"currentWebsiteName=${websiteBaseConfig.websiteName}\" "
                + "th:title=\"|${currentWebsiteName}境外加速服务|\"></i>";

        Context mainSiteContext = context("萝卜CDN");
        assertTrue(engine.process(template, mainSiteContext)
                .contains("title=\"萝卜CDN境外加速服务\""));
    }

    private Context context(String websiteName) {
        Context context = new Context();
        context.setVariable("websiteBaseConfig",
                Collections.singletonMap("websiteName", websiteName));
        return context;
    }
}
