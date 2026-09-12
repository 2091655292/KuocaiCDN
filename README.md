# 彩虹 DNS Pro

<p align="center">
  <b>DNS 解析 · CDN 加速 · SSL 证书 · 自动部署</b> 一体化管理平台
</p>

彩虹 DNS Pro 是基于 [彩虹聚合 DNS 管理系统（彩虹 DNS）](https://github.com/netcccyun/dnsmgr) 的现代化重构版，采用 **Node.js（TypeScript）+ Fastify + Vue 3** 全栈重写，并在原有 DNS 解析管理能力之上，融合了 [阔彩 CDN（multi-cloud-cdn）](https://github.com/qingqian844/kuocaicdn_V1A) 的 **CDN 域名管理与边缘规则引擎** 能力，形成「域名解析 → CDN 加速 → SSL 证书 → 自动部署」的完整闭环。

在单个网站内即可管理多个平台的域名解析与 CDN 加速，支持多用户权限、API 接口、批量操作，适用于 IDC 系统集成与个人/企业统一纳管。

---

## 相较于彩虹 DNS 的变化

| 维度 | 彩虹 DNS（原版） | 彩虹 DNS Pro |
| --- | --- | --- |
| 后端 | PHP 8（ThinkPHP） | Node.js / TypeScript（Fastify） |
| 前端 | 服务端渲染 + jQuery/Bootstrap | Vue 3 + Naive UI（SPA，前后端分离） |
| 接口 | ThinkPHP 路由 | RESTful JSON API | 
| 初始化 | 网页安装向导（依赖 PHP） | Web 安装向导（填库即可）+ 启动自动迁移 |
| 用户体系 | 管理员后台添加用户 | 新增**自助注册**（邮箱验证码 / 注册码，管理员可配置开关与方式）、TOTP 两步验证 |
| 数据兼容 | — | **绑定彩虹 DNS 现有数据库直接使用**，表结构一致、免迁移 |

保留并增强的能力：多 DNS 平台解析管理、容灾切换、定时切换、Cloudflare 优选 IP、SSL 证书申请、多通道通知（邮件 / 微信 / Telegram / 钉钉 / 飞书 / 企微 / Webhook）。

---

## 从 multi-cloud-cdn（阔彩 CDN）引入的能力

彩虹 DNS 原版已具备 CDN 域名管理骨架，但各平台的控制（尤其 EdgeOne）多为占位实现。彩虹 DNS Pro 将阔彩 CDN（Java 版）中的实现移植（翻译为 TypeScript）过来：

- **腾讯云 EdgeOne 规则引擎**：通过 L7 加速规则（`CreateL7AccRules` / `ModifyL7AccRule` / `DeleteL7AccRules`）+ 规则表达式完成缓存规则下发，支持文件后缀、目录、全路径三类匹配与通配符转正则。
- **腾讯云 CDN 缓存规则**：规则类型映射（all / file / directory / path）、`ttl=0` 转 NoCache、优先级反转。
- **阿里云 CDN 缓存规则**：先删旧配置再下发、`filetype_based_ttl_set` / `path_based_ttl_set` 分类、权重递减。
- **HTTPS 配置**：EdgeOne 证书禁用（`ModifyHostsCertificate`）+ 站点级强制跳转（`ForceRedirectHTTPS`）；阿里云 CDN 关闭 SSL + 强制跳转。
- **阿里云 ESA** 缓存规则 / HTTPS 规则（规则引擎式 `CacheRule` / `HttpsBasicConfiguration` / `HttpsApplicationConfiguration`，基于 ESA OpenAPI 2024-09-10 实现）。
- **工程实践**：容器化部署、数据库启动时自动初始化（幂等建表 / 迁移）的思路。

---

## 两者的联动

- **彩虹 DNS** 负责「域名解析」：多平台 DNS 记录统一管理、容灾/定时切换、优选 IP。
- **multi-cloud-cdn / 阔彩 CDN** 负责「内容加速」：CDN 域名接入、源站 / 缓存 / HTTPS / 边缘规则。
- **彩虹 DNS Pro 将二者融合**：解析记录与 CDN 加速域名同库关联，配合内置的 SSL 证书申请与 40+ 部署商自动部署，一个平台完成从「域名 → 解析 → 证书 → 加速 → 上线」的全流程，避免多系统割裂与重复配置。

---

## 功能特性

- **DNS 解析管理**：支持阿里云、腾讯云、华为云、百度云、西部数码、火山引擎、Cloudflare、DNSPod、DNSLA、Namesilo、PowerDNS、GoEdge 等 20+ 平台，多用户按域名分配权限，支持 API 接口与批量操作。
- **CDN 加速管理**：腾讯云 CDN、阿里云 CDN、腾讯云 EdgeOne、阿里云 ESA 四类平台的接入、源站、缓存规则、HTTPS 配置。
- **SSL 证书**：Let's Encrypt、ZeroSSL、Google Trust Services、阿里云、腾讯云等 8 个签发渠道，支持申请、续期、手动导入。
- **证书自动部署**：宝塔面板、宝塔 WAF、宝塔 Windows、1Panel 等面板、K8s、AWS、阿里云、腾讯云、华为云、群晖、Proxmox、SSH、FTP、Nginx Proxy Manager、DirectAdmin 等 40+ 部署商。
- **容灾切换**：ping / tcp / http(s) 检测协议，自动暂停/切换解析，多通道告警。
- **定时切换**：指定时间/周期自动修改/开启/暂停/删除解析。
- **CF 优选 IP**：自动获取最新 Cloudflare 优选 IP 并更新到解析记录。
- **多用户体系**：用户自助注册（邮箱验证码 / 管理员生成注册码，可配置开关与方式）、TOTP 两步验证、域名级权限分配、API Key。
- **多通道通知**：邮件、微信公众号（WxPusher）、Telegram、钉钉、飞书、企业微信、Webhook、自定义 Webhook。

---

## 部署方式

### 方式一：拉取镜像启动（推荐）

```bash
docker run -d \
  --name dnsmgr-pro \
  -p 8082:8082 \
  -v dnsmgr-pro-data:/app/data \
  --restart always \
  ssdxftx/dnsmgr-pro:latest
```

启动后访问 `http://主机:8082`，首次打开会自动进入**系统安装页**：

1. 填写数据库连接信息（主机、端口、账号、密码、库名、表前缀）。
2. 点击「测试数据库连接」——系统会自动判断是「全新安装」还是「已有数据」。
3. 全新安装：填写管理员账号密码，点击「立即安装」。
4. **兼容彩虹 DNS**：若填写的是彩虹 DNS 现有数据库（表结构一致），系统会检测到已有数据并**直接绑定使用**，不删除、不覆盖原有解析、用户、证书等任何数据。

> 应用与数据库分离，数据库可自建（MySQL 5.7+ / MariaDB）。`-v dnsmgr-pro-data:/app/data` 用于持久化安装配置，请务必保留。

### 方式二：Docker Compose（自建镜像）

```bash
# 克隆仓库
git clone https://github.com/2091655292/KuocaiCDN.git dnsmgr-pro
cd dnsmgr-pro

# 构建并启动
docker compose up -d --build
```

安装流程同「方式一」；也可取消 `docker-compose.yml` 中可选 `mysql` 服务注释，一并启动数据库。

### 方式三：宿主机运行

```bash
# 后端（需 Node.js 22+，MySQL/MariaDB）
cd backend
npm install
npx tsx src/index.ts

# 前端
cd frontend
npm install
npm run dev
```

后端默认监听 `8082`，前端开发服务器代理 `/api` 到后端。数据库连接也可通过环境变量 `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PREFIX` 预置。

### 方式四：Kubernetes（容器编排）

仓库内置 Kubernetes 编排清单 `deploy/kubernetes.yaml`，包含 Namespace、PersistentVolumeClaim、Deployment、Service、Ingress 全套资源：

```bash
# 一键部署
kubectl apply -f deploy/kubernetes.yaml

# 查看运行状态
kubectl -n dnsmgr-pro get pods,svc

# 集群内访问（或临时端口转发）
kubectl -n dnsmgr-pro port-forward svc/dnsmgr-pro 8082:8082
```

部署后访问 `http://<NodeIP>:8082`（或你的 Ingress 域名），同样进入系统安装页完成初始化。

- PersistentVolumeClaim 持久化安装配置（`/app/data`），重建 Pod 不丢配置。
- 数据库选项可在 Deployment 的 `env` 注释中开启环境变量预置，或在安装页填写外部数据库连接。
- 若使用 GHCR 私有镜像（`ghcr.io/<owner>/dnsmgr-pro`），需另行配置 `imagePullSecrets`；清单默认使用 Docker Hub 公开镜像 `ssdxftx/dnsmgr-pro`。

### 从彩虹 DNS 迁入

无需任何数据迁移脚本。直接在新系统安装页填写彩虹 DNS 的数据库连接信息（表前缀默认 `dnsmgr_`，如自定义过请填写实际前缀），即完成绑定，原管理员账号可直接登录。

---

## 技术栈与目录结构

```
dnsmgr-refactor/
├── backend/          # Node.js + TypeScript + Fastify
│   └── src/
│       ├── routes/       # 路由（认证/域名/CDN/证书/部署/注册等）
│       ├── lib/          # 平台 Provider（dns/cert/deploy/cdn/cloudflare 等）
│       ├── sql/          # 建表 SQL（schema-init.sql）
│       ├── migrate.ts    # 启动自动迁移
│       ├── installer.ts  # 安装/绑定逻辑
│       └── index.ts      # 入口
├── frontend/         # Vue 3 + Naive UI + Vite
├── deploy/           # 容器编排清单（kubernetes.yaml）
├── Dockerfile        # 多阶段构建（前端构建 + 后端运行）
├── docker-compose.yml
└── .env.example
```

---

## 开源协议

本项目基于彩虹 DNS（MIT License）衍生，并融合阔彩 CDN 相关实现，采用 [MIT License](./LICENSE) 开源。

[MIT](./LICENSE) © 彩虹 DNS Pro 贡献者 · 原始版权归属 [消失的彩虹海（彩虹 DNS）](https://github.com/netcccyun/dnsmgr)