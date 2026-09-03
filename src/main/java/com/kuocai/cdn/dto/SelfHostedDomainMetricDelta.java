package com.kuocai.cdn.dto;

import lombok.Data;

@Data
public class SelfHostedDomainMetricDelta {
    private String domainName;
    private Long bucketStart;
    private Long edgeBytes;
    private Long originBytes;
    private Long hitBytes;
    private Long peakBandwidthBps;
    private Long peakOriginBandwidthBps;
    private Long requestCount;
    private Long hitCount;
    private Long originRequestCount;
    private Long originFailureCount;
    private Long status2xx;
    private Long status3xx;
    private Long status4xx;
    private Long status5xx;
    private Long originStatus2xx;
    private Long originStatus3xx;
    private Long originStatus4xx;
    private Long originStatus5xx;
}
