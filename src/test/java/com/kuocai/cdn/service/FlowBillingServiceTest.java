package com.kuocai.cdn.service;

import com.alibaba.fastjson.JSONObject;
import com.kuocai.cdn.common.mongo.entity.FlowBillingLogic;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FlowBillingServiceTest {

    @Test
    void extractsFlowFromNestedResourceResponse() {
        JSONObject response = JSONObject.parseObject(
                "{\"Resource\":{\"resource_summary\":{\"access_flux_byte\":36132783104,\"bs_flux_byte\":1024}}}"
        );

        assertEquals(36132783104L, FlowBillingService.extractUsedFlow(response));
    }

    @Test
    void extractsFlowFromDirectResourceResponseWithLegacyField() {
        JSONObject response = JSONObject.parseObject(
                "{\"resource_summary\":{\"flux_byte\":1024}}"
        );

        assertEquals(1024L, FlowBillingService.extractUsedFlow(response));
    }

    @Test
    void doesNotBillOriginFlowBytes() {
        JSONObject response = JSONObject.parseObject(
                "{\"resource_summary\":{\"flux_byte\":1024,\"bs_flux_byte\":2048}}"
        );

        assertEquals(1024L, FlowBillingService.extractUsedFlow(response));
    }

    @Test
    void returnsZeroWhenFlowSummaryIsMissing() {
        assertEquals(0L, FlowBillingService.extractUsedFlow(new JSONObject()));
    }

    @Test
    void migratesLegacyAggregateSummaryWithoutRebillingIt() {
        FlowBillingLogic logic = new FlowBillingLogic();
        logic.setSummary(150L);
        logic.setRouteSummaries(null);
        Map<String, Long> observed = new LinkedHashMap<>();
        observed.put("aliyun", 100L);
        observed.put("self_hosted_mainland", 100L);

        Map<String, Long> migrated = FlowBillingService.initializeRouteSummaries(logic, observed);

        assertEquals(100L, migrated.get("aliyun"));
        assertEquals(50L, migrated.get("self_hosted_mainland"));
    }
}
