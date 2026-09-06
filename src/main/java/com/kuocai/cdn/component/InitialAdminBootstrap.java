package com.kuocai.cdn.component;

import com.kuocai.cdn.entity.SysUser;
import com.kuocai.cdn.service.SysUserService;
import com.kuocai.cdn.util.Assert;
import com.kuocai.cdn.util.JedisUtil;
import com.kuocai.cdn.util.PasswordUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;

@Slf4j
@Component
public class InitialAdminBootstrap implements ApplicationRunner {

    private final SysUserService userService;
    private final String bootstrapPassword;

    public InitialAdminBootstrap(SysUserService userService,
                                 @Value("${installation.bootstrap-password:}") String bootstrapPassword) {
        this.userService = userService;
        this.bootstrapPassword = bootstrapPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (Assert.isEmpty(bootstrapPassword)) {
            return;
        }
        List<SysUser> admins = userService.queryAllAdmins();
        if (Assert.isEmpty(admins)) {
            log.error("无法设置初始管理员密码：数据库中没有管理员账号");
            return;
        }
        SysUser admin = admins.get(0);
        admin.setUserPwd(PasswordUtils.hash(bootstrapPassword));
        admin.setPwdSalt(null);
        userService.save(admin);
        JedisUtil.delKey("user:" + admin.getId());
        log.info("初始管理员密码已写入，管理员账号：{}", admin.getUserName());
    }
}
