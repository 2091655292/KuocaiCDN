package com.kuocai.cdn.common.mysql.dao;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kuocai.cdn.common.mysql.entity.Logs;
import org.springframework.stereotype.Repository;

/**
 * 后端日志数据库访问层
 */
@Repository
public interface LogsDao extends BaseMapper<Logs> {
}
