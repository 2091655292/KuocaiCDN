package com.kuocai.cdn.service;

import com.kuocai.cdn.dto.SelfHostedDomainMetricDelta;
import com.kuocai.cdn.dto.SelfHostedStatisticsBatchRequest;
import com.kuocai.cdn.exception.BusinessException;
import lombok.AllArgsConstructor;
import lombok.Data;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class SelfHostedDomainStatisticsStorageService {
    private static final int MAX_METRICS_PER_BATCH = 2_000;
    private static final long METRIC_RETENTION_MS = 90L * 24 * 60 * 60 * 1000;
    private static final long BATCH_RETENTION_MS = 7L * 24 * 60 * 60 * 1000;
    private static final long FIVE_MINUTES_MS = 5L * 60 * 1000;
    private static final Pattern BATCH_ID = Pattern.compile("[a-f0-9]{64}");
    private static final Pattern DOMAIN_NAME = Pattern.compile("[a-z0-9.-]{1,253}");

    private static final String UPSERT_SQL =
            "INSERT INTO self_hosted_domain_metric (node_id,domain_name,bucket_start," +
                    "edge_bytes,origin_bytes,hit_bytes,peak_bandwidth_bps,peak_origin_bandwidth_bps," +
                    "request_count,hit_count,origin_request_count,origin_failure_count," +
                    "status_2xx,status_3xx,status_4xx,status_5xx," +
                    "origin_status_2xx,origin_status_3xx,origin_status_4xx,origin_status_5xx) " +
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
                    "ON DUPLICATE KEY UPDATE " +
                    "edge_bytes=edge_bytes+VALUES(edge_bytes),origin_bytes=origin_bytes+VALUES(origin_bytes)," +
                    "hit_bytes=hit_bytes+VALUES(hit_bytes)," +
                    "peak_bandwidth_bps=GREATEST(peak_bandwidth_bps,VALUES(peak_bandwidth_bps))," +
                    "peak_origin_bandwidth_bps=GREATEST(peak_origin_bandwidth_bps,VALUES(peak_origin_bandwidth_bps))," +
                    "request_count=request_count+VALUES(request_count),hit_count=hit_count+VALUES(hit_count)," +
                    "origin_request_count=origin_request_count+VALUES(origin_request_count)," +
                    "origin_failure_count=origin_failure_count+VALUES(origin_failure_count)," +
                    "status_2xx=status_2xx+VALUES(status_2xx),status_3xx=status_3xx+VALUES(status_3xx)," +
                    "status_4xx=status_4xx+VALUES(status_4xx),status_5xx=status_5xx+VALUES(status_5xx)," +
                    "origin_status_2xx=origin_status_2xx+VALUES(origin_status_2xx)," +
                    "origin_status_3xx=origin_status_3xx+VALUES(origin_status_3xx)," +
                    "origin_status_4xx=origin_status_4xx+VALUES(origin_status_4xx)," +
                    "origin_status_5xx=origin_status_5xx+VALUES(origin_status_5xx)";

    private final JdbcTemplate jdbcTemplate;

    public SelfHostedDomainStatisticsStorageService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public boolean ingest(Long nodeId, SelfHostedStatisticsBatchRequest request) throws BusinessException {
        if (nodeId == null || request == null || request.getBatchId() == null
                || !BATCH_ID.matcher(request.getBatchId()).matches()) {
            throw new BusinessException("自建 CDN 统计批次格式不正确");
        }
        int inserted = jdbcTemplate.update(
                "INSERT IGNORE INTO self_hosted_statistics_batch (node_id,batch_id) VALUES (?,?)",
                nodeId, request.getBatchId());
        if (inserted == 0) {
            return false;
        }
        List<NormalizedMetric> metrics = normalizeMetrics(request.getMetrics());
        if (!metrics.isEmpty()) {
            jdbcTemplate.batchUpdate(UPSERT_SQL, new BatchPreparedStatementSetter() {
                @Override
                public void setValues(PreparedStatement statement, int index) throws SQLException {
                    NormalizedMetric metric = metrics.get(index);
                    int column = 1;
                    statement.setLong(column++, nodeId);
                    statement.setString(column++, metric.domainName);
                    statement.setTimestamp(column++, new Timestamp(metric.bucketStart));
                    for (long value : metric.values) {
                        statement.setLong(column++, value);
                    }
                }

                @Override
                public int getBatchSize() {
                    return metrics.size();
                }
            });
        }
        return true;
    }

    public List<MetricAggregate> aggregate(List<String> domainNames, Date start, Date end) {
        List<String> domains = domainNames == null ? Collections.emptyList() : domainNames.stream()
                .map(this::normalizeDomain)
                .filter(value -> value != null)
                .distinct()
                .collect(Collectors.toList());
        if (domains.isEmpty() || start == null || end == null || !start.before(end)) {
            return Collections.emptyList();
        }
        String placeholders = domains.stream().map(value -> "?").collect(Collectors.joining(","));
        String sql = "SELECT bucket_start," +
                "SUM(edge_bytes),SUM(origin_bytes),SUM(hit_bytes)," +
                "ROUND(SUM(edge_bytes)*8/300),ROUND(SUM(origin_bytes)*8/300)," +
                "SUM(request_count),SUM(hit_count)," +
                "SUM(origin_request_count),SUM(origin_failure_count)," +
                "SUM(status_2xx),SUM(status_3xx),SUM(status_4xx),SUM(status_5xx)," +
                "SUM(origin_status_2xx),SUM(origin_status_3xx),SUM(origin_status_4xx),SUM(origin_status_5xx) " +
                "FROM self_hosted_domain_metric WHERE domain_name IN (" + placeholders + ") " +
                "AND bucket_start>=? AND bucket_start<? GROUP BY bucket_start ORDER BY bucket_start";
        List<Object> arguments = new ArrayList<>(domains);
        arguments.add(start);
        arguments.add(end);
        return jdbcTemplate.query(sql, arguments.toArray(), (resultSet, rowNum) ->
                new MetricAggregate(resultSet.getTimestamp(1),
                        resultSet.getLong(2), resultSet.getLong(3), resultSet.getLong(4),
                        resultSet.getLong(5), resultSet.getLong(6), resultSet.getLong(7),
                        resultSet.getLong(8), resultSet.getLong(9), resultSet.getLong(10),
                        resultSet.getLong(11), resultSet.getLong(12), resultSet.getLong(13),
                        resultSet.getLong(14), resultSet.getLong(15), resultSet.getLong(16),
                        resultSet.getLong(17), resultSet.getLong(18)));
    }

    @Scheduled(cron = "0 35 4 * * ?")
    public void purgeExpired() {
        long now = System.currentTimeMillis();
        jdbcTemplate.update("DELETE FROM self_hosted_domain_metric WHERE bucket_start<?",
                new Date(now - METRIC_RETENTION_MS));
        jdbcTemplate.update("DELETE FROM self_hosted_statistics_batch WHERE create_time<?",
                new Date(now - BATCH_RETENTION_MS));
    }

    private List<NormalizedMetric> normalizeMetrics(List<SelfHostedDomainMetricDelta> source)
            throws BusinessException {
        if (source == null || source.isEmpty()) {
            return Collections.emptyList();
        }
        if (source.size() > MAX_METRICS_PER_BATCH) {
            throw new BusinessException("自建 CDN 统计批次过大");
        }
        long now = System.currentTimeMillis();
        List<NormalizedMetric> result = new ArrayList<>(source.size());
        for (SelfHostedDomainMetricDelta metric : source) {
            if (metric == null) {
                continue;
            }
            String domain = normalizeDomain(metric.getDomainName());
            long bucket = metric.getBucketStart() == null ? 0 : metric.getBucketStart();
            bucket = bucket / FIVE_MINUTES_MS * FIVE_MINUTES_MS;
            if (domain == null || bucket < now - METRIC_RETENTION_MS || bucket > now + FIVE_MINUTES_MS) {
                continue;
            }
            result.add(new NormalizedMetric(domain, bucket, new long[]{
                    safe(metric.getEdgeBytes()), safe(metric.getOriginBytes()), safe(metric.getHitBytes()),
                    safe(metric.getPeakBandwidthBps()), safe(metric.getPeakOriginBandwidthBps()),
                    safe(metric.getRequestCount()), safe(metric.getHitCount()),
                    safe(metric.getOriginRequestCount()), safe(metric.getOriginFailureCount()),
                    safe(metric.getStatus2xx()), safe(metric.getStatus3xx()), safe(metric.getStatus4xx()),
                    safe(metric.getStatus5xx()), safe(metric.getOriginStatus2xx()),
                    safe(metric.getOriginStatus3xx()), safe(metric.getOriginStatus4xx()),
                    safe(metric.getOriginStatus5xx())
            }));
        }
        return result;
    }

    private String normalizeDomain(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        while (normalized.endsWith(".")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return DOMAIN_NAME.matcher(normalized).matches() ? normalized : null;
    }

    private static long safe(Long value) {
        return value == null ? 0 : Math.max(0, value);
    }

    private static final class NormalizedMetric {
        private final String domainName;
        private final long bucketStart;
        private final long[] values;

        private NormalizedMetric(String domainName, long bucketStart, long[] values) {
            this.domainName = domainName;
            this.bucketStart = bucketStart;
            this.values = values;
        }
    }

    @Data
    @AllArgsConstructor
    public static class MetricAggregate {
        private Date bucketStart;
        private long edgeBytes;
        private long originBytes;
        private long hitBytes;
        private long peakBandwidthBps;
        private long peakOriginBandwidthBps;
        private long requestCount;
        private long hitCount;
        private long originRequestCount;
        private long originFailureCount;
        private long status2xx;
        private long status3xx;
        private long status4xx;
        private long status5xx;
        private long originStatus2xx;
        private long originStatus3xx;
        private long originStatus4xx;
        private long originStatus5xx;
    }
}
