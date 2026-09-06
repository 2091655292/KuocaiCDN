package com.kuocai.cdn.controller.login;

import com.kuocai.cdn.controller.base.BaseController;
import com.kuocai.cdn.dto.resp.RespResult;
import com.kuocai.cdn.entity.SysUser;
import com.kuocai.cdn.exception.BusinessException;
import com.kuocai.cdn.service.SysUserService;
import com.kuocai.cdn.util.Assert;
import com.kuocai.cdn.util.AdminPathUtils;
import com.kuocai.cdn.util.GeetestUtils;
import com.kuocai.cdn.util.ValidatorUtils;
import com.kuocai.cdn.vo.SysUserVo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import javax.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.Map;

/**
 * 登录控制器
 *
 * @author XUEW
 * @date 下午9:00 2023/2/12
 */
@Slf4j
@Controller
@Scope(value = "session")
public class LoginController extends BaseController {

    LoginController(SysUserService userService) {
        this.userService = userService;
    }

    private final SysUserService userService;

    /**
     * 管理员登录
     *
     * @param userVo 登录信息
     * @return 响应
     */
    @ResponseBody
    @PostMapping("/login/loginAdmin")
    public RespResult loginAdmin(SysUserVo userVo, HttpServletRequest request) {
        if (Assert.isEmpty(userVo.getUserAccount())) {
            return RespResult.paramEmpty("账户");
        }
        if (Assert.isEmpty(userVo.getUserPwd())) {
            return RespResult.paramEmpty("密码");
        }
        userVo.setRoleId(1L);
        try {
            String token = userService.loginUser(userVo, request);
            addAuthCookie(token, Boolean.TRUE.equals(userVo.getRemember()), request);
            return RespResult.success("登录成功", "/dashboard");
        } catch (BusinessException e) {
            return RespResult.fail(e.getMessage());
        }
    }

    /**
     * 普通用户登录
     *
     * @param userVo 登录信息
     * @return 响应
     */
    @ResponseBody
    @PostMapping("/login/loginUser")
    public RespResult loginUser(SysUserVo userVo, HttpServletRequest request) {
        if (Assert.isEmpty(userVo.getUserAccount())) {
            return RespResult.paramEmpty("账户");
        }
        if (Assert.isEmpty(userVo.getUserPwd())) {
            return RespResult.paramEmpty("密码");
        }
        userVo.setRoleId(2L);
        try {
            String token = userService.loginUser(userVo, request);
            addAuthCookie(token, Boolean.TRUE.equals(userVo.getRemember()), request);
            return RespResult.success("登录成功");
        } catch (BusinessException e) {
            return RespResult.fail(e.getMessage());
        }
    }

    /**
     * 退出登录
     */
    @ResponseBody
    @PostMapping("/logout")
    public RespResult logout(HttpServletRequest request) {
        revokeAuthToken(request);
        try {
            session.invalidate();
        } catch (Exception e) {
            log.error("销毁Session失败，错误原因：{}", e.getMessage());
        }
        log.info("用户退出登录，用户[{}]", loginUserId);
        return RespResult.success("退出登录成功");
    }

    /**
     * 获取登录密码
     */
    @PostMapping("/login/getPassword")
    @ResponseBody
    public RespResult getPassword(String userAccount, String verify) {
        if (!GeetestUtils.validate(verify)) {
            return RespResult.fail("人机验证失败，请重试");
        }
        if (Assert.isEmpty(userAccount)) {
            return RespResult.fail("账户信息不可为空");
        }
        try {
            sysUserService.sendPassword(userAccount);
        } catch (BusinessException e) {
            return RespResult.fail(e.getMessage());
        }
        return RespResult.success("我们已将您的登录密码发送至 " + userAccount + ", 请注意查收");
    }

    /**
     * 忘记密码
     */
    @GetMapping("/forget")
    public String forget(Map<String, Object> map) {
        return "user/forget";
    }

    /**
     * 注册页面
     */
    @GetMapping("/register")
    public String register(String code, Map<String, Object> map) {
        if (Assert.notEmpty(code)) {
            map.put("code", code);
        }
        return "user/register";
    }


    /**
     * 邮箱注册页面
     */
    @GetMapping("/register-email")
    public String registerEmail(String code, Map<String, Object> map) {
        if (Assert.notEmpty(code)) {
            map.put("code", code);
        }
        return "user/register-email";
    }


    /**
     * 管理员-登录
     */
    @GetMapping("/kuocaiadmin")
    public String adminLogin(Map<String, Object> map) {
        if (!AdminPathUtils.DEFAULT_PATH.equals(AdminPathUtils.configuredPath())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return "admin/login";
    }

    @GetMapping("/{adminPath:[a-z0-9][a-z0-9_-]+}")
    public String customAdminLogin(@PathVariable String adminPath, Map<String, Object> map) {
        if (AdminPathUtils.DEFAULT_PATH.equals(adminPath)
                || !AdminPathUtils.configuredPath().equals(adminPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return "admin/login";
    }

    /**
     * 普通用户-登陆
     */
    @GetMapping("/user-login")
    public String userLogin(String callback, Map<String, Object> map) {
        map.put("callback", sanitizeCallback(callback));
        return "user/login";
    }

    private String sanitizeCallback(String callback) {
        if (Assert.isEmpty(callback)) {
            return null;
        }
        String value = callback.trim();
        if (value.startsWith("//") || value.contains("\\") || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            return null;
        }
        try {
            URI uri = URI.create(value);
            if (uri.isAbsolute() || uri.getRawAuthority() != null) {
                return null;
            }
        } catch (IllegalArgumentException e) {
            return null;
        }
        return value;
    }

    /**
     * 验证手机号
     */
    @GetMapping("/api/verify/phone")
    @ResponseBody
    public RespResult verifyPhone() {
        if (Assert.isEmpty(loginUser)) {
            return RespResult.fail("请先登录，再进行操作");
        }
        String phone = loginUser.getPhone();
        if (Assert.isEmpty(phone)) {
            return RespResult.success("请绑定手机号码");
        }
        return RespResult.success("已绑定手机号码");
    }
}
