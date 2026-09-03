package com.kuocai.cdn.service;

import com.kuocai.cdn.dao.SelfHostedGroupNodeDao;
import com.kuocai.cdn.dao.SelfHostedNodeDao;
import com.kuocai.cdn.dao.SelfHostedNodeGroupDao;
import com.kuocai.cdn.dao.SelfHostedPortForwardDao;
import com.kuocai.cdn.dto.SelfHostedPortForwardSaveRequest;
import com.kuocai.cdn.entity.SelfHostedGroupNode;
import com.kuocai.cdn.entity.SelfHostedNode;
import com.kuocai.cdn.entity.SelfHostedNodeGroup;
import com.kuocai.cdn.entity.SelfHostedPortForward;
import com.kuocai.cdn.entity.SysUser;
import com.kuocai.cdn.exception.BusinessException;
import com.alibaba.fastjson.JSONObject;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collections;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SelfHostedPortForwardServiceTest {
    @Test
    void persistsProxyProtocolAsAnExplicitOptIn() throws BusinessException {
        SelfHostedPortForwardDao portDao = mock(SelfHostedPortForwardDao.class);
        SelfHostedNodeGroupDao groupDao = mock(SelfHostedNodeGroupDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SysUserService sysUserService = mock(SysUserService.class);
        when(sysUserService.queryById(7L)).thenReturn(new SysUser());
        when(groupDao.selectById(8L)).thenReturn(
                SelfHostedNodeGroup.builder().id(8L).status("enabled").build());
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(8L).nodeId(1L).build()));
        when(nodeDao.selectById(1L)).thenReturn(
                SelfHostedNode.builder().id(1L).enabled(1).agentVersion("1.5.11").build());
        when(portDao.selectList(any())).thenReturn(Collections.emptyList());
        doAnswer(invocation -> {
            ((SelfHostedPortForward) invocation.getArgument(0)).setId(11L);
            return 1;
        }).when(portDao).insert(any(SelfHostedPortForward.class));
        SelfHostedPortForwardService service = new SelfHostedPortForwardService(
                portDao, groupDao, groupNodeDao, nodeDao, cdnService,
                sysUserService, mock(CdnAreaRouteService.class));
        SelfHostedPortForwardSaveRequest request = request(10000, 8080);
        request.setProxyProtocolEnabled(true);

        service.save(request, 7L, "self_hosted", true);

        ArgumentCaptor<SelfHostedPortForward> saved =
                ArgumentCaptor.forClass(SelfHostedPortForward.class);
        verify(portDao).insert(saved.capture());
        assertEquals(1, saved.getValue().getProxyProtocolEnabled());
        verify(cdnService).markGroupConfigurationChanged(8L);
    }

    @Test
    void rejectsReservedPortsBeforeWritingRule() {
        SelfHostedPortForwardService service = newService();
        SelfHostedPortForwardSaveRequest request = request(80, 8080);

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.save(request, 7L, "self_hosted_overseas", true));

        assertTrue(exception.getMessage().contains("22、80、443"));
    }

    @Test
    void rejectsRulesThatOverlapOnTheSameNodeAndProtocol() {
        SelfHostedPortForwardDao portDao = mock(SelfHostedPortForwardDao.class);
        SelfHostedNodeGroupDao groupDao = mock(SelfHostedNodeGroupDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        SysUserService sysUserService = mock(SysUserService.class);
        CdnAreaRouteService areaRouteService = mock(CdnAreaRouteService.class);
        when(sysUserService.queryById(7L)).thenReturn(new SysUser());
        SelfHostedPortForwardService service = new SelfHostedPortForwardService(
                portDao, groupDao, groupNodeDao, nodeDao, cdnService, sysUserService, areaRouteService);
        when(groupDao.selectById(8L)).thenReturn(SelfHostedNodeGroup.builder().id(8L).status("enabled").build());
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(8L).nodeId(1L).build()));
        when(nodeDao.selectById(1L)).thenReturn(SelfHostedNode.builder().id(1L).enabled(1).build());
        when(portDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedPortForward.builder().id(9L).nodeGroupId(8L).protocol("tcp")
                        .listenPort(10000).status("enabled").build()));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.save(request(10000, 8080), 7L, "self_hosted_overseas", true));

        assertTrue(exception.getMessage().contains("10000"));
    }

    @Test
    void exposesConfiguredSelfHostedGroupsToRegularVendorUsers() throws BusinessException {
        SelfHostedCdnService cdnService = mock(SelfHostedCdnService.class);
        CdnAreaRouteService areaRouteService = mock(CdnAreaRouteService.class);
        when(areaRouteService.configuredSelfHostedRoutes()).thenReturn(Arrays.asList(
                "self_hosted_overseas", "self_hosted_global"));
        when(cdnService.defaultGroup("self_hosted_overseas"))
                .thenReturn(SelfHostedNodeGroup.builder().id(8L).coverage("overseas").build());
        when(cdnService.defaultGroup("self_hosted_global"))
                .thenReturn(SelfHostedNodeGroup.builder().id(9L).coverage("global").build());
        SelfHostedPortForwardService service = new SelfHostedPortForwardService(
                mock(SelfHostedPortForwardDao.class), mock(SelfHostedNodeGroupDao.class),
                mock(SelfHostedGroupNodeDao.class), mock(SelfHostedNodeDao.class), cdnService,
                mock(SysUserService.class), areaRouteService);

        assertTrue(service.isAvailable("tencent_edgeone", false));
        assertEquals(2, service.availableGroups("tencent_edgeone", false).size());
    }

    @Test
    void rejectsRegularVendorUsersWhenNoSelfHostedTargetIsConfigured() {
        CdnAreaRouteService areaRouteService = mock(CdnAreaRouteService.class);
        when(areaRouteService.configuredSelfHostedRoutes()).thenReturn(Collections.emptyList());
        SelfHostedPortForwardService service = new SelfHostedPortForwardService(
                mock(SelfHostedPortForwardDao.class), mock(SelfHostedNodeGroupDao.class),
                mock(SelfHostedGroupNodeDao.class), mock(SelfHostedNodeDao.class),
                mock(SelfHostedCdnService.class), mock(SysUserService.class), areaRouteService);

        assertFalse(service.isAvailable("tencent_edgeone", false));
        assertThrows(BusinessException.class,
                () -> service.availableGroups("tencent_edgeone", false));
    }

    @Test
    void rejectsEnablingRuleWhenGroupContainsLegacyAgent() {
        SelfHostedPortForwardDao portDao = mock(SelfHostedPortForwardDao.class);
        SelfHostedNodeGroupDao groupDao = mock(SelfHostedNodeGroupDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        SysUserService sysUserService = mock(SysUserService.class);
        when(sysUserService.queryById(7L)).thenReturn(new SysUser());
        when(groupDao.selectById(8L)).thenReturn(
                SelfHostedNodeGroup.builder().id(8L).status("enabled").build());
        when(groupNodeDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedGroupNode.builder().groupId(8L).nodeId(1L).build()));
        when(nodeDao.selectById(1L)).thenReturn(SelfHostedNode.builder().id(1L)
                .nodeName("旧节点").enabled(1).agentVersion("1.0.0").build());
        when(portDao.selectList(any())).thenReturn(Collections.emptyList());
        SelfHostedPortForwardService service = new SelfHostedPortForwardService(
                portDao, groupDao, groupNodeDao, nodeDao, mock(SelfHostedCdnService.class),
                sysUserService, mock(CdnAreaRouteService.class));

        BusinessException exception = assertThrows(BusinessException.class,
                () -> service.save(request(10000, 8080), 7L, "self_hosted_overseas", true));

        assertTrue(exception.getMessage().contains("1 台节点暂不支持端口转发"));
        assertTrue(exception.getMessage().contains("旧节点"));
    }

    @Test
    void listShowsPartialDeploymentWhenOnlySomeNodesSupportPortForward() {
        SelfHostedPortForwardDao portDao = mock(SelfHostedPortForwardDao.class);
        SelfHostedNodeGroupDao groupDao = mock(SelfHostedNodeGroupDao.class);
        SelfHostedGroupNodeDao groupNodeDao = mock(SelfHostedGroupNodeDao.class);
        SelfHostedNodeDao nodeDao = mock(SelfHostedNodeDao.class);
        when(portDao.selectList(any())).thenReturn(Collections.singletonList(
                SelfHostedPortForward.builder().id(9L).nodeGroupId(8L).status("enabled").build()));
        when(groupDao.selectById(8L)).thenReturn(
                SelfHostedNodeGroup.builder().id(8L).groupName("海外节点组").build());
        when(groupNodeDao.selectList(any())).thenReturn(Arrays.asList(
                SelfHostedGroupNode.builder().groupId(8L).nodeId(1L).build(),
                SelfHostedGroupNode.builder().groupId(8L).nodeId(2L).build()));
        when(nodeDao.selectById(1L)).thenReturn(SelfHostedNode.builder()
                .id(1L).enabled(1).agentVersion("1.4.0").build());
        when(nodeDao.selectById(2L)).thenReturn(SelfHostedNode.builder()
                .id(2L).enabled(1).agentVersion("1.0.0").build());
        SelfHostedPortForwardService service = new SelfHostedPortForwardService(
                portDao, groupDao, groupNodeDao, nodeDao, mock(SelfHostedCdnService.class),
                mock(SysUserService.class), mock(CdnAreaRouteService.class));

        JSONObject item = service.list(7L, true).get(0);

        assertEquals("partial", item.getString("deploymentStatus"));
        assertEquals(1, item.getIntValue("deploymentReadyNodes"));
        assertEquals(2, item.getIntValue("deploymentTotalNodes"));
    }

    private SelfHostedPortForwardService newService() {
        return new SelfHostedPortForwardService(mock(SelfHostedPortForwardDao.class),
                mock(SelfHostedNodeGroupDao.class), mock(SelfHostedGroupNodeDao.class),
                mock(SelfHostedNodeDao.class), mock(SelfHostedCdnService.class), mock(SysUserService.class),
                mock(CdnAreaRouteService.class));
    }

    private SelfHostedPortForwardSaveRequest request(int listenPort, int originPort) {
        SelfHostedPortForwardSaveRequest request = new SelfHostedPortForwardSaveRequest();
        request.setRuleName("测试规则");
        request.setProtocol("tcp");
        request.setListenPort(listenPort);
        request.setOriginHost("192.0.2.10");
        request.setOriginPort(originPort);
        request.setNodeGroupId(8L);
        request.setUserId(7L);
        request.setStatus("enabled");
        return request;
    }
}
