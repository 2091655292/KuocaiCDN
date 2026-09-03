package com.kuocai.cdn.service.domain.statistics;

import cn.hutool.core.date.DateTime;
import cn.hutool.core.date.DateUtil;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.kuocai.cdn.service.CdnDomainStatisticsService;
import com.kuocai.cdn.service.SelfHostedDomainStatisticsStorageService;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SelfHostedDomainStatisticsServiceImplTest {

    @Test
    void aggregatesReportedFiveMinuteMetricsIntoHourlyStatistics() {
        CdnDomainStatisticsService statisticsService = mock(CdnDomainStatisticsService.class);
        SelfHostedDomainStatisticsStorageService storageService =
                mock(SelfHostedDomainStatisticsStorageService.class);
        DateTime start = DateUtil.parse("2026-07-26 00:00:00");
        DateTime end = DateUtil.parse("2026-07-26 02:00:00");
        when(statisticsService.getLabels(any(DateTime.class), any(DateTime.class)))
                .thenReturn(Arrays.asList("0-1", "1-2"));
        when(storageService.aggregate(anyList(), any(Date.class), any(Date.class))).thenReturn(Arrays.asList(
                metric("2026-07-26 00:05:00", 100, 40, 60, 1_000, 400, 2, 1,
                        2, 0, 0, 0, 1, 0, 1, 0, 0),
                metric("2026-07-26 00:10:00", 200, 80, 120, 3_000, 800, 3, 2,
                        2, 1, 0, 0, 1, 1, 0, 0, 0),
                metric("2026-07-26 01:05:00", 50, 10, 40, 500, 100, 1, 1,
                        1, 0, 0, 0, 1, 0, 0, 0, 0)
        ));
        SelfHostedDomainStatisticsServiceImpl service =
                new SelfHostedDomainStatisticsServiceImpl(statisticsService, storageService);

        JSONObject resource = (JSONObject) service.queryResourceStatistics("xz.kktnn.cn", start, end);
        JSONObject visits = (JSONObject) service.queryVisitsStatistics("xz.kktnn.cn", start, end);
        JSONObject status = (JSONObject) service.queryHttpCodeStatusStatistics("xz.kktnn.cn", start, end);

        assertEquals(350L, resource.getJSONObject("resource_summary").getLongValue("flux"));
        assertEquals(3_000L, resource.getJSONObject("resource_summary").getLongValue("bw"));
        assertEquals(Arrays.asList(300L, 50L), resource.getJSONObject("resource_detail")
                .getJSONArray("flux").toJavaList(Long.class));
        assertEquals(6L, visits.getJSONObject("visits_summary").getLongValue("req_num"));
        assertEquals(Arrays.asList(5L, 1L), visits.getJSONObject("visits_detail")
                .getJSONArray("req_num").toJavaList(Long.class));
        JSONArray statusSummary = status.getJSONArray("status_summary");
        assertEquals(5L, statusSummary.getLongValue(0));
        assertEquals(1L, statusSummary.getLongValue(1));
    }

    private SelfHostedDomainStatisticsStorageService.MetricAggregate metric(
            String time, long edge, long origin, long hitBytes, long bandwidth,
            long originBandwidth, long requests, long hits,
            long status2xx, long status3xx, long status4xx, long status5xx,
            long origin2xx, long origin3xx, long origin4xx, long origin5xx,
            long originFailures) {
        return new SelfHostedDomainStatisticsStorageService.MetricAggregate(
                DateUtil.parse(time), edge, origin, hitBytes, bandwidth, originBandwidth,
                requests, hits, requests - hits, originFailures,
                status2xx, status3xx, status4xx, status5xx,
                origin2xx, origin3xx, origin4xx, origin5xx);
    }
}
