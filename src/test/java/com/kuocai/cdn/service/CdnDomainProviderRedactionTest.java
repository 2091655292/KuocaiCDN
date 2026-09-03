package com.kuocai.cdn.service;

import com.alibaba.fastjson.JSONObject;
import com.kuocai.cdn.vo.CdnDomainVo;
import com.kuocai.cdn.util.AliyunIcpComplianceProbe;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CdnDomainProviderRedactionTest {

    @Test
    void userDomainRowsRemoveProviderDetailsAndUseNeutralFailureMessage() {
        CdnDomainVo source = CdnDomainVo.builder()
                .id(1L)
                .domainName("cdn.example.com")
                .domainStatus("configure_failed")
                .failureReason("腾讯云 EdgeOne 配置失败")
                .route("tencent_edgeone")
                .primaryRoute("tencent_edgeone")
                .vendorAccountName("腾讯云主账号")
                .cdnSupplier("tencent")
                .tencentCname("example.eo.dnse.com")
                .tencentDnsId(10L)
                .edgeOneIncluded(true)
                .multiCdn(false)
                .domainId("provider-domain-id")
                .build();

        JSONObject row = CdnDomainService.toUserVisibleDomainRow(source);

        assertFalse(row.containsKey("route"));
        assertFalse(row.containsKey("primaryRoute"));
        assertFalse(row.containsKey("vendorAccountId"));
        assertFalse(row.containsKey("vendorAccountName"));
        assertFalse(row.containsKey("cdnSupplier"));
        assertFalse(row.containsKey("tencentCname"));
        assertFalse(row.containsKey("tencentDnsId"));
        assertFalse(row.containsKey("edgeOneIncluded"));
        assertFalse(row.containsKey("multiCdn"));
        assertFalse(row.containsKey("domainId"));
        assertFalse(row.getBooleanValue("configurationRetryAllowed"));
        assertEquals(CdnDomainService.USER_DOMAIN_CONFIGURATION_FAILURE,
                row.getString("failureReason"));
        assertFalse(row.toJSONString().contains("腾讯云"));
        assertFalse(row.toJSONString().contains("tencent"));
    }

    @Test
    void userCanRetryFailedConfigurationWithoutReceivingItsRoute() {
        CdnDomainVo source = CdnDomainVo.builder()
                .id(9007199254740993L)
                .userId(9007199254740995L)
                .domainStatus("configure_failed")
                .route("self_hosted_mainland")
                .build();

        JSONObject row = CdnDomainService.toUserVisibleDomainRow(source);

        assertTrue(row.getBooleanValue("configurationRetryAllowed"));
        assertEquals("9007199254740993", row.getString("id"));
        assertEquals("9007199254740995", row.getString("userId"));
        assertTrue(row.get("id") instanceof String);
        assertTrue(row.get("userId") instanceof String);
        assertFalse(row.containsKey("route"));
        assertFalse(row.toJSONString().contains("self_hosted"));
    }

    @Test
    void userReceivesTheActionableAlibabaIcpMessageWithoutRouteMetadata() {
        CdnDomainVo source = CdnDomainVo.builder()
                .id(3L)
                .domainStatus("offline")
                .failureReason(AliyunIcpComplianceProbe.USER_MESSAGE)
                .route("self_hosted_mainland")
                .build();

        JSONObject row = CdnDomainService.toUserVisibleDomainRow(source);

        assertTrue(row.getBooleanValue("filingBlocked"));
        assertEquals(AliyunIcpComplianceProbe.USER_MESSAGE, row.getString("failureReason"));
        assertFalse(row.containsKey("route"));
    }
}
