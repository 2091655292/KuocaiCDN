package com.kuocai.cdn.common.mysql.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 用户访问轨迹（原 MongoDB access 集合迁移至 MySQL）
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@TableName("mc_access")
public class Access implements Serializable {

    /**
     * 主键ID
     */
    @TableId(type = IdType.AUTO)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;

    /**
     * 用户ID
     */
    private Long userId;

    /**
     * 链路追踪ID
     */
    private String trackId;

    /**
     * 客户端IP
     */
    private String ip;

    /**
     * 请求方法
     */
    private String method;

    /**
     * 请求路径
     */
    private String url;

    /**
     * 请求参数
     */
    private String params;

    /**
     * User-Agent
     */
    private String ua;

    /**
     * Referer
     */
    private String referer;

    /**
     * 请求时间戳（毫秒）
     */
    private Long time;
}
