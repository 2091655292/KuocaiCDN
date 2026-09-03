package com.kuocai.cdn.controller.rest;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kuocai.cdn.dto.resp.RespResult;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CdnDomainControllerTest {

    private final CdnDomainController controller = new CdnDomainController(
            null, null, null, null, null, null);

    @Test
    void tencentCdnRecordNotVerifiedRequiresDomainVerifyModal() {
        Boolean result = ReflectionTestUtils.invokeMethod(
                controller,
                "isDomainVerifyRequired",
                "创建时发生错误，域名解析未进行验证 (errorCode=UnauthorizedOperation.CdnDomainRecordNotVerified, requestId=req-test)"
        );

        assertTrue(result);
    }

    @Test
    void genericUnauthorizedStillDoesNotOpenDomainVerifyModal() {
        Boolean result = ReflectionTestUtils.invokeMethod(
                controller,
                "isDomainVerifyRequired",
                "UnauthorizedOperation.CdnCamUnauthorized"
        );

        assertFalse(result);
    }

    @Test
    void edgeOneVerifyRecordResponseDoesNotContainJsonSelfReference() throws Exception {
        JSONObject firstRecord = new JSONObject();
        firstRecord.put("domainName", "example.com");
        firstRecord.put("recordType", "TXT");
        JSONArray records = new JSONArray();
        records.add(firstRecord);

        JSONObject result = CdnDomainController.buildVerifyRecordResult(records);

        assertNotSame(firstRecord, result);
        assertFalse(firstRecord.containsKey("verifyRecords"));
        String json = new ObjectMapper().writeValueAsString(
                RespResult.success("需要验证域名归属权", result));
        JsonNode root = new ObjectMapper().readTree(json);
        assertEquals("example.com", root.path("data").path("domainName").asText());
        assertEquals(1, root.path("data").path("verifyRecords").size());
        assertTrue(json.length() < 2048);
    }
}
