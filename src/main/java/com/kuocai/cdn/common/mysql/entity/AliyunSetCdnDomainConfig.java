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
 * 阿里云域名配置异步任务（原 MongoDB aliyun_set_cdn_domain_config 集合迁移至 MySQL）
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@TableName("mc_aliyun_set_cdn_domain_config")
public class AliyunSetCdnDomainConfig implements Serializable {

    public AliyunSetCdnDomainConfig(String domain, String functionNames, String functions) {
        this.domain = domain;
        this.functionNames = functionNames;
        this.functions = functions;
        this.promise = "pending";
    }

    /**
     * 主键ID
     */
    @TableId(type = IdType.AUTO)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;

    /**
     * 域名（多个逗号分隔）
     */
    private String domain;

    /**
     * 配置功能名称（多个逗号分隔）
     */
    private String functionNames;

    /**
     * 配置内容 JSON
     */
    private String functions;

    /**
     * 任务状态 promise
     * rejected: 拒绝
     * resolved: 解决
     * pending: 待处理 (默认)
     * cancel: 取消
     */
    private String promise;
}
