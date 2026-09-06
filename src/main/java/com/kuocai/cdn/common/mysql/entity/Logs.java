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
 * 后端日志（原 MongoDB logs 集合迁移至 MySQL）
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@TableName("mc_logs")
public class Logs implements Serializable {

    /**
     * 主键ID
     */
    @TableId(type = IdType.AUTO)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;

    /**
     * 日志级别
     */
    private String level;

    /**
     * 记录器名称
     */
    private String logger;

    /**
     * 链路追踪ID
     */
    private String traceId;

    /**
     * 线程名
     */
    private String thread;

    /**
     * 日志内容
     */
    private String message;

    /**
     * 调用位置
     */
    private String callerData;

    /**
     * 异常信息
     */
    private String throwableProxy;

    /**
     * 时间戳（毫秒）
     */
    private Long timestamp;
}
