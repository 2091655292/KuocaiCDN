package com.kuocai.cdn.service;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kuocai.cdn.dto.SelfHostedNodeSaveRequest;
import com.kuocai.cdn.dto.SelfHostedApplyResultRequest;
import com.kuocai.cdn.dto.SelfHostedHeartbeatRequest;
import com.kuocai.cdn.dto.SelfHostedDiskInfo;
import com.kuocai.cdn.dao.CdnDomainDao;
import com.kuocai.cdn.dao.SelfHostedCacheJobDao;
import com.kuocai.cdn.dao.SelfHostedCacheJobNodeDao;
import com.kuocai.cdn.dao.SelfHostedDomainConfigDao;
import com.kuocai.cdn.dao.SelfHostedGroupNodeDao;
import com.kuocai.cdn.dao.SelfHostedNodeDao;
import com.kuocai.cdn.dao.SelfHostedNodeGroupDao;
import com.kuocai.cdn.dao.SelfHostedPortForwardDao;
import com.kuocai.cdn.entity.SelfHostedNode;
import com.kuocai.cdn.entity.SelfHostedGroupNode;
import com.kuocai.cdn.entity.SelfHostedDomainConfig;
import com.kuocai.cdn.entity.SelfHostedNodeGroup;
import com.kuocai.cdn.entity.SelfHostedPortForward;
import com.kuocai.cdn.entity.CdnDomain;
import com.kuocai.cdn.enumeration.domainmerage.CdnRoute;
import com.kuocai.cdn.enumeration.domainmerage.route.CdnCacheSettingRoute;
import com.kuocai.cdn.enumeration.domainmerage.route.CdnOperationRoute;
import com.kuocai.cdn.enumeration.domainmerage.route.CdnStatisticsRoute;
import com.kuocai.cdn.util.AliyunIcpComplianceProbe;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.Arrays;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

class SelfHostedCdnRouteTest {

    @Test
    void currentSharedCacheWriterWakesFollowersAfterApplyingConfiguration() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.emptyList());
        SelfHostedNode writer = SelfHostedNode.builder().id(6L).status("online").enabled(1)
                .cacheStorageKey("chengdu-kuocai").cacheStorageWriter(1)
                .desiredConfigVersion(9L).appliedConfigVersion(8L).build();
        SelfHostedNode follower = SelfHostedNode.builder().id(9L).status("online").enabled(1)
                .cacheStorageKey("chengdu-kuocai")
                .desiredConfigVersion(9L).appliedConfigVersion(9L).build();
        when(nodeDao.selectList(any())).thenReturn(Arrays.asList(writer, follower));
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), groupNodeDao,
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
        SelfHostedApplyResultRequest request = new SelfHostedApplyResultRequest();
        request.setVersion(9L);
        request.setSuccess(true);

        service.applyResult(writer, request);

        assertTrue(follower.getDesiredConfigVersion() > 9L);
        verify(nodeDao).updateById(follower);
    }

    @Test
    void successfulApplyWithQuarantinedDomainAdvancesVersionAndKeepsWarning() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), mock(SelfHostedGroupNodeDao.class),
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
        SelfHostedNode node = SelfHostedNode.builder().id(7L).status("online")
                .desiredConfigVersion(9L).appliedConfigVersion(8L).enabled(1).build();
        SelfHostedApplyResultRequest request = new SelfHostedApplyResultRequest();
        request.setVersion(9L);
        request.setSuccess(true);
        request.setError("domain broken.example was quarantined");

        service.applyResult(node, request);

        assertEquals(9L, node.getAppliedConfigVersion());
        assertEquals("degraded", node.getStatus());
        assertEquals("domain broken.example was quarantined", node.getLastError());
        verify(nodeDao).update(any(), any());
    }

    @Test
    void selfHostedRouteIsRegisteredAcrossAllCapabilities() {
        String route = CdnRoute.SELF_HOSTED.getCode();
        assertEquals("self_hosted", route);
        assertEquals(route, CdnOperationRoute.convert(route).getRoute());
        assertEquals(route, CdnCacheSettingRoute.convert(route).getRoute());
        assertEquals(route, CdnStatisticsRoute.convert(route).getRoute());
    }

    @Test
    void selfHostedProductRoutesMapToIndependentAreasAndCapabilities() {
        assertSelfHostedProductRoute(CdnRoute.SELF_HOSTED_MAINLAND.getCode(),
                "mainland", "mainland_china", "国内自建 CDN");
        assertSelfHostedProductRoute(CdnRoute.SELF_HOSTED_OVERSEAS.getCode(),
                "overseas", "outside_mainland_china", "海外自建 CDN");
        assertSelfHostedProductRoute(CdnRoute.SELF_HOSTED_GLOBAL.getCode(),
                "global", "global", "全球自建 CDN");
        assertTrue(CdnRoute.isSelfHosted(CdnRoute.SELF_HOSTED.getCode()));
        assertEquals(CdnRoute.SELF_HOSTED_OVERSEAS.getCode(),
                CdnRoute.selfHostedRouteForServiceArea("outside_mainland_china"));
        assertEquals(CdnRoute.SELF_HOSTED_OVERSEAS.getCode(),
                CdnRoute.selfHostedRouteForCoverage("overseas"));
        assertEquals(CdnRoute.SELF_HOSTED_OVERSEAS.getCode(),
                CdnRoute.resolveSelfHostedCreateRoute(
                        CdnRoute.SELF_HOSTED.getCode(), "outside_mainland_china"));
        assertEquals(CdnRoute.SELF_HOSTED_MAINLAND.getCode(),
                CdnRoute.resolveSelfHostedCreateRoute(
                        CdnRoute.SELF_HOSTED_MAINLAND.getCode(), "outside_mainland_china"));
    }

    @Test
    void cacheControllerDispatchesSelfHostedPreheatAndRefreshTasks() throws Exception {
        String source = new String(Files.readAllBytes(Paths.get(
                "src/main/java/com/kuocai/cdn/controller/rest/CdnDomainCacheController.java")),
                StandardCharsets.UTF_8);
        assertTrue(source.contains("selfHostedUrlList.add(url)"));
        assertTrue(source.contains("CACHE_PREHEATING_KEY, selfHostedUrlList"));
        assertTrue(source.contains("fileType, selfHostedUrlList"));
        assertTrue(source.contains("CdnRoute.SELF_HOSTED.getCode()"));
    }

    @Test
    void sshPasswordCanBeAcceptedButIsNeverSerializedIntoLogs() throws Exception {
        SelfHostedNodeSaveRequest request = new ObjectMapper().readValue(
                "{\"nodeName\":\"edge-1\",\"sshPassword\":\"secret-value\"}",
                SelfHostedNodeSaveRequest.class);
        assertEquals("secret-value", request.getSshPassword());
        assertFalse(JSON.toJSONString(request).contains("secret-value"));
        assertFalse(new ObjectMapper().writeValueAsString(request).contains("secret-value"));
    }

    @Test
    void reinstallAcceptsOneTimePasswordWithoutOperationLogSerialization() throws Exception {
        String controller = new String(Files.readAllBytes(Paths.get(
                "src/main/java/com/kuocai/cdn/controller/rest/SelfHostedNodeController.java")),
                StandardCharsets.UTF_8);
        String template = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/settings/self-hosted-node.html")),
                StandardCharsets.UTF_8);
        int installEndpoint = controller.indexOf("@PostMapping(\"install\")");
        int nextMethod = controller.indexOf("private String controlPlaneUrl", installEndpoint);
        String installBlock = controller.substring(installEndpoint, nextMethod);

        assertFalse(installBlock.contains("@SysLog"));
        assertTrue(installBlock.contains("request.getParameter(\"sshPassword\")"));
        assertTrue(template.contains("密码仅用于本次重装，不会保存"));
        assertTrue(template.contains("values.sshPassword=transientPassword"));
    }

    @Test
    void nodeListNeverExposesEncryptedPasswordOrAgentTokenHash() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedNodeGroupDao groupDao = mock(SelfHostedNodeGroupDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        when(nodeDao.selectList(any())).thenReturn(Collections.singletonList(SelfHostedNode.builder()
                .id(1L).nodeName("edge-1").host("192.0.2.10").sshPort(22)
                .sshPasswordCipher("encrypted-password").agentTokenHash("token-hash")
                .enabled(1).status("pending").build()));
        when(groupNodeDao.selectList(any())).thenReturn(java.util.Arrays.asList(
                SelfHostedGroupNode.builder().groupId(11L).nodeId(1L).build(),
                SelfHostedGroupNode.builder().groupId(12L).nodeId(1L).build()));
        when(groupDao.selectById(11L)).thenReturn(SelfHostedNodeGroup.builder()
                .id(11L).groupName("海外节点组").coverage("overseas").build());
        when(groupDao.selectById(12L)).thenReturn(SelfHostedNodeGroup.builder()
                .id(12L).groupName("全球节点组").coverage("global").build());

        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                groupDao, groupNodeDao,
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));

        String json = service.listNodeViews().get(0).toJSONString();
        assertFalse(json.contains("encrypted-password"));
        assertFalse(json.contains("token-hash"));
        assertFalse(json.contains("sshPasswordCipher"));
        assertFalse(json.contains("agentTokenHash"));
        assertTrue(json.contains("海外节点组、全球节点组"));
        assertTrue(json.contains("\"groupIds\":[11,12]"));
    }

    @Test
    void agentConfigNeverIncludesEncryptedCertificateColumns() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedDomainConfig.builder().id(3L).cdnDomainId(4L).nodeGroupId(2L)
                        .originType("ipaddr").originAddress("192.0.2.10")
                        .originConfigJson("{}")
                        .certificateCipher("certificate-ciphertext")
                        .privateKeyCipher("private-key-ciphertext")
                        .accessConfigCipher("access-config-ciphertext").status("enabled").build()));
        when(domainDao.selectById(4L)).thenReturn(CdnDomain.builder().id(4L).domainName("cdn.example.com")
                .route(CdnRoute.SELF_HOSTED_OVERSEAS.getCode()).domainStatus("online").build());
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class), domainDao,
                mock(SelfHostedPortForwardDao.class));

        String json = service.desiredConfig(SelfHostedNode.builder().id(1L).desiredConfigVersion(5L).build()).toJSONString();
        assertFalse(json.contains("certificate-ciphertext"));
        assertFalse(json.contains("private-key-ciphertext"));
        assertFalse(json.contains("certificateCipher"));
        assertFalse(json.contains("privateKeyCipher"));
        assertFalse(json.contains("access-config-ciphertext"));
        assertFalse(json.contains("accessConfigCipher"));
        assertTrue(json.contains("accessConfigJson"));
    }

    @Test
    void invalidHistoricalOriginIsQuarantinedWithoutEnteringNodeConfig() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        SelfHostedDomainConfig invalid = SelfHostedDomainConfig.builder()
                .id(3L).cdnDomainId(4L).nodeGroupId(2L).originType("ipaddr")
                .originAddress("225.667.21").originConfigJson("{}").status("enabled").build();
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(Collections.singletonList(invalid));
        CdnDomain domain = CdnDomain.builder().id(4L).domainName("cdn.example.com")
                .route(CdnRoute.SELF_HOSTED_OVERSEAS.getCode()).domainStatus("online").build();
        when(domainDao.selectById(4L)).thenReturn(domain);
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class), domainDao,
                mock(SelfHostedPortForwardDao.class));

        String json = service.desiredConfig(
                SelfHostedNode.builder().id(1L).desiredConfigVersion(5L).build()).toJSONString();

        assertTrue(json.contains("\"domains\":[]"));
        assertEquals("configure_failed", domain.getDomainStatus());
        verify(domainConfigDao).update(any(), any());
        verify(domainDao).updateById(domain);
    }

    @Test
    void aliyunIcpBlockedDomainReceivesOnlyTheStatic451Configuration() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedDomainConfig.builder().id(3L).cdnDomainId(4L).nodeGroupId(2L)
                        .status("icp_blocked").httpsEnabled(0).ipv6Enabled(0).build()));
        when(domainDao.selectById(4L)).thenReturn(CdnDomain.builder().id(4L)
                .domainName("blocked.example.com").route(CdnRoute.SELF_HOSTED_MAINLAND.getCode())
                .domainStatus("offline").build());
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class), domainDao,
                mock(SelfHostedPortForwardDao.class));

        String json = service.desiredConfig(
                SelfHostedNode.builder().id(1L).desiredConfigVersion(5L).build()).toJSONString();

        assertTrue(json.contains("\"domainName\":\"blocked.example.com\""));
        assertTrue(json.contains("\"icpBlocked\":true"));
        assertFalse(json.contains("originAddress"));
    }

    @Test
    void aliyunIcpBlockPausesOnlyTheMatchedDomainConfiguration() {
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.emptyList());
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class), domainDao,
                mock(SelfHostedPortForwardDao.class));
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder().id(3L).cdnDomainId(4L)
                .nodeGroupId(2L).status("enabled").desiredConfigVersion(7L).build();
        CdnDomain domain = CdnDomain.builder().id(4L).domainName("blocked.example.com")
                .route(CdnRoute.SELF_HOSTED_MAINLAND.getCode()).domainStatus("online").build();

        service.markAliyunIcpBlocked(domain, config);

        assertEquals("icp_blocked", config.getStatus());
        assertEquals(8L, config.getDesiredConfigVersion());
        assertEquals(AliyunIcpComplianceProbe.USER_MESSAGE, config.getLastError());
        assertEquals("offline", domain.getDomainStatus());
        assertEquals(AliyunIcpComplianceProbe.USER_MESSAGE, domain.getFailureReason());
        verify(domainConfigDao).updateById(config);
        verify(domainDao).updateById(domain);
    }

    @Test
    void wildcardDomainUsesLegacyCompatibleNginxNameWithoutBlockingOtherDomains() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        SelfHostedDomainConfig wildcardConfig = SelfHostedDomainConfig.builder()
                .id(3L).cdnDomainId(4L).nodeGroupId(2L).originType("ipaddr")
                .originAddress("192.0.2.10").originHost("*.example.com")
                .originConfigJson("{}").status("enabled").build();
        SelfHostedDomainConfig regularConfig = SelfHostedDomainConfig.builder()
                .id(5L).cdnDomainId(6L).nodeGroupId(2L).originType("ipaddr")
                .originAddress("192.0.2.11").originHost("cdn.example.net")
                .originConfigJson("{}").status("enabled").build();
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(java.util.Arrays.asList(wildcardConfig, regularConfig));
        when(domainDao.selectById(4L)).thenReturn(CdnDomain.builder().id(4L).domainName("*.Example.COM")
                .route(CdnRoute.SELF_HOSTED_OVERSEAS.getCode()).domainStatus("online").build());
        when(domainDao.selectById(6L)).thenReturn(CdnDomain.builder().id(6L).domainName("cdn.example.net")
                .route(CdnRoute.SELF_HOSTED_OVERSEAS.getCode()).domainStatus("online").build());
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class), domainDao,
                mock(SelfHostedPortForwardDao.class));

        String json = service.desiredConfig(
                SelfHostedNode.builder().id(1L).desiredConfigVersion(5L).build()).toJSONString();

        assertTrue(json.contains("\"domainName\":\".example.com\""));
        assertTrue(json.contains("\"originHost\":\"example.com\""));
        assertTrue(json.contains("\"domainName\":\"cdn.example.net\""));
        verify(domainConfigDao, never()).update(any(), any());
    }

    @Test
    void invalidHistoricalDomainIsQuarantinedWithoutBlockingValidDomain() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        SelfHostedDomainConfig invalidConfig = SelfHostedDomainConfig.builder()
                .id(3L).cdnDomainId(4L).nodeGroupId(2L).originType("ipaddr")
                .originAddress("192.0.2.10").originConfigJson("{}").status("enabled").build();
        SelfHostedDomainConfig validConfig = SelfHostedDomainConfig.builder()
                .id(5L).cdnDomainId(6L).nodeGroupId(2L).originType("ipaddr")
                .originAddress("192.0.2.11").originConfigJson("{}").status("enabled").build();
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(java.util.Arrays.asList(invalidConfig, validConfig));
        CdnDomain invalidDomain = CdnDomain.builder().id(4L).domainName("https://bad.example.com/path")
                .route(CdnRoute.SELF_HOSTED_OVERSEAS.getCode()).domainStatus("online").build();
        when(domainDao.selectById(4L)).thenReturn(invalidDomain);
        when(domainDao.selectById(6L)).thenReturn(CdnDomain.builder().id(6L).domainName("cdn.example.net")
                .route(CdnRoute.SELF_HOSTED_OVERSEAS.getCode()).domainStatus("online").build());
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class), domainDao,
                mock(SelfHostedPortForwardDao.class));

        String json = service.desiredConfig(
                SelfHostedNode.builder().id(1L).desiredConfigVersion(5L).build()).toJSONString();

        assertFalse(json.contains("https://bad.example.com/path"));
        assertTrue(json.contains("\"domainName\":\"cdn.example.net\""));
        assertEquals("configure_failed", invalidDomain.getDomainStatus());
        verify(domainConfigDao).update(any(), any());
        verify(domainDao).updateById(invalidDomain);
    }

    @Test
    void enablingHttpsWithoutNewPemKeepsTheStoredCertificate() throws Exception {
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.emptyList());
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
        SelfHostedDomainConfig config = SelfHostedDomainConfig.builder().id(3L).nodeGroupId(2L)
                .certificateCipher("stored-certificate").privateKeyCipher("stored-private-key")
                .httpsEnabled(1).desiredConfigVersion(1L).build();

        service.saveCertificate(config, true, "", "", "off");

        assertEquals("stored-certificate", config.getCertificateCipher());
        assertEquals("stored-private-key", config.getPrivateKeyCipher());
    }

    @Test
    void heartbeatDoesNotDispatchCacheJobsBeforeLatestConfigIsApplied() {
        SelfHostedCacheJobNodeDao cacheJobNodeDao = mock(SelfHostedCacheJobNodeDao.class);
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), mock(SelfHostedGroupNodeDao.class),
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                cacheJobNodeDao, mock(CdnDomainDao.class), mock(SelfHostedPortForwardDao.class));
        SelfHostedNode node = SelfHostedNode.builder().id(1L).desiredConfigVersion(8L)
                .appliedConfigVersion(7L).enabled(1).build();
        SelfHostedHeartbeatRequest request = new SelfHostedHeartbeatRequest();
        request.setAppliedConfigVersion(7L);

        String json = service.heartbeat(node, request).toJSONString();

        assertTrue(json.contains("\"configChanged\":true"));
        assertTrue(json.contains("\"cacheJobs\":[]"));
        verify(cacheJobNodeDao, never()).selectList(any());
    }

    @Test
    void streamModuleFailureKeepsCdnOnlineAndSkipsOnlyPortForwardRules() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedPortForwardDao portForwardDao = mock(SelfHostedPortForwardDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(portForwardDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedPortForward.builder().id(9L).nodeGroupId(2L).status("enabled")
                        .protocol("tcp").listenPort(18089).originHost("192.0.2.10").originPort(8080).build()));
        when(portForwardDao.selectCount(any())).thenReturn(1L);
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, mock(SelfHostedDomainConfigDao.class),
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                mock(CdnDomainDao.class), portForwardDao);
        String warning = "当前 Nginx 的 stream 模块未加载，请安装 nginx-mod-stream 后重试";
        SelfHostedNode node = SelfHostedNode.builder().id(1L).status("degraded").agentVersion("1.4.0")
                .desiredConfigVersion(8L).appliedConfigVersion(7L).lastError(warning).build();
        SelfHostedHeartbeatRequest heartbeat = new SelfHostedHeartbeatRequest();
        heartbeat.setAppliedConfigVersion(7L);

        service.heartbeat(node, heartbeat);
        String config = service.desiredConfig(node).toJSONString();

        assertEquals("online", node.getStatus());
        assertEquals(warning, node.getLastError());
        assertTrue(config.contains("\"portForwards\":[]"));
        assertTrue(config.contains("\"portForwardWarning\""));

        com.kuocai.cdn.dto.SelfHostedApplyResultRequest result =
                new com.kuocai.cdn.dto.SelfHostedApplyResultRequest();
        result.setVersion(8L);
        result.setSuccess(true);
        service.applyResult(node, result);
        assertEquals("online", node.getStatus());
        assertEquals(warning, node.getLastError());
    }

    @Test
    void upgradedAgentClearsStaleStreamWarningAndRetriesPortForwardRules() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedPortForwardDao portForwardDao = mock(SelfHostedPortForwardDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(portForwardDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedPortForward.builder().id(9L).nodeGroupId(2L).status("enabled")
                        .protocol("tcp").listenPort(18089).originHost("192.0.2.10").originPort(8080).build()));
        when(portForwardDao.selectCount(any())).thenReturn(1L);
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, mock(SelfHostedDomainConfigDao.class),
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                mock(CdnDomainDao.class), portForwardDao);
        String warning = "当前 Nginx 的 stream 模块未加载，请安装 nginx-mod-stream 后重试";
        SelfHostedNode node = SelfHostedNode.builder().id(1L).status("online").agentVersion("1.5.11")
                .desiredConfigVersion(8L).appliedConfigVersion(7L).lastError(warning).build();
        SelfHostedHeartbeatRequest heartbeat = new SelfHostedHeartbeatRequest();
        heartbeat.setAgentVersion("1.5.12");
        heartbeat.setAppliedConfigVersion(7L);

        service.heartbeat(node, heartbeat);

        assertEquals("online", node.getStatus());
        assertNull(node.getLastError());
        assertTrue(service.desiredConfig(node).toJSONString().contains("\"ruleId\":9"));

        node.setLastError(warning);
        SelfHostedApplyResultRequest result = new SelfHostedApplyResultRequest();
        result.setVersion(8L);
        result.setSuccess(true);
        service.applyResult(node, result);
        assertNull(node.getLastError());
    }

    @Test
    void nginxReloadSigpipeIsTreatedAsPortForwardCompatibilityWarning() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), mock(SelfHostedGroupNodeDao.class),
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
        String error = "Command '['nginx', '-s', 'reload']' died with <Signals.SIGPIPE: 13>.";
        SelfHostedNode node = SelfHostedNode.builder().id(1L).status("degraded")
                .agentVersion("1.2.0").desiredConfigVersion(8L).appliedConfigVersion(7L)
                .lastError(error).build();
        SelfHostedHeartbeatRequest heartbeat = new SelfHostedHeartbeatRequest();
        heartbeat.setAppliedConfigVersion(7L);

        service.heartbeat(node, heartbeat);

        assertEquals("online", node.getStatus());
        assertEquals(error, node.getLastError());
        assertTrue(SelfHostedCdnService.isPortForwardCompatibilityError(error));
        assertEquals("当前节点 Nginx 重载端口转发配置失败，请重新安装 Agent",
                SelfHostedCdnService.portForwardCompatibilityWarning(node));
    }

    @Test
    void legacyAgentDoesNotReceivePortForwardRules() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedPortForwardDao portForwardDao = mock(SelfHostedPortForwardDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(portForwardDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedPortForward.builder().id(9L).nodeGroupId(2L).status("enabled").build()));
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, mock(SelfHostedDomainConfigDao.class),
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                mock(CdnDomainDao.class), portForwardDao);

        String config = service.desiredConfig(SelfHostedNode.builder()
                .id(1L).agentVersion("1.0.0").desiredConfigVersion(8L).build()).toJSONString();

        assertTrue(config.contains("\"portForwards\":[]"));
        assertTrue(config.contains("版本过低"));
    }

    @Test
    void compatibleAgentReceivesPortForwardRules() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedPortForwardDao portForwardDao = mock(SelfHostedPortForwardDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(portForwardDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedPortForward.builder().id(9L).nodeGroupId(2L).status("enabled").build()));
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, mock(SelfHostedDomainConfigDao.class),
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                mock(CdnDomainDao.class), portForwardDao);

        String config = service.desiredConfig(SelfHostedNode.builder()
                .id(1L).agentVersion("1.4.0").desiredConfigVersion(8L).build()).toJSONString();

        assertTrue(config.contains("\"ruleId\":9"));
        assertFalse(config.contains("portForwardWarning"));
    }

    @Test
    void agentConfigIncludesNodeCacheDiskAndCleanupPolicy() {
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.emptyList());
        SelfHostedCdnService service = new SelfHostedCdnService(mock(SelfHostedNodeDao.class),
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, mock(SelfHostedDomainConfigDao.class),
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                mock(CdnDomainDao.class), mock(SelfHostedPortForwardDao.class));
        SelfHostedNode node = SelfHostedNode.builder().id(1L).desiredConfigVersion(5L)
                .cacheDiskMount("/data").cacheMaxSizeGb(200)
                .cacheCleanupEnabled(1).cacheCleanupAgeDays(14).cacheCleanupMinHits(3).build();

        String json = service.desiredConfig(node).toJSONString();

        assertTrue(json.contains("\"diskMount\":\"/data\""));
        assertTrue(json.contains("\"directory\":\"/data/kuocai-cdn-cache\""));
        assertTrue(json.contains("\"maxSizeGb\":200"));
        assertTrue(json.contains("\"cleanupAgeDays\":14"));
        assertTrue(json.contains("\"cleanupMinHits\":3"));
        assertEquals("/var/cache/kuocai-cdn", SelfHostedCdnService.cacheDirectory("/"));
    }

    @Test
    void heartbeatStoresDetectedCacheDisksForAdminSelection() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), mock(SelfHostedGroupNodeDao.class),
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
        SelfHostedNode node = SelfHostedNode.builder().id(1L).desiredConfigVersion(8L)
                .appliedConfigVersion(7L).enabled(1).build();
        SelfHostedDiskInfo disk = new SelfHostedDiskInfo();
        disk.setDevice("/dev/vdb1");
        disk.setMountPath("/data");
        disk.setFsType("xfs");
        disk.setTotalBytes(500L * 1024 * 1024 * 1024);
        disk.setAvailableBytes(400L * 1024 * 1024 * 1024);
        disk.setUsedPercent(new BigDecimal("20.00"));
        disk.setWritable(true);
        SelfHostedHeartbeatRequest request = new SelfHostedHeartbeatRequest();
        request.setAppliedConfigVersion(7L);
        request.setDisks(Collections.singletonList(disk));

        service.heartbeat(node, request);

        assertTrue(node.getDetectedDisksJson().contains("/dev/vdb1"));
        assertTrue(node.getDetectedDisksJson().contains("/data"));
        verify(nodeDao).updateById(node);
    }

    @Test
    void heartbeatPersistsLocalProtectionAfterNginxCannotWriteOssfs() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), mock(SelfHostedGroupNodeDao.class),
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
        SelfHostedNode node = SelfHostedNode.builder().id(7L).desiredConfigVersion(9L)
                .appliedConfigVersion(8L).enabled(1).cacheLocalFallback(0).build();
        SelfHostedHeartbeatRequest request = new SelfHostedHeartbeatRequest();
        request.setAppliedConfigVersion(8L);
        request.setLastError("缓存目录对 Nginx 工作进程不可写：/mnt/guangzhou-kuocai/kuocai-cdn-cache（用户 nginx）");

        service.heartbeat(node, request);

        assertEquals(1, node.getCacheLocalFallback());
        assertEquals("degraded", node.getStatus());
        verify(nodeDao).updateById(node);
    }

    @Test
    void heartbeatCalculatesNetworkRatesAndRecordsTelemetry() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedNodeTelemetryService telemetryService = mock(SelfHostedNodeTelemetryService.class);
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), mock(SelfHostedGroupNodeDao.class),
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
        service.setTelemetryService(telemetryService);
        SelfHostedNode node = SelfHostedNode.builder().id(1L).status("online")
                .lastHeartbeat(new java.util.Date(System.currentTimeMillis() - 30_000L))
                .rxBytes(1_000L).txBytes(2_000L).desiredConfigVersion(8L)
                .appliedConfigVersion(7L).enabled(1).build();
        SelfHostedHeartbeatRequest request = new SelfHostedHeartbeatRequest();
        request.setAppliedConfigVersion(7L);
        request.setRxBytes(31_000L);
        request.setTxBytes(62_000L);

        service.heartbeat(node, request);

        assertTrue(node.getRxRateBps() >= 950L && node.getRxRateBps() <= 1_050L);
        assertTrue(node.getTxRateBps() >= 1_900L && node.getTxRateBps() <= 2_100L);
        verify(telemetryService).recordHeartbeat(node, "online", null);
    }

    @Test
    void heartbeatMarksConfiguredDomainOnlineAfterNodeAppliesLatestVersion() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        SelfHostedCacheJobNodeDao cacheJobNodeDao = mock(SelfHostedCacheJobNodeDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedDomainConfig.builder().cdnDomainId(4L).nodeGroupId(2L).status("enabled").build()));
        CdnDomain domain = CdnDomain.builder().id(4L).domainName("cdn.example.com")
                .route(CdnRoute.SELF_HOSTED.getCode()).cname("cdn.example.com.edge.test")
                .domainStatus("configuring").build();
        when(domainDao.selectById(4L)).thenReturn(domain);
        when(cacheJobNodeDao.selectList(any())).thenReturn(Collections.emptyList());
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), cacheJobNodeDao, domainDao, mock(SelfHostedPortForwardDao.class));
        SelfHostedNode node = SelfHostedNode.builder().id(1L).desiredConfigVersion(8L)
                .appliedConfigVersion(7L).enabled(1).build();
        SelfHostedHeartbeatRequest request = new SelfHostedHeartbeatRequest();
        request.setAppliedConfigVersion(8L);

        service.heartbeat(node, request);

        assertEquals("online", domain.getDomainStatus());
        verify(domainDao).updateById(domain);
    }

    @Test
    void domainIsReadyOnlyWhenARecentEnabledNodeHasAppliedLatestVersion() throws Exception {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        when(domainConfigDao.selectOne(any())).thenReturn(SelfHostedDomainConfig.builder()
                .cdnDomainId(4L).nodeGroupId(2L).status("enabled").build());
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(2L).nodeId(1L).build()));
        when(nodeDao.selectById(1L)).thenReturn(SelfHostedNode.builder().id(1L).enabled(1)
                .lastHeartbeat(new java.util.Date()).desiredConfigVersion(8L)
                .appliedConfigVersion(8L).build());
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao,
                mock(SelfHostedNodeGroupDao.class), groupNodeDao, domainConfigDao,
                mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                mock(CdnDomainDao.class), mock(SelfHostedPortForwardDao.class));

        assertTrue(service.isDomainConfigurationApplied(4L));
    }

    @Test
    void newAgentAppliesConfigurationBeforeProcessingCacheJobs() throws Exception {
        String source = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/self-hosted/kuocai-edge-agent.py")), StandardCharsets.UTF_8);

        assertTrue(source.indexOf("applied = apply_config(config, desired)")
                < source.indexOf("process_cache_jobs(config, response.get(\"cacheJobs\"))"));
        assertTrue(source.contains("AGENT_VERSION = \"1.5.12\""));
        assertTrue(source.contains("\"agentVersion\": AGENT_VERSION"));
        assertTrue(source.contains("sys.argv[1] == \"--version\""));
        assertTrue(source.contains("def reload_nginx():"));
        assertTrue(source.contains("if not module_path and re.search"));
        assertTrue(source.contains("\"        sendfile off;\""));
        assertTrue(source.contains("proxy_cache_lock on"));
        assertTrue(source.contains("proxy_cache_use_stale error timeout invalid_header updating"));
        assertTrue(source.contains("slice %dm"));
        assertTrue(source.contains("proxy_set_header Range $slice_range"));
        assertTrue(source.contains("proxy_set_header Range $http_range"));
        assertTrue(source.contains("limit_req_zone $server_name"));
        assertTrue(source.contains("limit_conn_zone $server_name"));
        assertTrue(source.contains("limit_conn kuocai_attack_conn_"));
        assertFalse(source.contains("limit_conn zone=kuocai_attack_conn_"));
        assertTrue(source.contains("limit_req_status 429"));
        assertTrue(source.contains("limit_conn_status 429"));
        assertTrue(source.contains("glob.glob(\"/usr/share/nginx/modules/*.conf\")"));
        assertTrue(source.contains("ngx_stream_module\\.so[\\\"']?\\s*;"));
        assertTrue(source.contains("def write_icp_blocked_domain_config("));
        assertTrue(source.contains("return 451"));
        assertTrue(source.contains("该域名目前未通过阿里云备案"));
        assertTrue(source.contains("previous_workers = nginx_worker_pids()"));
        assertTrue(source.contains("retire_previous_nginx_workers(previous_workers)"));
        assertTrue(source.contains("blocks = [*query_maps, *attack_zones, \"\", *upstream, \"\","));
        assertTrue(source.contains("failed_domain_filename"));
        assertTrue(source.contains("was quarantined after validation failed"));
        assertTrue(source.contains("urllib.parse.unquote(str(value or \"\").strip(), errors=\"strict\")"));
        assertTrue(source.contains("return nginx_string(value)"));
        assertTrue(source.contains("def nginx_worker_identity()"));
        assertTrue(source.contains("def worker_can_write_cache("));
        assertTrue(source.contains("缓存目录对 Nginx 工作进程不可写"));
        assertTrue(source.contains("def cpu_percent()"));
        assertTrue(source.contains("default_route_interfaces"));
        assertTrue(source.contains("def detected_disks()"));
        assertTrue(source.contains("\"fuse.ossfs\""));
        assertTrue(source.contains("MAX_REPORTED_BYTES = (1 << 63) - 1"));
        assertTrue(source.contains("def cleanup_low_frequency_cache"));
        assertTrue(source.contains("cachePolicy"));
        assertTrue(source.contains("listen 80 default_server"));
        assertTrue(source.contains("return 444"));
        assertTrue(source.contains("remove_distribution_default_server"));
        assertTrue(source.contains("def prepare_statistics_batch()"));
        assertTrue(source.contains("def report_statistics(config)"));
        assertTrue(source.contains("/api/self-hosted/agent/statistics"));
        assertTrue(source.contains("statistics_inode"));
        assertTrue(source.contains("statistics_offset"));
        assertTrue(source.contains("$upstream_status"));
    }

    @Test
    void forceRedirectPageRendersTheSwitchFromStatus() throws Exception {
        String template = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/domain/domain-setting-https.html")),
                StandardCharsets.UTF_8);

        assertTrue(template.contains("get('force_redirect').get('status') == 'on'"));
        assertFalse(template.contains("get('force_redirect').get('redirectType') == 'https'"));
    }

    @Test
    void attackProtectionControlsAreAdminOnlyAndUseIndependentDomainThresholds() throws Exception {
        String template = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/domain/domain-setting-higher.html")),
                StandardCharsets.UTF_8);
        String controller = new String(Files.readAllBytes(Paths.get(
                "src/main/java/com/kuocai/cdn/controller/rest/CdnDomainHigherController.java")),
                StandardCharsets.UTF_8);

        assertTrue(template.contains("单域名攻击熔断"));
        assertTrue(template.contains("isAdmin and #strings.startsWith(domain.route, 'self_hosted')"));
        assertTrue(template.contains("/CdnDomainHigher/saveAttackProtection"));
        assertTrue(template.contains("selfHostedAttackMaxConnections"));
        assertTrue(controller.contains("if (!isAdmin())"));
        assertTrue(controller.contains("saveAttackProtection(cdnDomain, config)"));
    }

    @Test
    void selfHostedAllFilesCacheRuleRemainsVisibleAndAddable() throws Exception {
        String template = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/domain/domain-setting-cache.html")),
                StandardCharsets.UTF_8);
        String script = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/static/common/custom_cto.js")), StandardCharsets.UTF_8);

        assertTrue(template.contains("#strings.startsWith(domain.route, 'self_hosted') && rule.get('match_type') == 'all'"));
        assertTrue(template.contains("'tencent' == domain.route || #strings.startsWith(domain.route, 'self_hosted')"));
        assertTrue(template.contains("20260726-self-hosted-all-cache-rule"));
        assertTrue(script.contains("matchType === \"all\" || matchType === \"home_page\""));
    }

    @Test
    void portForwardProxyProtocolIsAnExplicitPerRuleOption() throws Exception {
        String template = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/domain/self-hosted-port-forward.html")),
                StandardCharsets.UTF_8);
        String schema = new String(Files.readAllBytes(Paths.get(
                "src/main/java/com/kuocai/cdn/component/SelfHostedCdnSchemaInitializer.java")),
                StandardCharsets.UTF_8);

        assertTrue(template.contains("id=\"proxyProtocolEnabled\""));
        assertTrue(template.contains("proxyProtocolEnabled: document.getElementById('proxyProtocolEnabled').checked"));
        assertTrue(template.contains("源站必须支持并启用 PROXY Protocol"));
        assertTrue(schema.contains("proxy_protocol_enabled TINYINT NOT NULL DEFAULT 0"));
        assertTrue(schema.contains("ADD COLUMN proxy_protocol_enabled"));
    }

    @Test
    void adminMarksSharedStoragePerNodeInsteadOfPerSchedulingGroup() throws Exception {
        String template = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/settings/self-hosted-node.html")), StandardCharsets.UTF_8);
        String schema = new String(Files.readAllBytes(Paths.get(
                "src/main/java/com/kuocai/cdn/component/SelfHostedCdnSchemaInitializer.java")),
                StandardCharsets.UTF_8);

        assertTrue(template.contains("id=\"nodeCacheStorageKey\""));
        assertTrue(template.contains("同一存储："));
        assertTrue(template.contains("sharedCacheLeader"));
        assertFalse(template.contains("id=\"groupSharedCache\""));
        assertTrue(schema.contains("cache_storage_key VARCHAR(128)"));
        assertTrue(template.contains("id=\"nodeCacheStorageWriter\""));
        assertTrue(template.contains("首选写入节点"));
        assertTrue(schema.contains("cache_storage_writer TINYINT"));
        assertTrue(schema.contains("cache_local_fallback TINYINT"));
        assertTrue(schema.contains("idx_self_hosted_node_cache_storage"));
        assertTrue(schema.contains("idx_self_hosted_node_cache_writer"));
        assertTrue(schema.contains("self_hosted_statistics_batch"));
        assertTrue(schema.contains("self_hosted_domain_metric"));
        assertTrue(schema.contains("uk_self_hosted_domain_metric"));
        String statisticsStorage = new String(Files.readAllBytes(Paths.get(
                "src/main/java/com/kuocai/cdn/service/SelfHostedDomainStatisticsStorageService.java")),
                StandardCharsets.UTF_8);
        assertTrue(statisticsStorage.contains("ROUND(SUM(edge_bytes)*8/300)"));
        assertTrue(statisticsStorage.contains("ROUND(SUM(origin_bytes)*8/300)"));
    }

    @Test
    void agentGeneratesAllSelfHostedDomainConfigurationFamilies() throws Exception {
        String source = new String(Files.readAllBytes(Paths.get(
                "src/main/resources/self-hosted/kuocai-edge-agent.py")), StandardCharsets.UTF_8);

        assertTrue(source.contains("proxy_force_ranges on"));
        assertTrue(source.contains("proxy_cache_revalidate on"));
        assertTrue(source.contains("def ignores_origin_cache_headers("));
        assertTrue(source.contains("proxy_ignore_headers X-Accel-Expires Expires Cache-Control;"));
        assertTrue(source.contains("urllib.parse.unquote(value.strip(), errors=\"strict\") == \"/\""));
        assertTrue(source.contains("options, default_rule)"));
        assertTrue(source.contains("valid_referers"));
        assertTrue(source.contains("secure_link_md5"));
        assertTrue(source.contains("proxy_set_header %s %s"));
        assertTrue(source.contains("add_header %s %s always"));
        assertTrue(source.contains("gzip on"));
        assertTrue(source.contains("listen [::]:80"));
        assertTrue(source.contains("backup;"));
        assertTrue(source.contains("followRedirectStatus"));
        assertTrue(source.contains("def write_port_forward_config"));
        assertTrue(source.contains("udp reuseport"));
        assertTrue(source.contains("proxy_protocol on;"));
        assertTrue(source.contains("stream {"));
    }

    private void assertSelfHostedProductRoute(String route, String coverage,
                                              String serviceArea, String name) {
        assertTrue(CdnRoute.isSelfHosted(route));
        assertEquals(coverage, CdnRoute.selfHostedCoverage(route));
        assertEquals(serviceArea, CdnRoute.selfHostedServiceArea(route));
        assertEquals(route, CdnOperationRoute.convert(route).getRoute());
        assertEquals(route, CdnCacheSettingRoute.convert(route).getRoute());
        assertEquals(route, CdnStatisticsRoute.convert(route).getRoute());
    }
}
