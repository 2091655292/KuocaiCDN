-- ============================================================
-- Multi-Cloud CDN Management Platform - Empty Install Schema
-- Derived from KuocaiCDN K2.2.1.0, trimmed to multi-cloud core.
-- Storage: MySQL only (Redis kept as cache layer).
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


DROP TABLE IF EXISTS `cdn_domain`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cdn_domain` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `domain_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `domain_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `business_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `service_area` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `domain_status` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failure_reason` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tencent_dns_id` bigint(20) DEFAULT NULL,
  `route` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_huawei` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_volcengine` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_yifan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_tencent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_cdnetworks` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_aliyun` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_baidu` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_wangsu` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cname_kingsoft` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `cdn_domain` WRITE;
/*!40000 ALTER TABLE `cdn_domain` DISABLE KEYS */;
/*!40000 ALTER TABLE `cdn_domain` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `cache_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cache_task` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `task_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refresh_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cdn_supplier` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_id` bigint(20) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `cache_task` WRITE;
/*!40000 ALTER TABLE `cache_task` DISABLE KEYS */;
/*!40000 ALTER TABLE `cache_task` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `edgeone_root_domain_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `edgeone_root_domain_record` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) NOT NULL,
  `root_domain` varchar(255) NOT NULL,
  `first_domain_name` varchar(255) DEFAULT NULL,
  `cdn_domain_id` bigint(20) DEFAULT NULL,
  `status` varchar(32) DEFAULT 'active',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edgeone_user_root` (`user_id`,`root_domain`),
  KEY `idx_edgeone_root_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `edgeone_root_domain_record` WRITE;
/*!40000 ALTER TABLE `edgeone_root_domain_record` DISABLE KEYS */;
/*!40000 ALTER TABLE `edgeone_root_domain_record` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `operation_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `operation_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `user_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `module` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `service` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `op_describe` text COLLATE utf8mb4_unicode_ci,
  `request` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `response` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `method` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `url` text COLLATE utf8mb4_unicode_ci,
  `ip` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `deleted` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `operation_log` WRITE;
/*!40000 ALTER TABLE `operation_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `operation_log` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `sys_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sys_config` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `biz_type` varchar(128) DEFAULT NULL,
  `config_content` text,
  `create_by` bigint(20) DEFAULT NULL,
  `update_by` bigint(20) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_biz_type` (`biz_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `sys_config` WRITE;
/*!40000 ALTER TABLE `sys_config` DISABLE KEYS */;
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (1,'website_base_config','{\"websiteName\":\"CDN Management System\",\"websiteAnnouncement\":\"\",\"defaultFlowPrice\":100,\"icpNumber\":\"\",\"websiteIconImg\":\"\",\"defaultAvatarImg\":\"/common/default-avatar.png\",\"adminPath\":\"kuocaiadmin\",\"websiteLogoImg\":\"\",\"wechatQrCodeImg\":\"\",\"qqGroupQrCodeImg\":\"\",\"expireTime\":30,\"maxDomainCount\":10,\"defaultUserRoute\":\"tencent\",\"httpsRequestFeeEnabled\":false,\"httpsRequestFeeRoutes\":\"\",\"httpsRequestFeeUnitCount\":10000,\"httpsRequestFeeUnitPrice\":0}',1,1,'2026-08-16 00:00:00','2026-08-16 00:00:00');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (2,'website_permission_config','{\"forceRealAuthentication\":false,\"forceBindingTel\":false,\"closeRegister\":false}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (3,'website_agreement_config','{\"agreementInfo\":\"\"}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (4,'website_home_code_config','{\"enabled\":false,\"htmlCode\":\"\"}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (5,'website_footer_code_config','{\"enabled\":false,\"htmlCode\":\"\"}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (6,'website_seo_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (7,'website_contact_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (8,'website_access_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (19,'api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (20,'dns_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (21,'huawei_cloud_api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (22,'volcanic_cloud_api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (23,'white_mountain_cloud_api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (24,'tencent_cloud_api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (25,'tencent_edgeone_api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (26,'cdnetworks_api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (27,'aliyun_cdn_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (28,'wangsu_cdn_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (29,'baidu_cdn_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (30,'kingsoft_cdn_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
INSERT INTO `sys_config` (`id`, `biz_type`, `config_content`, `create_by`, `update_by`, `create_time`, `update_time`) VALUES (31,'merge_cdn_api_config','{}',1,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
/*!40000 ALTER TABLE `sys_config` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `sys_menu`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sys_menu` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `url` text COLLATE utf8mb4_unicode_ci,
  `type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `priority` int(11) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `sys_menu` WRITE;
/*!40000 ALTER TABLE `sys_menu` DISABLE KEYS */;
INSERT INTO `sys_menu` (`id`, `name`, `level`, `url`, `type`, `priority`, `create_time`, `update_time`) VALUES (2069465934986391554,'添加域名','1','/domain-list','only-main',96,'2026-06-24 01:01:42','2026-06-24 01:01:42');
INSERT INTO `sys_menu` (`id`, `name`, `level`, `url`, `type`, `priority`, `create_time`, `update_time`) VALUES (2069469164797603841,'数据统计','2','/data-board','only-main',95,'2026-06-24 01:14:32','2026-06-24 01:14:32');
INSERT INTO `sys_menu` (`id`, `name`, `level`, `url`, `type`, `priority`, `create_time`, `update_time`) VALUES (2069469285165740034,'操作日志','2','/operation-logs','only-main',94,'2026-06-24 01:15:01','2026-06-24 01:15:01');
INSERT INTO `sys_menu` (`id`, `name`, `level`, `url`, `type`, `priority`, `create_time`, `update_time`) VALUES (2073659778403348482,'站点管理','1','/domain-list','both',0,'2026-07-05 14:46:32','2026-07-05 14:46:32');
/*!40000 ALTER TABLE `sys_menu` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `sys_role`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sys_role` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `role_code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` text COLLATE utf8mb4_unicode_ci,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `sys_role` WRITE;
/*!40000 ALTER TABLE `sys_role` DISABLE KEYS */;
INSERT INTO `sys_role` (`id`, `role_code`, `role_name`, `remark`, `create_time`, `update_time`) VALUES (1,'admin','Admin','system init','2026-06-23 18:42:30','2026-06-23 18:42:30');
INSERT INTO `sys_role` (`id`, `role_code`, `role_name`, `remark`, `create_time`, `update_time`) VALUES (2,'user','User','system init','2026-06-23 18:42:30','2026-06-23 18:42:30');
/*!40000 ALTER TABLE `sys_role` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `sys_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sys_user` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `role_id` bigint(20) DEFAULT NULL,
  `flow_price` decimal(20,6) DEFAULT NULL,
  `virtual_rate` decimal(20,6) DEFAULT NULL,
  `max_domain_count` int(11) DEFAULT NULL,
  `user_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_pwd` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pwd_salt` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `real_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `id_card_num` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `my_website` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `img` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login_time` datetime DEFAULT NULL,
  `last_login_ip` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wechat_open_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qq_open_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `weibo_open_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `auto_balance` int(11) DEFAULT NULL,
  `route` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `enable_overseas` int(11) DEFAULT NULL,
  `enable_global` int(11) DEFAULT NULL,
  `referrer_id` bigint(20) DEFAULT NULL,
  `agent_user_id` bigint(20) DEFAULT NULL,
  `agent_level_id` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sys_user_email` (`email`),
  KEY `idx_sys_user_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `sys_user` WRITE;
/*!40000 ALTER TABLE `sys_user` DISABLE KEYS */;
INSERT INTO `sys_user` (`id`, `role_id`, `flow_price`, `virtual_rate`, `max_domain_count`, `user_name`, `user_pwd`, `pwd_salt`, `real_name`, `id_card_num`, `my_website`, `phone`, `email`, `img`, `status`, `create_time`, `update_time`, `last_login_time`, `last_login_ip`, `wechat_open_id`, `qq_open_id`, `weibo_open_id`, `auto_balance`, `route`, `enable_overseas`, `enable_global`, `referrer_id`, `agent_user_id`, `agent_level_id`) VALUES (1,1,100.000000,1.000000,1000,'admin','$2b$10$EjIZyC3VnbrGlSASV1gpx.KNtqHZRIU47Xw94hpzL.VRRgaP9hwI.',NULL,'System Administrator',NULL,NULL,NULL,NULL,'/common/default-avatar.png','certified','2026-07-17 23:38:33','2026-07-17 23:38:33',NULL,NULL,NULL,NULL,NULL,1,'tencent',0,0,NULL,NULL,NULL);
/*!40000 ALTER TABLE `sys_user` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `sys_user_account`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sys_user_account` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `user_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_balance` decimal(20,6) DEFAULT NULL,
  `amass_recharge` decimal(20,6) DEFAULT NULL,
  `status` int(11) DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `sys_user_account` WRITE;
/*!40000 ALTER TABLE `sys_user_account` DISABLE KEYS */;
INSERT INTO `sys_user_account` (`id`, `user_id`, `user_name`, `account_balance`, `amass_recharge`, `status`, `create_time`, `update_time`) VALUES (1,1,'admin',0.000000,0.000000,1,'2026-07-17 23:38:33','2026-07-17 23:38:33');
/*!40000 ALTER TABLE `sys_user_account` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `sys_user_banned`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sys_user_banned` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `user_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `banned_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `banned_time` datetime DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `sys_user_banned` WRITE;
/*!40000 ALTER TABLE `sys_user_banned` DISABLE KEYS */;
/*!40000 ALTER TABLE `sys_user_banned` ENABLE KEYS */;
UNLOCK TABLES;


-- ------------------------------------------------------------
-- EdgeOne quota order (migrated from entity definition)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `edgeone_domain_quota_order`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `edgeone_domain_quota_order` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `transaction_order_id` bigint(20) DEFAULT NULL,
  `quota_count` int(11) DEFAULT NULL,
  `deadline` datetime DEFAULT NULL,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

-- ------------------------------------------------------------
-- Aliyun domain config promises (formerly MongoDB aliyun_set_cdn_domain_config)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `mc_aliyun_set_cdn_domain_config`;
CREATE TABLE `mc_aliyun_set_cdn_domain_config` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `domain` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `function_names` text COLLATE utf8mb4_unicode_ci,
  `functions` mediumtext COLLATE utf8mb4_unicode_ci,
  `promise` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  PRIMARY KEY (`id`),
  KEY `idx_domain` (`domain`),
  KEY `idx_promise` (`promise`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- User access traces (formerly MongoDB access)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `mc_access`;
CREATE TABLE `mc_access` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) DEFAULT NULL,
  `track_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `method` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `params` text COLLATE utf8mb4_unicode_ci,
  `ua` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `referer` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `time` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_time` (`time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Backend logs (formerly MongoDB logs)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `mc_logs`;
CREATE TABLE `mc_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `level` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `logger` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `trace_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `thread` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` mediumtext COLLATE utf8mb4_unicode_ci,
  `caller_data` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `throwable_proxy` mediumtext COLLATE utf8mb4_unicode_ci,
  `timestamp` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_level` (`level`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;
