package com.kuocai.cdn.deployment;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertFalse;

class OpenSourceBoundaryTest {

    @Test
    void cleanInstallDoesNotCreateCommercialFeatureTables() throws Exception {
        String sql = read("deploy/sql/KuocaiCDN-empty-install.sql").toLowerCase();
        for (String table : Arrays.asList(
                "agent_config", "agent_level", "bonus_record", "flow_package",
                "purchased_flow", "flow_donate", "withdraw_record", "cdn_vendor_account",
                "sys_user_vendor_account", "edgeone_domain_quota_order")) {
            assertFalse(sql.contains("create table `" + table + "`"), table);
        }
    }

    @Test
    void runtimeAndSettingsDoNotExposePaymentOrTrafficPackageControls() throws Exception {
        String runtime = read("src/main/resources/application-dev.properties")
                + read("src/main/resources/application-prod.properties")
                + read("src/main/java/com/kuocai/cdn/component/PreloadComponent.java");
        String settings = read("src/main/resources/templates/admin/settings/website-setting.html")
                + read("src/main/resources/templates/admin/settings/email-setting.html")
                + read("src/main/resources/templates/admin/settings/sms-setting.html");

        assertFalse(runtime.contains("loadPayConfig"));
        assertFalse(runtime.contains("PAY_REFUND_ENABLE"));
        assertFalse(runtime.contains("ALIPAY_LIMIT_MONEY"));
        assertFalse(settings.contains("inviteRewardGb"));
        assertFalse(settings.contains("invitedRewardGb"));
        assertFalse(settings.contains("用于套餐"));
    }

    @Test
    void vendorClientDoesNotContainEmbeddedAccessCredentials() throws Exception {
        String source = read("src/main/java/com/kuocai/cdn/api/cdnetworks/cdn/CdnetworksClient.java");
        assertFalse(source.matches("(?s).*AccessKey\\s*=\\s*\"[A-Za-z0-9]{20,}\".*"));
        assertFalse(source.matches("(?s).*SecretKey\\s*=\\s*\"[A-Za-z0-9]{20,}\".*"));
    }

    private String read(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }
}
