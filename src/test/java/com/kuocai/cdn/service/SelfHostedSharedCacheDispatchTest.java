package com.kuocai.cdn.service;

import com.alibaba.fastjson.JSONObject;
import com.kuocai.cdn.dao.CdnDomainDao;
import com.kuocai.cdn.dao.SelfHostedCacheJobDao;
import com.kuocai.cdn.dao.SelfHostedCacheJobNodeDao;
import com.kuocai.cdn.dao.SelfHostedDomainConfigDao;
import com.kuocai.cdn.dao.SelfHostedGroupNodeDao;
import com.kuocai.cdn.dao.SelfHostedNodeDao;
import com.kuocai.cdn.dao.SelfHostedNodeGroupDao;
import com.kuocai.cdn.dao.SelfHostedPortForwardDao;
import com.kuocai.cdn.entity.CdnDomain;
import com.kuocai.cdn.entity.SelfHostedCacheJob;
import com.kuocai.cdn.entity.SelfHostedCacheJobNode;
import com.kuocai.cdn.entity.SelfHostedDomainConfig;
import com.kuocai.cdn.entity.SelfHostedGroupNode;
import com.kuocai.cdn.entity.SelfHostedNode;
import com.kuocai.cdn.enumeration.domainmerage.CdnRoute;
import com.kuocai.cdn.service.domain.cacheset.SelfHostedDomainCacheSettingServiceImpl;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.Collections;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SelfHostedSharedCacheDispatchTest {

    @Test
    void sameStoragePreheatsEachUrlOnOnlyOneNode() throws Exception {
        TestFixture fixture = new TestFixture(true);

        fixture.service.submitCachePreheating(new String[]{
                "https://cdn.example.com/assets/logo.png",
                "https://cdn.example.com/assets/logo.png"
        });

        ArgumentCaptor<SelfHostedCacheJobNode> records = ArgumentCaptor.forClass(SelfHostedCacheJobNode.class);
        org.mockito.Mockito.verify(fixture.cacheJobNodeDao).insert(records.capture());
        assertEquals(4L, records.getValue().getNodeId());
        assertEquals("[\"https://cdn.example.com/assets/logo.png\"]", records.getValue().getTargetsJson());
    }

    @Test
    void preferredStorageWriterReceivesPreheatTask() throws Exception {
        TestFixture fixture = new TestFixture(true, 6L);

        fixture.service.submitCachePreheating(new String[]{"https://cdn.example.com/assets/logo.png"});

        ArgumentCaptor<SelfHostedCacheJobNode> records = ArgumentCaptor.forClass(SelfHostedCacheJobNode.class);
        org.mockito.Mockito.verify(fixture.cacheJobNodeDao).insert(records.capture());
        assertEquals(6L, records.getValue().getNodeId());
    }

    @Test
    void nodesWithoutStorageMarkerStillPreheatIndependently() throws Exception {
        TestFixture fixture = new TestFixture(false);

        fixture.service.submitCachePreheating(new String[]{"https://cdn.example.com/assets/logo.png"});

        ArgumentCaptor<SelfHostedCacheJobNode> records = ArgumentCaptor.forClass(SelfHostedCacheJobNode.class);
        org.mockito.Mockito.verify(fixture.cacheJobNodeDao, org.mockito.Mockito.times(3)).insert(records.capture());
        assertEquals(Arrays.asList(4L, 5L, 6L), Arrays.asList(
                records.getAllValues().get(0).getNodeId(),
                records.getAllValues().get(1).getNodeId(),
                records.getAllValues().get(2).getNodeId()));
    }

    @Test
    void followerUsesLocalBypassCacheAndRelaysMissesToStorageWriter() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedNodeGroupDao groupDao = mock(SelfHostedNodeGroupDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        SelfHostedNode follower = node(4L, "北京一", "47.93.55.10", "beijing-oss");
        SelfHostedNode followerTwo = node(5L, "北京二", "101.200.55.93", "beijing-oss");
        SelfHostedNode writer = node(6L, "北京三", "47.93.205.57", "beijing-oss");
        writer.setCacheStorageWriter(1);
        when(nodeDao.selectList(any())).thenReturn(Arrays.asList(follower, followerTwo, writer));
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(8L).nodeId(5L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedDomainConfig.builder().id(11L).cdnDomainId(10L).nodeGroupId(8L)
                        .originType("ipaddr").originAddress("211.154.22.7").originProtocol("follow")
                        .httpPort(80).httpsPort(443).originHost("cdn.example.com")
                        .originConfigJson("{\"originReceiveTimeout\":30}")
                        .cacheConfigJson("{\"defaultTtl\":3600}").status("enabled").build()));
        when(domainDao.selectById(10L)).thenReturn(CdnDomain.builder().id(10L)
                .domainName("cdn.example.com").cname("cdn.example.com.edge.test")
                .route(CdnRoute.SELF_HOSTED.getCode()).domainStatus("online").build());
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao, groupDao, groupNodeDao,
                domainConfigDao, mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                domainDao, mock(SelfHostedPortForwardDao.class));

        JSONObject leaderConfig = service.desiredConfig(writer);
        JSONObject followerConfig = service.desiredConfig(follower);
        JSONObject followerPolicy = followerConfig.getJSONObject("cachePolicy");
        JSONObject leaderDomain = leaderConfig.getJSONArray("domains").getJSONObject(0);
        JSONObject followerDomain = followerConfig.getJSONArray("domains").getJSONObject(0);

        assertTrue(leaderConfig.getJSONObject("cachePolicy").getBooleanValue("sharedCacheLeader"));
        assertEquals("/mnt/beijing/kuocai-cdn-cache",
                leaderConfig.getJSONObject("cachePolicy").getString("directory"));
        assertEquals(16, JSONObject.parseObject(leaderDomain.getString("cacheConfigJson"))
                .getIntValue("sliceSizeMb"));
        assertFalse(followerPolicy.getBooleanValue("sharedCacheLeader"));
        assertTrue(followerPolicy.getBooleanValue("sharedCacheLeaderReady"));
        assertFalse(followerPolicy.getBooleanValue("writeEnabled"));
        assertFalse(followerPolicy.getBooleanValue("cleanupEnabled"));
        assertEquals("/var/cache/kuocai-cdn", followerPolicy.getString("directory"));
        assertEquals("47.93.205.57", followerDomain.getString("originAddress"));
        assertEquals("http", followerDomain.getString("originProtocol"));
        assertEquals(0, JSONObject.parseObject(followerDomain.getString("cacheConfigJson"))
                .getIntValue("defaultTtl"));
        assertFalse(followerDomain.toJSONString().contains("211.154.22.7"));
    }

    @Test
    void followerUsesTheRealOriginWithoutCachingUntilWriterConfigIsCurrent() {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedNodeGroupDao groupDao = mock(SelfHostedNodeGroupDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
        CdnDomainDao domainDao = mock(CdnDomainDao.class);
        SelfHostedNode follower = node(4L, "beijing-follower", "47.93.55.10", "beijing-oss");
        SelfHostedNode writer = node(6L, "beijing-writer", "47.93.205.57", "beijing-oss");
        writer.setCacheStorageWriter(1);
        writer.setDesiredConfigVersion(12L);
        writer.setAppliedConfigVersion(11L);
        when(nodeDao.selectList(any())).thenReturn(Arrays.asList(follower, writer));
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(8L).nodeId(4L).build()));
        when(domainConfigDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedDomainConfig.builder().id(11L).cdnDomainId(10L).nodeGroupId(8L)
                        .originType("ipaddr").originAddress("211.154.22.7").originProtocol("follow")
                        .httpPort(80).httpsPort(443).originHost("cdn.example.com")
                        .originConfigJson("{\"originReceiveTimeout\":30}")
                        .cacheConfigJson("{\"defaultTtl\":3600}").status("enabled").build()));
        when(domainDao.selectById(10L)).thenReturn(CdnDomain.builder().id(10L)
                .domainName("cdn.example.com").cname("cdn.example.com.edge.test")
                .route(CdnRoute.SELF_HOSTED.getCode()).domainStatus("online").build());
        SelfHostedCdnService service = new SelfHostedCdnService(nodeDao, groupDao, groupNodeDao,
                domainConfigDao, mock(SelfHostedCacheJobDao.class), mock(SelfHostedCacheJobNodeDao.class),
                domainDao, mock(SelfHostedPortForwardDao.class));

        JSONObject followerConfig = service.desiredConfig(follower);
        JSONObject followerPolicy = followerConfig.getJSONObject("cachePolicy");
        JSONObject followerDomain = followerConfig.getJSONArray("domains").getJSONObject(0);

        assertFalse(followerPolicy.getBooleanValue("sharedCacheLeaderReady"));
        assertFalse(followerPolicy.getBooleanValue("writeEnabled"));
        assertEquals("211.154.22.7", followerDomain.getString("originAddress"));
        assertEquals("follow", followerDomain.getString("originProtocol"));
        assertEquals(0, JSONObject.parseObject(followerDomain.getString("cacheConfigJson"))
                .getIntValue("defaultTtl"));
    }

    @Test
    void preferredWriterRemainsStableWhenHeartbeatStateChanges() {
        SelfHostedNode fallback = node(4L, "北京一", "47.93.55.10", "beijing-oss");
        SelfHostedNode preferred = node(6L, "北京三", "47.93.205.57", "beijing-oss");
        preferred.setCacheStorageWriter(1);
        preferred.setStatus("offline");
        preferred.setLastHeartbeat(new Date(System.currentTimeMillis() - 120_000L));

        assertEquals(6L, SelfHostedCacheWriterSelector.select(
                Arrays.asList(fallback, preferred)).getId());
    }

    @Test
    void storageWithoutPreferredWriterUsesStableLowestEnabledId() {
        SelfHostedNode lowerId = node(4L, "北京一", "47.93.55.10", "beijing-oss");
        SelfHostedNode recentlyHealthy = node(6L, "北京三", "47.93.205.57", "beijing-oss");
        lowerId.setStatus("offline");
        lowerId.setLastHeartbeat(new Date(System.currentTimeMillis() - 120_000L));

        assertEquals(4L, SelfHostedCacheWriterSelector.select(
                Arrays.asList(recentlyHealthy, lowerId)).getId());
    }

    @Test
    void oldAgentOnOssfsUsesLocalCacheUntilPermissionAwareAgentIsInstalled() {
        SelfHostedNode oldAgent = node(4L, "北京一", "47.93.55.10", "beijing-oss");
        oldAgent.setAgentVersion("1.4.1");
        oldAgent.setDetectedDisksJson("[{\"mountPath\":\"/mnt/beijing\",\"fsType\":\"fuse.ossfs\",\"writable\":true}]");
        SelfHostedCdnService service = serviceForSingleNode(oldAgent);

        JSONObject policy = service.desiredConfig(oldAgent).getJSONObject("cachePolicy");

        assertTrue(policy.getBooleanValue("localFallback"));
        assertEquals("/mnt/beijing", policy.getString("configuredDiskMount"));
        assertEquals("/var/cache/kuocai-cdn", policy.getString("directory"));
    }

    @Test
    void permissionAwareAgentCanUseConfiguredOssfsCache() {
        SelfHostedNode currentAgent = node(4L, "北京一", "47.93.55.10", "beijing-oss");
        currentAgent.setAgentVersion("v1.4.2");
        currentAgent.setDetectedDisksJson("[{\"mountPath\":\"/mnt/beijing\",\"fsType\":\"fuse.ossfs\",\"writable\":true}]");
        SelfHostedCdnService service = serviceForSingleNode(currentAgent);

        JSONObject policy = service.desiredConfig(currentAgent).getJSONObject("cachePolicy");

        assertFalse(policy.getBooleanValue("localFallback"));
        assertEquals("/mnt/beijing/kuocai-cdn-cache", policy.getString("directory"));
    }

    @Test
    void permissionFailureKeepsCurrentAgentOnPersistentLocalProtection() {
        SelfHostedNode currentAgent = node(7L, "广东一", "8.163.99.36", "guangzhou-oss");
        currentAgent.setAgentVersion("1.4.2");
        currentAgent.setCacheLocalFallback(1);
        currentAgent.setDetectedDisksJson("[{\"mountPath\":\"/mnt/beijing\",\"fsType\":\"fuse.ossfs\",\"writable\":true}]");
        SelfHostedCdnService service = serviceForSingleNode(currentAgent);

        JSONObject policy = service.desiredConfig(currentAgent).getJSONObject("cachePolicy");

        assertTrue(policy.getBooleanValue("localFallback"));
        assertEquals("/var/cache/kuocai-cdn", policy.getString("directory"));
    }

    private static SelfHostedCdnService serviceForSingleNode(SelfHostedNode node) {
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        when(nodeDao.selectList(any())).thenReturn(Collections.singletonList(node));
        when(groupNodeDao.selectList(any())).thenReturn(Collections.emptyList());
        return new SelfHostedCdnService(nodeDao, mock(SelfHostedNodeGroupDao.class), groupNodeDao,
                mock(SelfHostedDomainConfigDao.class), mock(SelfHostedCacheJobDao.class),
                mock(SelfHostedCacheJobNodeDao.class), mock(CdnDomainDao.class),
                mock(SelfHostedPortForwardDao.class));
    }

    private static SelfHostedNode node(Long id, String name, String host, String storageKey) {
        return SelfHostedNode.builder().id(id).nodeName(name).host(host).enabled(1).status("online")
                .lastHeartbeat(new Date()).cacheDiskMount("/mnt/beijing")
                .cacheStorageKey(storageKey).cacheCleanupEnabled(1)
                .desiredConfigVersion(10L).appliedConfigVersion(10L).build();
    }

    private static final class TestFixture {
        private final SelfHostedCacheJobNodeDao cacheJobNodeDao = mock(SelfHostedCacheJobNodeDao.class);
        private final SelfHostedDomainCacheSettingServiceImpl service;

        private TestFixture(boolean sharedStorage) {
            this(sharedStorage, null);
        }

        private TestFixture(boolean sharedStorage, Long preferredWriterId) {
            SelfHostedCacheJobDao cacheJobDao = mock(SelfHostedCacheJobDao.class);
            CdnDomainDao domainDao = mock(CdnDomainDao.class);
            SelfHostedDomainConfigDao domainConfigDao = mock(SelfHostedDomainConfigDao.class);
            SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
            SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
            when(domainDao.selectOne(any())).thenReturn(CdnDomain.builder().id(10L)
                    .domainName("cdn.example.com").route(CdnRoute.SELF_HOSTED.getCode()).build());
            when(domainConfigDao.selectOne(any())).thenReturn(SelfHostedDomainConfig.builder()
                    .cdnDomainId(10L).nodeGroupId(8L).status("enabled").build());
            when(groupNodeDao.selectList(any())).thenReturn(Arrays.asList(
                    SelfHostedGroupNode.builder().groupId(8L).nodeId(4L).build(),
                    SelfHostedGroupNode.builder().groupId(8L).nodeId(5L).build(),
                    SelfHostedGroupNode.builder().groupId(8L).nodeId(6L).build()));
            SelfHostedNode node4 = node(4L, "北京一", "47.93.55.10",
                    sharedStorage ? "beijing-oss" : null);
            SelfHostedNode node5 = node(5L, "北京二", "101.200.55.93",
                    sharedStorage ? "beijing-oss" : null);
            SelfHostedNode node6 = node(6L, "北京三", "47.93.205.57",
                    sharedStorage ? "beijing-oss" : null);
            for (SelfHostedNode candidate : Arrays.asList(node4, node5, node6)) {
                if (candidate.getId().equals(preferredWriterId)) candidate.setCacheStorageWriter(1);
            }
            when(nodeDao.selectById(4L)).thenReturn(node4);
            when(nodeDao.selectById(5L)).thenReturn(node5);
            when(nodeDao.selectById(6L)).thenReturn(node6);
            when(cacheJobDao.insert(any(SelfHostedCacheJob.class))).thenAnswer(invocation -> {
                ((SelfHostedCacheJob) invocation.getArgument(0)).setId(20L);
                return 1;
            });
            when(cacheJobNodeDao.insert(any(SelfHostedCacheJobNode.class))).thenReturn(1);
            service = new SelfHostedDomainCacheSettingServiceImpl(cacheJobDao, cacheJobNodeDao,
                    domainDao, domainConfigDao, groupNodeDao, nodeDao);
        }
    }
}
