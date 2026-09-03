package com.kuocai.cdn.dto;

import lombok.Data;

import java.util.List;

@Data
public class SelfHostedStatisticsBatchRequest {
    private String batchId;
    private List<SelfHostedDomainMetricDelta> metrics;
}
