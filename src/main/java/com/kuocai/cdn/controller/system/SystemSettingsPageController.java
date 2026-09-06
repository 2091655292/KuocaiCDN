package com.kuocai.cdn.controller.system;

import com.kuocai.cdn.annotation.AuthorLimiter;
import com.kuocai.cdn.constant.ConfigBizTypeConstants;
import com.kuocai.cdn.controller.base.BaseController;
import com.kuocai.cdn.enumeration.domainmerage.CdnRoute;
import com.kuocai.cdn.service.CdnServiceAreaPolicyService;
import com.kuocai.cdn.util.SupportedVendorUtils;
import com.kuocai.cdn.util.RuntimeConfigUtils;
import com.kuocai.cdn.api.tencent.dns.properties.TencentDns;
import com.kuocai.cdn.util.WebsiteFooterCodeDefaults;
import com.kuocai.cdn.util.WebsiteHomeCodeDefaults;
import com.kuocai.cdn.vo.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 系统设置页面跳转控制器
 *
 * @author XUEW
 * @date 下午9:00 2023/2/12
 */
@Slf4j
@Controller
@Scope(value = "session")
public class SystemSettingsPageController extends BaseController {

    /**
     * 基本配置
     */
    @AuthorLimiter
    @GetMapping("website-setting")
    public String websiteSetting(Map<String, Object> map) {
        WebsiteBaseConfigVo websiteBaseConfig = sysConfigService.getConfigContentVo(WebsiteBaseConfigVo.class, ConfigBizTypeConstants.WEBSITE_BASE_CONFIG);
        WebsitePermissionConfigVo websitePermissionConfig = sysConfigService.getConfigContentVo(WebsitePermissionConfigVo.class, ConfigBizTypeConstants.WEBSITE_PERMISSION_CONFIG);
        WebsiteAgreementConfigVo websiteAgreementConfig = sysConfigService.getConfigContentVo(WebsiteAgreementConfigVo.class, ConfigBizTypeConstants.WEBSITE_AGREEMENT_CONFIG);
        WebsiteHomeCodeConfigVo websiteHomeCodeConfig = sysConfigService.getPlainConfigContentVo(WebsiteHomeCodeConfigVo.class, ConfigBizTypeConstants.WEBSITE_HOME_CODE_CONFIG);
        WebsiteFooterCodeConfigVo websiteFooterCodeConfig = sysConfigService.getPlainConfigContentVo(WebsiteFooterCodeConfigVo.class, ConfigBizTypeConstants.WEBSITE_FOOTER_CODE_CONFIG);
        WebsiteSeoConfigVo websiteSeoConfig = sysConfigService.getConfigContentVo(WebsiteSeoConfigVo.class, ConfigBizTypeConstants.WEBSITE_SEO_CONFIG);
        map.put("websiteAgreementConfig", websiteAgreementConfig);
        map.put("websitePermissionConfig", websitePermissionConfig);
        map.put("websiteBaseConfig", websiteBaseConfig);
        map.put("websiteSeoConfig", websiteSeoConfig);
        map.put("websiteHomeCodeConfig", websiteHomeCodeConfig);
        map.put("defaultHomeCodeConfig", WebsiteHomeCodeDefaults.build(websiteBaseConfig));
        map.put("websiteFooterCodeConfig", websiteFooterCodeConfig);
        map.put("defaultFooterCodeConfig", WebsiteFooterCodeDefaults.build(websiteBaseConfig));
        map.put("serviceAreaOptions", buildServiceAreaOptions(websiteBaseConfig));
        return "admin/settings/website-setting";
    }

    private List<CdnServiceAreaOptionVo> buildServiceAreaOptions(WebsiteBaseConfigVo config) {
        List<CdnServiceAreaOptionVo> options = new ArrayList<>();
        for (Map<String, String> vendor : SupportedVendorUtils.allVendorOptions()) {
            String route = vendor.get("code");
            if (CdnRoute.MULTI_CDN.getCode().equals(route)) {
                continue;
            }
            String name = vendor.get("name");
            options.add(option(config, route, name, null));
        }
        return options;
    }

    private CdnServiceAreaOptionVo option(WebsiteBaseConfigVo config, String route, String routeName,
                                          String fixedArea) {
        String targetKey = CdnServiceAreaPolicyService.routeTarget(route);
        return CdnServiceAreaOptionVo.builder()
                .targetKey(targetKey)
                .route(route)
                .routeName(routeName)
                .selectable(true)
                .fixedArea(fixedArea)
                .mainlandEnabled(configured(config, targetKey, route,
                        CdnServiceAreaPolicyService.MAINLAND))
                .overseasEnabled(configured(config, targetKey, route,
                        CdnServiceAreaPolicyService.OVERSEAS))
                .globalEnabled(configured(config, targetKey, route,
                        CdnServiceAreaPolicyService.GLOBAL))
                .build();
    }

    private boolean configured(WebsiteBaseConfigVo config, String targetKey, String route, String serviceArea) {
        if (config == null) {
            return false;
        }
        List<String> targets;
        if (CdnServiceAreaPolicyService.MAINLAND.equals(serviceArea)) {
            targets = config.getMainlandEnabledTargets();
        } else if (CdnServiceAreaPolicyService.OVERSEAS.equals(serviceArea)) {
            targets = config.getOverseasEnabledTargets();
        } else {
            targets = config.getGlobalEnabledTargets();
        }
        if (targets != null) {
            return targetKey != null && targets.contains(targetKey);
        }
        if (CdnServiceAreaPolicyService.MAINLAND.equals(serviceArea)) {
            return false;
        }
        List<String> legacyRoutes = CdnServiceAreaPolicyService.OVERSEAS.equals(serviceArea)
                ? config.getOverseasEnabledRoutes() : config.getGlobalEnabledRoutes();
        return legacyRoutes != null && legacyRoutes.contains(route);
    }

    /**
     * API 配置
     */
    @AuthorLimiter
    @GetMapping("api-setting")
    public String apiSetting(Map<String, Object> map) {
        HuaWeiCloudApiConfigVo huaWeiCloudApiConfigVo = sysConfigService.getConfigContentVo(HuaWeiCloudApiConfigVo.class, ConfigBizTypeConstants.HUAWEI_CLOUD_API_CONFIG);
        VolcanicCloudApiConfigVo volcanicCloudApiConfigVo = sysConfigService.getConfigContentVo(VolcanicCloudApiConfigVo.class, ConfigBizTypeConstants.VOLCANIC_CLOUD_API_CONFIG);
        WhiteMountainCloudApiConfigVo whiteMountainCloudApiConfigVo = sysConfigService.getConfigContentVo(WhiteMountainCloudApiConfigVo.class, ConfigBizTypeConstants.WHITE_MOUNTAIN_CLOUD_API_CONFIG);
        TencentCloudApiConfigVo tencentCloudApiConfigVo = sysConfigService.getConfigContentVo(TencentCloudApiConfigVo.class, ConfigBizTypeConstants.TENCENT_CLOUD_API_CONFIG);
        TencentEdgeOneApiConfigVo tencentEdgeOneApiConfigVo = sysConfigService.getConfigContentVo(TencentEdgeOneApiConfigVo.class, ConfigBizTypeConstants.TENCENT_EDGEONE_API_CONFIG);
        CDNetworksApiConfigVo cdnetworksApiConfigVo = sysConfigService.getConfigContentVo(CDNetworksApiConfigVo.class, ConfigBizTypeConstants.CDNETWORKS_API_CONFIG);
        AliyunCdnConfigVo aliyunCdnConfigVo = sysConfigService.getConfigContentVo(AliyunCdnConfigVo.class, ConfigBizTypeConstants.ALIYUN_CDN_CONFIG);
        WangsuCdnConfigVo wangsuCdnConfigVo = sysConfigService.getConfigContentVo(WangsuCdnConfigVo.class, ConfigBizTypeConstants.WANGSU_CDN_CONFIG);
        BaiduCdnConfigVo baiduCdnConfigVo = sysConfigService.getConfigContentVo(BaiduCdnConfigVo.class, ConfigBizTypeConstants.BAIDU_CDN_CONFIG);
        KingsoftCdnConfigVo kingsoftCdnConfigVo = sysConfigService.getConfigContentVo(KingsoftCdnConfigVo.class, ConfigBizTypeConstants.KINGSOFT_CDN_CONFIG);
        MergeCdnApiConfigVo mergeCdnApiConfigVo = sysConfigService.getConfigContentVo(MergeCdnApiConfigVo.class, ConfigBizTypeConstants.MERGE_CDN_API_CONFIG);
        DnsConfigVo dnsConfigVo = sysConfigService.getConfigContentVo(DnsConfigVo.class, ConfigBizTypeConstants.DNS_CONFIG);
        if (dnsConfigVo == null) {
            dnsConfigVo = DnsConfigVo.builder()
                    .primaryDomain(RuntimeConfigUtils.optional("tencent.dns.local-domain-name", "TENCENT_DNS_LOCAL_DOMAIN", ""))
                    .domainTtl("600")
                    .selectDns("tencent")
                    .secretId(RuntimeConfigUtils.optional("tencent.dns.secret-id", "TENCENT_DNS_SECRET_ID", ""))
                    .secretKey(RuntimeConfigUtils.optional("tencent.dns.secret-key", "TENCENT_DNS_SECRET_KEY", ""))
                    .build();
        }
        map.put("huaWeiCloudApiConfig", huaWeiCloudApiConfigVo);
        map.put("volcanicCloudApiConfig", volcanicCloudApiConfigVo);
        map.put("whiteMountainCloudApiConfig", whiteMountainCloudApiConfigVo);
        map.put("tencentCloudApiConfig", tencentCloudApiConfigVo);
        map.put("tencentEdgeOneApiConfig", tencentEdgeOneApiConfigVo);
        map.put("cdnetworksApiConfig", cdnetworksApiConfigVo);
        map.put("aliyunCdnConfig", aliyunCdnConfigVo);
        map.put("mergeCdnApiConfig", mergeCdnApiConfigVo);
        map.put("wangsuCdnConfig", wangsuCdnConfigVo);
        map.put("baiduCdnConfig", baiduCdnConfigVo);
        map.put("kingsoftCdnConfig", kingsoftCdnConfigVo);
        map.put("dnsConfig", dnsConfigVo);
        return "admin/settings/api-setting";
    }


}