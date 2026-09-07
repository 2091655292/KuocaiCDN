package com.kuocai.cdn.service;

import com.alibaba.fastjson.JSONObject;
import com.kuocai.cdn.vo.CdnDomainVo;
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

    }
