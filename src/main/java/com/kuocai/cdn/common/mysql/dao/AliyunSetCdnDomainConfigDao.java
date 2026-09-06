package com.kuocai.cdn.common.mysql.dao;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kuocai.cdn.common.mysql.entity.AliyunSetCdnDomainConfig;
import org.springframework.stereotype.Repository;

/**
 * 阿里云域名配置任务数据库访问层
 */
@Repository
public interface AliyunSetCdnDomainConfigDao extends BaseMapper<AliyunSetCdnDomainConfig> {
}
