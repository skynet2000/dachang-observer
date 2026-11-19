# 隐私说明

| 项 | 值 |
|---|---|
| 版本 | 2026-10-25 |
| 生效日期 | 2026-10-25 |
| 运营主体 | 大厂观察个人运营者 |
| 联系方式 | [skynettiantian@gmail.com](mailto:skynettiantian@gmail.com) |

大厂观察由个人运营。日常阅读无需注册或登录，不出售个人信息，目前不接入广告追踪或第三方访客统计。

## 浏览器本地记录

匿名阅读时，收藏、已读、外观设置、最近搜索（最多 10 条）、更新日志已读状态和反馈草稿保存在当前浏览器。返回列表的位置与展开状态保存在当前标签页的会话存储。匿名记录不会同步至服务器，清理浏览器数据后会消失，换设备不会自动同步。登录后的同步规则见下节。

## 可选的读者登录与同步

日常阅读仍无需登录。你可以自愿使用 Google 或 GitHub 登录，同步收藏和已读；不同登录方式暂为独立账号。

我们从登录服务读取稳定账号标识、昵称及登录方式，用于建立本站账号。不索取仓库、邮件、发帖权限，不保存提供商访问或刷新 Token。本站账号、收藏、已读、会话保存在腾讯云首尔服务器，账号及阅读数据不用于模型训练或资讯生成，不出售或提供给广告商。

生产登录 Cookie 使用 Secure、HttpOnly、SameSite=Lax，30 天后过期。OAuth 临时握手十分钟过期，定期清理。收藏最多 500 条、已读最多 5000 条；记录为跨设备同步保存，不定期自动删除账号。

匿名旧记录不会因登录自动上传，你可以登录后主动导入。登录期间浏览器保留云端记录的本机副本及匿名备份，离线操作保存在本机，联网后重试；会话过期时保留未同步副本，重新登录同一账号后继续同步。清理浏览器数据会移除本机副本。

退出后恢复本机匿名记录。你可以在读者账号页删除本站账号：服务器删除账号、云端阅读记录及所有会话，备份副本随七天备份轮转移除。离线设备的本机缓存不能被服务器远程擦除，请在对应设备退出或清理浏览器数据；删号不会删除你的 Google/GitHub 账号，也不替你撤销提供商端的应用授权。

联系邮箱：skynettiantian@gmail.com。Google/GitHub 登录分别受其服务和隐私规则约束。

### Google sign-in: English summary

Dachang Observer（大厂观察）is a news aggregation website for people working at internet companies. Reading is public and does not require an account. Google sign-in is optional and enables saved and read stories to sync across devices.

We use the stable account identifier, display name and sign-in provider to create your reader account. We do not request access to email, Drive files or repositories, and do not retain provider access or refresh tokens. Account and reading records are stored on our Seoul server. They are not used for model training or news generation, sold, or shared with advertisers.

Reader sessions expire after 30 days. You can sign out or delete your site account on the account page. Deletion removes your cloud reading records and all sessions; backup copies expire through the seven-day rotation. Local copies on offline devices must be cleared on those devices. Deleting this site's account does not delete your Google account or revoke Google's app authorization. For access, correction or deletion requests, contact skynettiantian@gmail.com. The Chinese sections on this page describe the same reader-account handling in full, along with local browser records, feedback and infrastructure.

## 反馈资料

提交反馈时，反馈文字、选填邮箱、相关页面地址及主动附上的截图会发送至本站服务器，用于处理问题、联系反馈者和核查更正请求。反滥用机制使用网络地址与浏览器类别计算出的不可逆标识，用于限流和封禁；请勿在反馈中附带密码、身份证号或其他不必要的敏感信息。

当前反馈不转发飞书，不发送给生成资讯摘要的模型。反馈及截图仅供运营维护使用，在处理问题和保留必要处理记录期间保存；目前没有按天自动删除机制。你可通过联系邮箱申请查询、更正或删除，运营者会在核实定位信息后处理。备份中的副本随备份清理而移除。

## 服务器与模型服务

业务数据库及反馈附件保存在腾讯云首尔服务器。服务器在处理请求时会接触网络地址等连接信息；本站保留必要的错误与运行日志用于排障，并对容器日志设置容量轮转，不建立访客画像。基础设施提供商的数据处理适用其自身服务规则。

DeepSeek API 用于处理公开资讯并生成筛选、摘要和事件归组；普通访客打开页面不会触发模型请求。模型 API 密钥仅在后端配置，反馈资料不作为资讯生成输入。

点击原文等外部链接后将进入第三方网站，适用对方的隐私规则。查询、更正或删除反馈资料，请联系 skynettiantian@gmail.com，并提供便于定位该条反馈的信息。


## 访问聚合与估算独立访客

为了解站点使用及运行情况，服务器按北京时间自然日累计页面访问请求、估算独立访客（UV）、已识别爬虫请求、404/5xx页面数量和热门页面路径。聚合数字及公共页面路径最多保留30天；每日运营邮件仅包含这些汇总信息。

估算UV使用连接地址与浏览器标识，通过当日随机密钥计算短期去重值。原始IP和浏览器标识不落盘，不设置统计Cookie，不读取登录身份或URL查询参数，不关联收藏和已读。去重值与随机密钥保存在本站服务器的私有统计目录，下一自然日首次统计时替换，不纳入每日备份，不用于跨日追踪、阅读画像、模型处理或第三方分析。

启用跨日去重统计时，服务器使用独立密钥将同样的连接地址与浏览器标识映射到每日统计位图，合并最近30个北京时间自然日的位图来估算跨日去重访客。位图不记录逐人访问或页面关联。位图和密钥只存本站私有统计目录，不纳入每日备份，过期位图在后续统计时清理。跨日去重统计不保存原始IP或浏览器标识，不设置统计Cookie，不读取或关联账号，也不用于阅读画像、模型处理或第三方分析。

独立访客数为估算值。共享网络和浏览器的人可能被合并，更换网络或浏览器可能重复计算。已识别爬虫不计入，浏览器完全从缓存读取且未请求服务器的页面可能漏计。首次启用、恢复备份等造成统计时段不完整时，显示覆盖范围，历史缺失不计为零。
