package com.kuocai.cdn.service.domain.statistics;

import cn.hutool.core.date.DateTime;
import cn.hutool.core.date.DateUnit;
import cn.hutool.core.date.DateUtil;
import com.alibaba.fastjson.JSONObject;
import com.kuocai.cdn.service.CdnDomainStatisticsService;
import com.kuocai.cdn.service.SelfHostedDomainStatisticsStorageService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class SelfHostedDomainStatisticsServiceImpl implements ICdnStatisticsPlatformService {
    private final CdnDomainStatisticsService statisticsService;
    private final SelfHostedDomainStatisticsStorageService storageService;

    public SelfHostedDomainStatisticsServiceImpl(CdnDomainStatisticsService statisticsService,
                                                 SelfHostedDomainStatisticsStorageService storageService) {
        this.statisticsService = statisticsService;
        this.storageService = storageService;
    }

    @Override
    public Object queryResourceStatistics(String domainName, DateTime start, DateTime end) {
        Series series = loadSeries(domainName, start, end);
        JSONObject detail = new JSONObject();
        detail.put("flux", series.edgeBytes);
        detail.put("bw", series.bandwidth);
        detail.put("bs_flux", series.originBytes);
        detail.put("bs_bw", series.originBandwidth);
        JSONObject summary = new JSONObject();
        summary.put("flux", sum(series.edgeBytes));
        summary.put("bw", max(series.bandwidth));
        summary.put("bs_flux", sum(series.originBytes));
        summary.put("bs_bw", max(series.originBandwidth));
        JSONObject result = new JSONObject();
        result.put("resource_detail", detail);
        result.put("resource_summary", summary);
        return result;
    }

    @Override
    public Object queryVisitsStatistics(String domainName, DateTime start, DateTime end) {
        Series series = loadSeries(domainName, start, end);
        JSONObject detail = new JSONObject();
        detail.put("req_num", series.requests);
        detail.put("hit_flux", series.hitBytes);
        detail.put("hit_num", series.hits);
        JSONObject summary = new JSONObject();
        summary.put("req_num", sum(series.requests));
        summary.put("hit_flux", sum(series.hitBytes));
        summary.put("hit_num", sum(series.hits));
        JSONObject result = new JSONObject();
        result.put("visits_detail", detail);
        result.put("visits_summary", summary);
        return result;
    }

    @Override
    public Object queryHttpCodeStatusStatistics(String domainName, DateTime start, DateTime end) {
        Series series = loadSeries(domainName, start, end);
        JSONObject result = new JSONObject();
        result.put("status_detail", series.status);
        result.put("status_summary", series.status.stream().map(SelfHostedDomainStatisticsServiceImpl::sum)
                .collect(Collectors.toList()));
        result.put("bs_status_detail", series.originStatus);
        result.put("bs_status_summary", series.originStatus.stream().map(SelfHostedDomainStatisticsServiceImpl::sum)
                .collect(Collectors.toList()));
        return result;
    }

    @Override
    public Object queryTopUri(String domainName, DateTime start, DateTime end) {
        JSONObject result = new JSONObject();
        result.put("fluxResult", Collections.emptyList());
        result.put("reqNumResult", Collections.emptyList());
        return result;
    }

    private Series loadSeries(String domainName, DateTime start, DateTime end) {
        int points = statisticsService.getLabels(start, end).size();
        Series result = new Series(points);
        if (points == 0) {
            return result;
        }
        boolean daily = DateUtil.between(start, end, DateUnit.DAY) > 1;
        List<String> domains = Arrays.stream(domainName == null ? new String[0] : domainName.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .collect(Collectors.toList());
        for (SelfHostedDomainStatisticsStorageService.MetricAggregate metric :
                storageService.aggregate(domains, start, end)) {
            int index = (int) DateUtil.between(start, metric.getBucketStart(),
                    daily ? DateUnit.DAY : DateUnit.HOUR);
            if (index < 0 || index >= points) {
                continue;
            }
            add(result.edgeBytes, index, metric.getEdgeBytes());
            add(result.originBytes, index, metric.getOriginBytes());
            add(result.hitBytes, index, metric.getHitBytes());
            peak(result.bandwidth, index, metric.getPeakBandwidthBps());
            peak(result.originBandwidth, index, metric.getPeakOriginBandwidthBps());
            add(result.requests, index, metric.getRequestCount());
            add(result.hits, index, metric.getHitCount());
            add(result.status.get(0), index, metric.getStatus2xx());
            add(result.status.get(1), index, metric.getStatus3xx());
            add(result.status.get(2), index, metric.getStatus4xx());
            add(result.status.get(3), index, metric.getStatus5xx());
            add(result.originStatus.get(0), index, metric.getOriginStatus2xx());
            add(result.originStatus.get(1), index, metric.getOriginStatus3xx());
            add(result.originStatus.get(2), index, metric.getOriginStatus4xx());
            add(result.originStatus.get(3), index, metric.getOriginStatus5xx());
        }
        return result;
    }

    private static void add(List<Long> values, int index, long value) {
        values.set(index, values.get(index) + Math.max(0, value));
    }

    private static void peak(List<Long> values, int index, long value) {
        values.set(index, Math.max(values.get(index), Math.max(0, value)));
    }

    private static long sum(List<Long> values) {
        return values.stream().mapToLong(Long::longValue).sum();
    }

    private static long max(List<Long> values) {
        return values.stream().mapToLong(Long::longValue).max().orElse(0L);
    }

    private static List<Long> zeros(int points) {
        return new ArrayList<>(Collections.nCopies(points, 0L));
    }

    private static final class Series {
        private final List<Long> edgeBytes;
        private final List<Long> originBytes;
        private final List<Long> hitBytes;
        private final List<Long> bandwidth;
        private final List<Long> originBandwidth;
        private final List<Long> requests;
        private final List<Long> hits;
        private final List<List<Long>> status;
        private final List<List<Long>> originStatus;

        private Series(int points) {
            edgeBytes = zeros(points);
            originBytes = zeros(points);
            hitBytes = zeros(points);
            bandwidth = zeros(points);
            originBandwidth = zeros(points);
            requests = zeros(points);
            hits = zeros(points);
            status = Arrays.asList(zeros(points), zeros(points), zeros(points), zeros(points));
            originStatus = Arrays.asList(zeros(points), zeros(points), zeros(points), zeros(points));
        }
    }
}
