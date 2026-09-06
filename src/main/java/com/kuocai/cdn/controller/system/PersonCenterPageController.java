package com.kuocai.cdn.controller.system;

import com.kuocai.cdn.controller.base.BaseController;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

import java.util.Map;

/**
 * 个人中心页面跳转控制器
 *
 * @author XUEW
 * @date 下午9:00 2023/2/12
 */
@Slf4j
@Controller
@Scope(value = "session")
public class PersonCenterPageController extends BaseController {

    /**
     * 账号信息
     */
    @GetMapping("/user-info")
    public String userInfo(Map<String, Object> map) {
        return "admin/user/user-info";
    }
}
