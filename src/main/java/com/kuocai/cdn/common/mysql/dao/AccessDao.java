package com.kuocai.cdn.common.mysql.dao;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.kuocai.cdn.common.mysql.entity.Access;
import org.springframework.stereotype.Repository;

/**
 * 用户访问轨迹数据库访问层
 */
@Repository
public interface AccessDao extends BaseMapper<Access> {
}
