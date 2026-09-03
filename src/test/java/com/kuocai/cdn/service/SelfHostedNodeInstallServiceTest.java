package com.kuocai.cdn.service;

import com.kuocai.cdn.entity.SelfHostedNode;
import org.junit.jupiter.api.Test;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SelfHostedNodeInstallServiceTest {

    @Test
    void installCommandUsesArchivedRepositoriesForCentos7() {
        String command = SelfHostedNodeInstallService.installCommand();

        assertTrue(command.contains("${ID:-}\" = \"centos"));
        assertTrue(command.contains("${VERSION_ID%%.*}\" = \"7"));
        assertTrue(command.contains("mirrors.aliyun.com/centos-vault/7.9.2009"));
        assertTrue(command.contains("mirrors.aliyun.com/epel-archive/7/$basearch"));
        assertTrue(command.contains("--disablerepo='*' --enablerepo='kuocai-centos7-*'"));
        assertTrue(command.contains("/var/run/kuocai-edge-install.lock"));
        assertTrue(command.contains("another Agent installation is already running"));
        assertTrue(command.contains("rpm -q ca-certificates"));
        assertTrue(command.contains("--setopt=timeout=30"));
    }

    @Test
    void installCommandVerifiesRuntimeBeforeCreatingNginxLink() {
        String command = SelfHostedNodeInstallService.installCommand();

        int nginxCheck = command.indexOf("command -v nginx");
        int nginxDirectory = command.indexOf("/etc/nginx /etc/nginx/conf.d");
        int nginxLink = command.indexOf("ln -sfn /etc/kuocai-edge/releases/0 /etc/nginx/kuocai-edge");

        assertTrue(nginxCheck >= 0);
        assertTrue(nginxDirectory > nginxCheck);
        assertTrue(nginxLink > nginxDirectory);
    }

    @Test
    void reinstallRestartsRunningAgentAndVerifiesItIsActive() {
        String command = SelfHostedNodeInstallService.installCommand();

        int installAgent = command.indexOf("install -m 700 /tmp/kuocai-edge-agent.py");
        int verifyAgentVersion = command.indexOf("/opt/kuocai-edge/agent.py --version");
        int restartAgent = command.indexOf("systemctl restart kuocai-edge-agent");
        int verifyAgent = command.indexOf("systemctl is-active --quiet kuocai-edge-agent");

        assertTrue(verifyAgentVersion > installAgent);
        assertTrue(command.contains("expected " + SelfHostedNodeInstallService.CURRENT_AGENT_VERSION));
        assertTrue(command.contains("exit 16"));
        assertTrue(restartAgent > installAgent);
        assertTrue(verifyAgent > restartAgent);
    }

    @Test
    void installationSuccessRequiresFreshCurrentAgentHeartbeatAndAppliedConfig() {
        Date startedAt = new Date(1_000L);
        SelfHostedNode ready = SelfHostedNode.builder().id(1L).status("online")
                .agentVersion(SelfHostedNodeInstallService.CURRENT_AGENT_VERSION)
                .lastHeartbeat(new Date(2_000L)).desiredConfigVersion(9L)
                .appliedConfigVersion(9L).build();

        assertNull(SelfHostedNodeInstallService.installationPendingReason(ready, startedAt));

        ready.setAgentVersion("1.5.11");
        assertEquals("节点仍在运行旧版 Agent 1.5.11",
                SelfHostedNodeInstallService.installationPendingReason(ready, startedAt));

        ready.setAgentVersion(SelfHostedNodeInstallService.CURRENT_AGENT_VERSION);
        ready.setAppliedConfigVersion(8L);
        assertEquals("等待端口转发配置下发完成",
                SelfHostedNodeInstallService.installationPendingReason(ready, startedAt));
    }

    @Test
    void installRequiresStreamModuleBeforeReportingSuccess() {
        String command = SelfHostedNodeInstallService.installCommand();

        int streamValidation = command.lastIndexOf("install_nginx_stream_module");
        int installAgent = command.indexOf("install -m 700 /tmp/kuocai-edge-agent.py");

        assertTrue(command.contains("libnginx-mod-stream"));
        assertTrue(command.contains("nginx-mod-stream"));
        assertTrue(command.contains("nginx-module-stream"));
        assertTrue(command.contains("nginx -t"));
        assertTrue(command.contains("stream {}"));
        assertTrue(command.contains("nginx -t -c"));
        assertTrue(command.contains("exit 15"));
        assertFalse(command.contains("install nginx-mod-stream || true"));
        assertTrue(streamValidation >= 0);
        assertTrue(installAgent > streamValidation);
    }
}
