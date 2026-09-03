package com.kuocai.cdn.template;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DataBoardTemplateTest {

    @Test
    void administratorUserSelectorKeepsIndependentSearchInitialization() throws Exception {
        String template = readTemplate();

        assertTrue(template.contains("class=\"data-board-user-select js-datatable-filter"));
        assertTrue(template.contains("HSCore.components.HSTomSelect.init('.data-board-user-select')"));
        assertTrue(template.contains("\"searchInDropdown\": true"));
        assertTrue(template.contains("\"searchField\": [\"text\"]"));
        assertTrue(template.contains("\"hideSearch\": false"));
        assertTrue(template.contains("document.addEventListener('DOMContentLoaded', initializeDataBoardUserSelect"));
        assertFalse(template.contains("id=\"dataUserId\" class=\"js-select"));
    }

    @Test
    void domainSelectionReloadsCurrentStatisticsRange() throws Exception {
        String template = readTemplate();

        assertTrue(template.contains("window.reloadDataBoardStatistics = function()"));
        assertTrue(template.contains("picker.startDate.clone(), picker.endDate.clone()"));
        assertTrue(template.contains("window.reloadDataBoardStatistics();"));
    }

    @Test
    void statisticsOnlyApplyLatestRequestAndClearMissingStatusData() throws Exception {
        String template = readTemplate();

        assertTrue(template.contains("const requestId = ++statisticsRequestId"));
        assertTrue(template.contains("requestId !== statisticsRequestId"));
        assertTrue(template.contains("requestId === statisticsRequestId"));
        assertTrue(template.contains("const d = normalizeSeries(httpCodeStatus.status_summary, 4)"));
        assertTrue(template.contains("normalizeSeries(httpCodeStatus.status_detail?.[0], labels.length)"));
    }

    private String readTemplate() throws Exception {
        return new String(Files.readAllBytes(Paths.get(
                "src/main/resources/templates/admin/data-board.html")), StandardCharsets.UTF_8);
    }
}
