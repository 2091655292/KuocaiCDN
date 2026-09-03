package com.kuocai.cdn.schedule;

import com.kuocai.cdn.entity.CdnDomain;
import com.kuocai.cdn.service.CdnDomainService;
import com.kuocai.cdn.service.SelfHostedCdnService;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SelfHostedDomainComplianceTaskTest {

    @Test
    void oneProbeFailureDoesNotPreventTheRemainingDomainsFromBeingChecked() throws Exception {
        CdnDomain first = CdnDomain.builder().id(1L).domainName("first.example.com")
                .route("self_hosted_mainland").domainStatus("online").build();
        CdnDomain second = CdnDomain.builder().id(2L).domainName("second.example.com")
                .route("self_hosted_mainland").domainStatus("online").build();
        SelfHostedCdnService selfHostedCdnService = mock(SelfHostedCdnService.class);
        when(selfHostedCdnService.pauseIfAliyunIcpBlocked(first))
                .thenThrow(new IllegalStateException("temporary probe failure"));
        SelfHostedDomainComplianceTask task = new SelfHostedDomainComplianceTask(
                mock(CdnDomainService.class), selfHostedCdnService);

        task.inspectBatch(Arrays.asList(first, second));

        verify(selfHostedCdnService).pauseIfAliyunIcpBlocked(first);
        verify(selfHostedCdnService).pauseIfAliyunIcpBlocked(second);
    }
}
