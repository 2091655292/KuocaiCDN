package com.kuocai.cdn.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AliyunIcpComplianceProbeTest {

    @Test
    void recognizesTheCanonicalAlibabaIcpInterceptionPage() {
        String page = "<title>Non-compliance ICP Filing</title>"
                + "<iframe src=\"http://www.aliyun.com/beian/beian-block?id=123\"></iframe>";

        assertTrue(AliyunIcpComplianceProbe.matches(403, "Beaver", page));
    }

    @Test
    void recognizesTheLocalizedAlibabaIcpInterceptionPage() {
        String page = "域名暂时无法访问，该域名当前备案状态不符合访问要求，aliyun";

        assertTrue(AliyunIcpComplianceProbe.matches(403, "Beaver", page));
    }

    @Test
    void doesNotTreatOrdinaryForbiddenResponsesAsIcpFailures() {
        assertFalse(AliyunIcpComplianceProbe.matches(403, "nginx", "403 Forbidden"));
        assertFalse(AliyunIcpComplianceProbe.matches(
                200, "Beaver", "Non-compliance ICP Filing aliyun.com/beian/beian-block"));
    }

    @Test
    void probesThePublicAccelerationHostAndSkipsWildcardNames() {
        assertEquals("kccdn.emmn.cn",
                AliyunIcpComplianceProbe.normalizeProbeHost("KCCDN.EMMN.CN."));
        assertNull(AliyunIcpComplianceProbe.normalizeProbeHost("*.emmn.cn"));
        assertNull(AliyunIcpComplianceProbe.normalizeProbeHost("https://kccdn.emmn.cn"));
    }
}
