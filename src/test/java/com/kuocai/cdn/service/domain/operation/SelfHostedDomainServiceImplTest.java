package com.kuocai.cdn.service.domain.operation;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.kuocai.cdn.api.DomainConfig;
import com.kuocai.cdn.api.DomainAdvancedInfo;
import com.kuocai.cdn.api.huawei.cdn.dto.CacheRuleDTO;
import com.kuocai.cdn.api.huawei.cdn.dto.ForceRedirectConfigDTO;
import com.kuocai.cdn.api.tencent.dns.dto.CreateRecordDTO;
import com.kuocai.cdn.entity.CdnDomain;
import com.kuocai.cdn.entity.CdnDomainSources;
import com.kuocai.cdn.entity.SelfHostedDomainConfig;
import com.kuocai.cdn.exception.BusinessException;
import com.kuocai.cdn.service.SelfHostedCdnService;
import com.kuocai.cdn.service.SysUserService;
import com.kuocai.cdn.util.AliyunIcpComplianceProbe;
import com.kuocai.cdn.vo.DomainOriginSettingVo;
import com.kuocai.cdn.vo.CdnDomainSourcesVo;
import com.kuocai.cdn.vo.IgnoreQueryStringDTO;
import com.kuocai.cdn.vo.DomainHttpsSettingVo;
import com.kuocai.cdn.vo.SettingCacheVo;
import com.kuocai.cdn.vo.SettingHigherVo;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;

class SelfHostedDomainServiceImplTest {

    @Test
    void attackProtectionIsValidatedAndSavedWithoutOverwritingAdvancedSettings() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder().id(2L).cdnDomainId(1L)
                .advancedConfigJson("{\"compress\":{\"status\":\"on\"}}").build();
        when(cdnService.getDomainConfig(1L)).thenReturn(config);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(
                cdnService, mock(SysUserService.class));
        SettingHigherVo setting = SettingHigherVo.builder()
                .attackProtection(DomainAdvancedInfo.AttackProtection.builder()
                        .status("on").requestRate(800).burst(1600).maxConnections(240).build())
                .build();

        service.saveAttackProtection(CdnDomain.builder().id(1L).build(), setting);

        JSONObject advanced = JSON.parseObject(config.getAdvancedConfigJson());
        assertEquals("on", advanced.getJSONObject("compress").getString("status"));
        assertEquals("on", advanced.getJSONObject("attackProtection").getString("status"));
        assertEquals(800, advanced.getJSONObject("attackProtection").getIntValue("requestRate"));
        assertEquals(1600, advanced.getJSONObject("attackProtection").getIntValue("burst"));
        assertEquals(240, advanced.getJSONObject("attackProtection").getIntValue("maxConnections"));
        verify(cdnService).updateDomainConfig(config);
    }

    @Test
    void attackProtectionRejectsUnsafeThresholds() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        when(cdnService.getDomainConfig(1L)).thenReturn(
                SelfHostedDomainConfig.builder().cdnDomainId(1L).advancedConfigJson("{}").build());
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(
                cdnService, mock(SysUserService.class));
        SettingHigherVo setting = SettingHigherVo.builder()
                .attackProtection(DomainAdvancedInfo.AttackProtection.builder()
                        .status("on").requestRate(1).burst(2000).maxConnections(300).build())
                .build();

        assertThrows(BusinessException.class, () -> service.saveAttackProtection(
                CdnDomain.builder().id(1L).build(), setting));
        verify(cdnService, never()).updateDomainConfig(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void enablingStillBlockedDomainKeepsItPausedAndReturnsTheIcpMessage() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        CdnDomain domain = CdnDomain.builder().id(1L).domainName("blocked.example.com")
                .route("self_hosted_mainland").domainStatus("offline")
                .failureReason(AliyunIcpComplianceProbe.USER_MESSAGE).build();
        when(cdnService.pauseIfAliyunIcpBlocked(domain)).thenReturn(true);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(
                cdnService, mock(SysUserService.class));

        BusinessException error = assertThrows(BusinessException.class, () -> service.enable(domain));

        assertEquals(AliyunIcpComplianceProbe.USER_MESSAGE, error.getMessage());
        assertEquals("offline", domain.getDomainStatus());
        verify(cdnService, never()).updateDomainConfig(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void customerCnameUsesDnsPlanCompatibleTtl() {
        CreateRecordDTO record = SelfHostedDomainServiceImpl.buildCustomerCnameRecord(
                "cdn.example.com", "kuocaidns.com", "edge.kuocaidns.com");

        assertEquals("kuocaidns.com", record.getDomain());
        assertEquals("edge.kuocaidns.com", record.getValue());
        assertEquals("CNAME", record.getRecordType());
        assertEquals(SelfHostedCdnService.DNS_RECORD_TTL_SECONDS, record.getTTL());
        assertEquals(600L, record.getTTL());
    }

    @Test
    void cacheParameterFilterDoesNotOverwriteExistingCacheRules() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder().id(2L).cdnDomainId(1L)
                .cacheConfigJson("{\"defaultTtl\":3600,\"cacheRules\":[{\"match_type\":\"all\",\"ttl\":60}]}" ).build();
        when(cdnService.getDomainConfig(1L)).thenReturn(config);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(cdnService, mock(SysUserService.class));
        IgnoreQueryStringDTO filter = new IgnoreQueryStringDTO();
        filter.setEnable("on");
        filter.setType("allow");
        filter.setHashKeyArgs("id,token");

        service.saveIgnoreQueryString(CdnDomain.builder().id(1L).build(), filter);

        JSONObject saved = JSON.parseObject(config.getCacheConfigJson());
        assertEquals(3600, saved.getIntValue("defaultTtl"));
        assertEquals(1, saved.getJSONArray("cacheRules").size());
        assertEquals("id,token", saved.getJSONObject("ignoreQueryString").getString("hashKeyArgs"));
        verify(cdnService).updateDomainConfig(config);
    }

    @Test
    void originSwitchDoesNotOverwriteStandbyOrOtherOriginSettings() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder().id(2L).cdnDomainId(1L)
                .originConfigJson("{\"standby\":{\"ipOrDomain\":\"192.0.2.20\"},\"etagStatus\":\"on\"}").build();
        when(cdnService.getDomainConfig(1L)).thenReturn(config);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(cdnService, mock(SysUserService.class));

        service.saveRangeSwitch(CdnDomain.builder().id(1L).build(),
                DomainOriginSettingVo.builder().status("on").build());

        JSONObject saved = JSON.parseObject(config.getOriginConfigJson());
        assertEquals("on", saved.getString("rangeStatus"));
        assertEquals("on", saved.getString("etagStatus"));
        assertNotNull(saved.getJSONObject("standby"));
        assertEquals("192.0.2.20", saved.getJSONObject("standby").getString("ipOrDomain"));
        verify(cdnService).updateDomainConfig(config);
    }

    @Test
    void forceRedirectCanBeExplicitlyDisabled() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder().id(2L).cdnDomainId(1L)
                .forceRedirect("on").httpsConfigJson("{\"redirectCode\":301}").build();
        when(cdnService.getDomainConfig(1L)).thenReturn(config);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(cdnService, mock(SysUserService.class));
        DomainHttpsSettingVo setting = DomainHttpsSettingVo.builder()
                .forceRedirect(ForceRedirectConfigDTO.builder().status("off").build()).build();

        service.forcedToJump(CdnDomain.builder().id(1L).build(), setting, null);

        assertEquals("off", config.getForceRedirect());
        assertEquals("301", JSON.parseObject(config.getHttpsConfigJson()).getString("redirectCode"));
        verify(cdnService).updateDomainConfig(config);
    }

    @Test
    void allFilesCacheRuleIsPersistedWithoutAStaleMatchValue() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder().id(2L).cdnDomainId(1L)
                .cacheConfigJson("{\"defaultTtl\":3600}").build();
        when(cdnService.getDomainConfig(1L)).thenReturn(config);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(cdnService, mock(SysUserService.class));
        SettingCacheVo setting = SettingCacheVo.builder().cacheRules(Collections.singletonList(
                CacheRuleDTO.builder().match_type("all").match_value("/old/path")
                        .ttl(31).ttl_unit("d").follow_origin("off").build())).build();

        service.saveCacheRules(CdnDomain.builder().id(1L).build(), setting);

        JSONObject savedRule = JSON.parseObject(config.getCacheConfigJson())
                .getJSONArray("cacheRules").getJSONObject(0);
        assertEquals("all", savedRule.getString("match_type"));
        assertEquals("", savedRule.getString("match_value"));
        assertEquals(31, savedRule.getIntValue("ttl"));
        assertEquals("d", savedRule.getString("ttl_unit"));
        verify(cdnService).updateDomainConfig(config);
    }

    @Test
    void explicitSelfHostedRouteRejectsMismatchedArea() {
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(
                mock(SelfHostedCdnService.class), mock(SysUserService.class));

        assertThrows(BusinessException.class, () -> service.createForRoute(
                "self_hosted_overseas", 1L, "cdn.example.com", "web", "mainland_china",
                "ipaddr", "192.0.2.10", "http", 80, 443,
                "cdn.example.com", 100));
    }

    @Test
    void sourceUpdateRejectsInvalidMainOriginBeforeSaving() {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(
                cdnService, mock(SysUserService.class));
        CdnDomainSourcesVo sources = CdnDomainSourcesVo.builder()
                .main(CdnDomainSources.builder().originType("ipaddr")
                        .ipOrDomain("225.667.21").build())
                .build();

        assertThrows(BusinessException.class, () -> service.saveSourceStationConfig(
                CdnDomain.builder().id(1L).domainName("cdn.example.com").build(), sources));

        verify(cdnService, never()).updateDomainConfig(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void multiCdnChildReadsConfigurationByParentId() throws Exception {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder()
                .id(2L).cdnDomainId(1L).originType("ipaddr").originAddress("192.0.2.10")
                .originProtocol("http").httpPort(80).httpsPort(443).originHost("cdn.example.com")
                .status("enabled").build();
        when(cdnService.getDomainConfig(1L)).thenReturn(config);
        when(cdnService.isDomainConfigurationApplied(1L)).thenReturn(true);
        SelfHostedDomainServiceImpl service = new SelfHostedDomainServiceImpl(
                cdnService, mock(SysUserService.class));
        CdnDomain child = CdnDomain.builder().id(1L).domainName("cdn.example.com")
                .route("self_hosted_mainland").domainStatus("configuring")
                .businessType("web").serviceArea("mainland_china").build();

        DomainConfig result = service.getDomainConfig(child);

        assertEquals("online", result.getDomainBasicInfo().getDomainStatus());
        assertEquals("mainland_china", result.getDomainBasicInfo().getServiceArea());
    }
}
