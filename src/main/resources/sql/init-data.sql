-- ============================================================
-- Multi-Cloud CDN - Bootstrap data for an empty install
-- Run on your database server AFTER multi-cloud-cdn-empty-install.sql:
--   mysql -h <host> -u <user> -p multi_cloud_cdn < multi-cloud-cdn-empty-install.sql
--   mysql -h <host> -u <user> -p multi_cloud_cdn < init-data.sql
-- Sandbox provider credentials let the CDN client beans initialize
-- without real keys; replace them in System Settings afterwards.
-- ============================================================

UPDATE `sys_config`
SET `config_content` = '{"projectName":"","accessKeyId":"test-aliyun-ak","accessKeySecret":"test-aliyun-sk"}'
WHERE `biz_type` = 'aliyun_cdn_config';

UPDATE `sys_config`
SET `config_content` = '{"accessKeyId":"test-baidu-ak","secretAccessKey":"test-baidu-sk"}'
WHERE `biz_type` = 'baidu_cdn_config';

UPDATE `sys_user`
SET `email` = 'admin@kuocai.local', `phone` = '13800000000'
WHERE `user_name` = 'admin';
