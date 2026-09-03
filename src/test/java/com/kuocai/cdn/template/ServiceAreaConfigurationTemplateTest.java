package com.kuocai.cdn.template;

import com.kuocai.cdn.service.CdnServiceAreaPolicyService;
import com.kuocai.cdn.vo.CdnServiceAreaOptionVo;
import org.junit.jupiter.api.Test;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;
import org.thymeleaf.spring5.SpringTemplateEngine;
import org.thymeleaf.templateresolver.StringTemplateResolver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServiceAreaConfigurationTemplateTest {

    @Test
    void websiteSettingsContainsRouteAreaMatrix() throws IOException {
        String template = read("src/main/resources/templates/admin/settings/website-setting.html");

        assertTrue(template.contains("overseasEnabledTarget"));
        assertTrue(template.contains("globalEnabledTarget"));
        assertFalse(template.contains("平台账号标识"));
        assertTrue(template.contains("${serviceAreaOptions}"));
        assertTrue(template.contains("option.fixedArea == 'outside_mainland_china'"));
        assertTrue(template.contains("option.fixedArea == 'global'"));
        assertTrue(template.contains("加速区域线路"));
    }

    @Test
    void domainCreateUsesGlobalRouteAreaFlags() throws IOException {
        String template = read("src/main/resources/templates/admin/domain/domain-create.html");

        assertTrue(template.contains("${allowOverseas}"));
        assertTrue(template.contains("${allowGlobal}"));
        assertFalse(template.contains("${enableOverseas"));
        assertFalse(template.contains("${enableGlobal"));
    }

    @Test
    void websiteSettingsExposeAvatarAndAdminPathWithoutMonthlyBenefit() throws IOException {
        String template = read("src/main/resources/templates/admin/settings/website-setting.html");

        assertTrue(template.contains("id=\"updateDefaultAvatarFile\""));
        assertTrue(template.contains("id=\"adminPath\""));
        assertFalse(template.contains("monthlyBenefitSetting"));
        assertFalse(template.contains("每月福利赠送流量（GB）"));
    }

    @Test
    void websiteSettingsSupportWebsiteIconUrlAndSvgUpload() throws IOException {
        String template = read("src/main/resources/templates/admin/settings/website-setting.html");
        String script = read("src/main/resources/static/common/custom_cmo.js");

        assertTrue(template.contains("id=\"websiteIconUrl\""));
        assertTrue(template.contains("favicon.svg"));
        assertTrue(template.contains("onclick=\"previewWebsiteIconUrl()\""));
        assertTrue(template.contains("onclick=\"clearWebsiteIcon()\""));
        assertTrue(template.contains("\".svg\""));
        assertTrue(script.contains("function appendWebsiteIconFormData"));
        assertTrue(script.contains("function handleWebsiteIconFileChange"));
        assertTrue(script.contains("function handleWebsiteIconUrlInput"));
        assertTrue(script.contains("function previewWebsiteIconUrl"));
        assertTrue(script.contains("function clearWebsiteIcon"));
    }

    @Test
    void websiteSettingsSaveAlwaysShowsProgressAndKeepsFailureVisible() throws IOException {
        String template = read("src/main/resources/templates/admin/settings/website-setting.html");
        String script = read("src/main/resources/static/common/custom_cmo.js");
        String uploadScript = read("src/main/resources/static/common/custom.js");
        String saveFunction = between(script, "async function saveWebsiteBaseConfig() {",
                "function appendWebsiteLogoFormData");

        assertTrue(template.contains("id=\"saveWebsiteBaseConfigButton\""));
        assertTrue(saveFunction.contains("正在保存"));
        assertTrue(saveFunction.contains("data && data.code === 'SUCCESS'"));
        assertFalse(saveFunction.contains("setTimeout(reload, 1000)"));
        assertTrue(uploadScript.contains("resolve({"));
        assertTrue(uploadScript.contains("请求超时，请检查服务器状态后重试"));
    }

    @Test
    void selfHostedNodeSettingsExposeDetectedDiskAndLowFrequencyCleanup() throws IOException {
        String template = read("src/main/resources/templates/admin/settings/self-hosted-node.html");

        assertTrue(template.contains("id=\"nodeCacheDisk\""));
        assertTrue(template.contains("id=\"nodeCacheMaxSizeGb\""));
        assertTrue(template.contains("id=\"nodeCacheCleanupAgeDays\""));
        assertTrue(template.contains("id=\"nodeCacheCleanupMinHits\""));
        assertTrue(template.contains("detectedDisks"));
        assertTrue(template.contains("cacheDiskMount"));
        assertTrue(template.contains("portForwardWarning"));
        assertTrue(template.contains("CDN 服务正常"));

        String portForwardTemplate = read(
                "src/main/resources/templates/admin/domain/self-hosted-port-forward.html");
        assertTrue(portForwardTemplate.contains("function ruleStatus"));
        assertTrue(portForwardTemplate.contains("部分节点"));
        assertTrue(portForwardTemplate.contains("deploymentReadyNodes"));
    }

    @Test
    void dashboardUsesConfiguredAdminPathForSessionExit() throws IOException {
        String dashboard = read("src/main/resources/templates/common/common-dashboard.html");
        String commonJs = read("src/main/resources/static/common/custom_ceo.js");

        assertTrue(dashboard.contains("window.kuocaiAdminPath"));
        assertTrue(dashboard.contains("websiteBaseConfig.adminPath"));
        assertTrue(commonJs.contains("window.kuocaiAdminPath || 'kuocaiadmin'"));
        assertTrue(commonJs.contains("window.kuocaiLoginRole === 'admin'"));
    }

    @Test
    void dashboardOmitsMonthlyBenefit() throws IOException {
        String dashboard = read("src/main/resources/templates/common/common-dashboard.html");

        assertFalse(dashboard.contains("websiteBaseConfig.monthGiftGb > 0"));
        assertFalse(dashboard.contains("claimMonthlyFreePackage"));
    }

    @Test
    void vendorAndSelfHostedRowsRenderWithoutAccountIdentifiers() throws IOException {
        String template = read("src/main/resources/templates/admin/settings/website-setting.html");
        String row = between(template,
                "<tr th:each=\"option : ${serviceAreaOptions}\">", "</tr>") + "</tr>";
        Context context = new Context();
        context.setVariable("serviceAreaOptions", Arrays.asList(
                CdnServiceAreaOptionVo.builder()
                        .targetKey("route:tencent_edgeone")
                        .routeName("腾讯云 EdgeOne")
                        .selectable(true)
                        .overseasEnabled(true)
                        .globalEnabled(false)
                        .build(),
                CdnServiceAreaOptionVo.builder()
                        .targetKey("route:self_hosted_overseas")
                        .routeName("海外自建 CDN")
                        .selectable(true)
                        .fixedArea(CdnServiceAreaPolicyService.OVERSEAS)
                        .overseasEnabled(true)
                        .globalEnabled(false)
                        .build()));

        String rendered = templateEngine().process(row, context);

        assertTrue(rendered.contains("腾讯云 EdgeOne"));
        assertTrue(rendered.contains("海外自建 CDN"));
        assertFalse(rendered.contains("ID 101"));
    }

    @Test
    void userProductConfigurationNoLongerContainsLegacyAreaSwitches() throws IOException {
        String template = read("src/main/resources/templates/admin/product/user-price-list.html");

        assertFalse(template.contains("name=\"enableOverseas\""));
        assertFalse(template.contains("name=\"enableGlobal\""));
        assertFalse(template.contains("row.user.enableOverseas"));
        assertFalse(template.contains("row.user.enableGlobal"));
        String columns = between(template, "columns: [", "columnDefs:");
        String headers = between(template, "<thead class=\"thead-light\">", "</thead>");
        assertEquals(11, count(columns, Pattern.compile("\\bdata\\s*:")));
        assertEquals(11, count(headers, Pattern.compile("<th(?:\\s|>)")));
    }

    @Test
    void userDomainListDoesNotExposeProviderOrRouteDetails() throws IOException {
        String template = read("src/main/resources/templates/user/domain/domain-list.html");
        String columns = between(template, "columns: [", "columnDefs:");
        String headers = between(template, "<thead class=\"thead-light\">", "</thead>");

        assertFalse(template.contains("<th>厂商</th>"));
        assertFalse(template.contains("routeDisplayName"));
        assertFalse(template.contains("{data: 'route'"));
        assertFalse(template.contains("row.route"));
        assertFalse(template.contains("腾讯云 EdgeOne"));
        assertFalse(template.contains("自建 CDN"));
        assertTrue(template.contains("row.configurationRetryAllowed === true"));
        assertTrue(template.contains("20260725-provider-redaction"));
        assertEquals(8, count(columns, Pattern.compile("\\bdata\\s*:")));
        assertEquals(8, count(headers, Pattern.compile("<th(?:\\s|>)")));
    }

    @Test
    void userFacingDomainPagesUseProviderNeutralLabels() throws IOException {
        String create = read("src/main/resources/templates/admin/domain/domain-create.html");
        String access = read("src/main/resources/templates/admin/domain/domain-setting-access.html");
        String origin = read("src/main/resources/templates/admin/domain/domain-setting-origin.html");
        String script = read("src/main/resources/static/common/custom_ceo.js");

        assertFalse(create.contains("EdgeOne根域名额度"));
        assertFalse(create.contains("加速区域线路"));
        assertFalse(create.contains("配置线路组"));
        assertFalse(create.contains("<th scope=\"col\">厂商账号</th>"));
        assertTrue(create.contains("loginUserRoleCode == 'admin'"));
        assertFalse(create.contains("加速域名额度"));
        assertFalse(access.contains("EdgeOne 安全防护策略"));
        assertFalse(access.contains("对接腾讯云 EdgeOne"));
        assertFalse(origin.contains("开启后，EdgeOne 回源"));
        assertTrue(script.contains("正在向加速平台提交配置"));
        assertFalse(script.contains("购买加速域名额度"));
    }

    private String read(String path) throws IOException {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }

    private String between(String value, String start, String end) {
        int from = value.indexOf(start);
        int to = value.indexOf(end, from + start.length());
        return value.substring(from, to);
    }

    private int count(String value, Pattern pattern) {
        int total = 0;
        Matcher matcher = pattern.matcher(value);
        while (matcher.find()) {
            total++;
        }
        return total;
    }

    private TemplateEngine templateEngine() {
        TemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(new StringTemplateResolver());
        return engine;
    }
}
