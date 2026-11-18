# 模型优先通道与回退（2026-10-30）

用户授权优先使用书生端砚 `https://discovery-api.intern-ai.org.cn/v1` 的 `deepseek-v4.1-flash-1017`，不可用时先回退硅基流动的 `deepseek-ai/DeepSeek-V4.1-Flash`，再回退原付费 DeepSeek。2026-10-25起按用户要求，每个启用自动信源每120分钟采集一次；RSS/网页下载本身通常不调用模型。

- 普通任务选择 `intern-flash`；行业预筛与保留的评分配置选择低强度推理 `intern-flash-think`。预筛继续运行，建设期评分及精选深度写作暂停，详见`docs/selection.md`。
- 覆盖预筛、双次评分、摘要、内容理解、措辞、结构抽取、事件归组及复核、综述、周月报和中英文翻译；后台模型设置可覆盖环境选择。上线时必须核对 `modelSources()`，尤其评分的既有后台设置。
- 主通道成功只调用一次；明确拒绝、限流、超时结果未知或无法解析的输出，逐层回退。未知回执保持未知，不伪装成未调用。原 DeepSeek 同样失败则交给既有任务重试。
- 2026-10-27用户确认：优先在免费通道完成，付费只作兜底。已确认不可用的免费层允许跨任务冷却，暂时进入下一层；冷却结束只放行一条恢复探测，成功后恢复该层优先。该规则取代此前“每条任务必须实际发送第一层”的策略。回执中已收到的答案仍可直接复用，不受冷却影响。
- 免费层的429按原因处理：`quota/allowance/balance`或434额度拒绝、401/403凭据拒绝，从5分钟开始冷却，连续失败逐步延长至30分钟；不固定等2秒重复碰额度。普通429从5秒、连接/5xx从2秒开始，逐步延长至60秒并附加少量随机间隔。优先遵守有效的 `Retry-After`（秒数或HTTP日期，最多24小时）。超时结果未知保留原回执，当前任务不在原层重发，通道冷却30秒起。400不原地重复或暂停整个通道，保留错误供针对性排查。
- 本地预算耗尽、调用开关关闭、数据库错误及正在执行的回执不会触发回退绕过保护。原付费通道费用仍按既有上界估算。
- 2026-10-24 增加免费服务统一节奏：`site/models.ts` 的 `MODEL_REQUESTS_PER_MINUTE.intern = 45`，低于平台的 50 RPM。普通/推理、后台/维护、首次/重试请求均通过回执入口共用数据库锁、实时数据库时钟和滚动一分钟记录；相邻发送预约至少间隔 1,334ms，一分钟最多 45 次。本地超速等待不会创建回执或费用预约，不占数据库事务/连接，也不会触发付费回退；停机信号可取消等待。即使未配置 `budgets` 行、设置人民币不限额或启用当日请求豁免，此节奏仍生效；手动停用及其他预算熔断仍保留。跨进程生效范围是连接同一数据库且使用 `intern` 服务名的本项目调用，不涵盖密钥在其他项目的使用。
- 免费层对明确的短暂限流、连接/5xx失败或无效JSON/结构，最多额外恢复一次；配额/凭据拒绝和结果未知不原地重试。每层本地冷却/重试等待累计最多20秒（不含实际请求与RPM/并发排队），更长冷却进入下一层。免费层的单条恢复探测进行中，其他任务可短等其结果，减少过早转入付费。最终付费层不增加内部重试，失败仍交既有任务恢复。这些保护不能保证零付费或恢复平台赠送额度，也不替代尚未核验的TPM限制。
- 新平台只返回 token 用量，人民币成本记为未知，不能套用官方零售价或宣称无限免费。它有共享账户额度和 RPM/TPM 限制；当前金额设置为 unlimited。若以后恢复有限人民币上限，未知价格会阻止调用，需先补齐可信定价/免费额度核算。
- 免费服务最多3个在途请求，普通/推理共享，超出时在本地排队，不为此进入付费。请求预约与健康状态均由数据库同一service锁保护，后台与维护进程共用；不持有事务连接睡眠。健康状态写入 `settings` 的 `model.health.*`，按service、端点和模型分域，不含密钥、原文或用户信息；旧请求的迟到结果不能覆盖较新状态。重启不清空冷却。
- 冷却跳过不写入模型调用回执。后台可查看冷却与恢复探测状态；该状态不能用来查询供应商剩余额度。每日邮件只展示昨天的模型费用估算和估算 UV。
- 密钥只进入本机忽略目录和服务器私有环境文件，前端、镜像源码及 Git 仓库不包含密钥。

本轮模型列表成功返回指定版本，但最初两次生成测试均为 429 `Channel rate limit reached for model`。模型存在不代表实际生成可用，也不代表平台后端版本经过独立鉴定。最终运行验收见本机 outputs 报告。

回滚：恢复各步骤原模型设置（评分 deepseek-flash-think，其余 default 或 deepseek-flash）并重建 api/worker 容器；保留原 DeepSeek 密钥，勿删除生产环境其他配置。


## 超算通道已移除（2026-10-30）

生产回执持续返回 HTTP 402 / Insufficient Balance，按用户要求永久移除超算中间层。普通任务为 `intern-flash → deepseek-flash`，推理任务为 `intern-flash-think → deepseek-flash-think`。删除超算预设、专用限速/并发配置、凭据与当前健康/节奏状态；直接选用旧预设的步骤改回对应 Intern 预设。通用多层回退机制保留，历史回执及邮件中的历史超算用量保留用于账务核对，不能将其算成付费 DeepSeek。

## 硅基流动中间层（2026-10-30）

用户要求以硅基流动替代已移除的超算通道。普通任务 `intern-flash → siliconflow-flash → deepseek-flash`，推理任务 `intern-flash-think → siliconflow-flash-think → deepseek-flash-think`。地址 `https://api.siliconflow.cn/v1`，私有配置 `SILICONFLOW_BASE_URL` / `SILICONFLOW_API_KEY`。

实际接口验证普通与推理JSON均成功，模型返回 `deepseek-ai/DeepSeek-V4.1-Flash`；该名字不独立证明底层固定到1017版本。普通任务用 `enable_thinking:false`，推理任务用 `enable_thinking:true,thinking_budget:12000`。与官方DeepSeek的 `thinking.type` 参数分开。

硅基流动是有价通道，不能视为永久免费。按[官方价格](https://www.siliconflow.cn/pricing)高峰价每百万Token输入2元、缓存命中0.04元、输出8元估算上界；忽略低谷优惠。最大输出费用预约还包含单独推理预算。赠送余额抵扣/充值扣费以供应商账单为准，费用邮件分别列硅基流动和DeepSeek官方，不把未知费用记为0。

本站对硅基流动主动设置30 RPM、3个在途请求（不是平台限额承诺），普通/推理及维护任务共用数据库协调。402余额不足进入共享额度冷却，不重试空余额；429、连接/5xx、无效输出按既有保护执行。配置错误与本地预算保护仍终止，不跳供应商绕过。

## 推理时代 AIHubMix 第三层（2026-10-30）

用户确认官网 https://aihubmix.com/，在硅基流动与DeepSeek官方之间插入推理时代。

| 层 | 通道 | 普通 / 推理预设 |
| --- | --- | --- |
| 1 | 书生 | intern-flash / intern-flash-think |
| 2 | 硅基流动 | siliconflow-flash / siliconflow-flash-think |
| 3 | 推理时代 AIHubMix | aihubmix-flash / aihubmix-flash-think |
| 4 | DeepSeek官方 | deepseek-flash / deepseek-flash-think |

私有变量 `AIHUBMIX_BASE_URL=https://aihubmix.com/v1`、`AIHUBMIX_API_KEY`。请求模型 `deepseek-v4.1-flash-1017`，真实生成返回 `deepseek-v4-1-flash-261017`。普通任务仅设 `reasoning_effort:none` 实测仍有推理Token，因此同时传原生 `thinking.type:disabled`；该组合实测推理Token为0。推理任务保留 `thinking.type:enabled,reasoning_effort:low`，额外预留12000输出Token。本站设30RPM/3并发保护，并继续使用回执、冷却、有限重试和后继通道机制。

[官方报价](https://aihubmix.com/blog/aihubmix-desktop-1-0-one-click-setup-for-11-agents-and-half-price-deepseek-v4-1-flash-1017-for-two-weeks)以美元计费。估算取非促销高峰价：每百万Token输入0.3098美元、输出1.2392美元，忽略缓存和促销折扣作为上界。USD单独写入回执、价格表和邮件；不套用DeepSeek人民币价格，不将两种货币直接相加。若恢复有限人民币预算，在没有可信换算机制时阻止此美元通道，不能换币绕过上限。当前不限额模式不受影响。实际扣款以推理时代账单为准。

### 最新汇率展示（2026-10-30 用户补充）

昨天有美元费用时，邮件按 Yahoo Finance 最新可得的有效 USD/CNY 报价折合人民币总额。报价超过 24 小时会在金额旁标注；超过 4 天或两个行情端点均无法提供有效报价时，保留原币金额。发信记录保存原币金额和采用的报价，实际结算以供应商账单为准。

美元回执保留原币，汇率快照随邮件发送状态保存，避免改写历史账务。此展示换算不改变模型调用的CNY预算保护。邮件脚本为主机任务，可按校验和独立更新，更新前备份并记录Git提交及文件哈希；无需重启web/api/worker或共享入口。
