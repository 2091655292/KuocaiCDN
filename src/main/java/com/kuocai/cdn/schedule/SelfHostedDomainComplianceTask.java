package com.kuocai.cdn.schedule;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.kuocai.cdn.entity.CdnDomain;
import com.kuocai.cdn.enumeration.domainmerage.CdnRoute;
import com.kuocai.cdn.service.CdnDomainService;
import com.kuocai.cdn.service.SelfHostedCdnService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

@Slf4j
@Component
@Profile("prod")
public class SelfHostedDomainComplianceTask {

    private final CdnDomainService cdnDomainService;
    private final SelfHostedCdnService selfHostedCdnService;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public SelfHostedDomainComplianceTask(CdnDomainService cdnDomainService,
                                          SelfHostedCdnService selfHostedCdnService) {
        this.cdnDomainService = cdnDomainService;
        this.selfHostedCdnService = selfHostedCdnService;
    }

    @Scheduled(cron = "20 * * * * ?")
    public void inspectOnlineDomains() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        try {
            List<CdnDomain> domains = cdnDomainService.queryByWrapper(
                    new QueryWrapper<CdnDomain>()
                            .in("route", CdnRoute.selfHostedCodes())
                            .in("domain_status", "online", "configuring"));
            inspectBatch(domains);
        } catch (Exception e) {
            log.warn("Unable to query self-hosted domains for ICP compliance inspection: {}",
                    e.getMessage());
        } finally {
            running.set(false);
        }
    }

    void inspectBatch(List<CdnDomain> domains) {
        for (CdnDomain domain : domains == null ? Collections.<CdnDomain>emptyList() : domains) {
            try {
                selfHostedCdnService.pauseIfAliyunIcpBlocked(domain);
            } catch (Exception e) {
                log.debug("ICP compliance inspection skipped for {}: {}",
                        domain == null ? "unknown" : domain.getDomainName(), e.getMessage());
            }
        }
    }
}
