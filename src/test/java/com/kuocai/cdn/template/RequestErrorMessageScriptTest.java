package com.kuocai.cdn.template;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertTrue;

class RequestErrorMessageScriptTest {

    @Test
    void malformedSuccessfulJsonUsesFriendlyRecoveryMessage() throws IOException {
        Path scriptPath = Paths.get("src/main/resources/static/common/custom.js");
        String script = new String(Files.readAllBytes(scriptPath), StandardCharsets.UTF_8);

        assertTrue(script.contains("xhr.status >= 200 && xhr.status < 300"));
        assertTrue(script.contains("服务器响应不完整，请稍后重试；系统会自动查询创建结果"));
        assertTrue(script.contains("/SyntaxError|parsererror|JSON/i"));
    }
}
