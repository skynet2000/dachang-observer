# 信源

信源在后台“信源”页管理：新建、试抓一次看看抓到什么、改频率、启停、看失败原因和最近的条目。首次启动时，`industry/sources.json` 里的示范信源会被导入。

2026-10-24 已核验替代入口：[阿里巴巴集团中文新闻中心](https://www.alibabagroup.com/zh-CN/news-and-resource)。它提供带日期的公开 HTML 新闻卡片，覆盖集团公告，更新较低频。Alizila 的 RSS 连续返回 403 挑战页，暂停轮询并保留历史。抓取器不会绕过登录或验证挑战；21 世纪经济报道等公开详情页的瞬时超时会在原总期限内留出一次恢复机会，仍失败则记录真实错误。

## 国内中大厂来源补充（2026-11-04）

参考 [NewsNow](https://github.com/newsnext/newsnow) 和 [TrendRadar](https://github.com/sansan0/TrendRadar) 的渠道发现方式，使用媒体的原生 RSS 或公开网页读取原文。各入口均按北京时间的原发时间采集，每120分钟轮询，首次最多导入近一个月的3至4篇候选。

| 入口 | 采集范围和原发时间 |
| --- | --- |
| [36氪 · 国内大厂文章](https://www.36kr.com/rss-center) | 原生文章 RSS，补充国内平台与职场深度稿。使用 www 原文地址及文章署名栏日期，和既有36氪 RSS 共享媒体信号组。 |
| [华尔街见闻 · 国内互联网](https://wallstreetcn.com/news/global) | 从公开报道列表筛选国内互联网公司，排除普通行情、盘面和营销条目。使用文章卡片的完整发布时间。 |
| [游戏陀螺 · 公司与团队](https://www.youxituoluo.com/) | 国内游戏企业和关联工作室的招聘、团队变动及经营动态。以详情页正文标题和发布时间为准。 |
| [触乐 · 游戏公司与职场](https://www.chuapp.com/) | 团队采访、岗位及工作室变化、公司竞争。使用详情署名栏的年月日与时分。 |

四个入口复用行业预筛和事件去重，只公开摘要和原文链接。针对用工的报道仍须区分已经确认的裁撤、岗位调整和采访转述；游戏开箱、促销及泛股市消息在列表阶段过滤。快手、拼多多等部分投资者站点从部署机返回拒绝访问，留待有可读官方入口时再接入。

## 职场来源补充（2026-10-28）

新增 **[定焦One · 职场故事](https://dingjiaoone.com/category/故事)**（`web-dingjiao-workplace`），直接读取媒体官网 HTML，不依赖公众号 RSS 桥接。范围是员工采访、裁员招聘、薪酬绩效和工作制度；标题先作职场主题筛选，随后仍须通过互联网行业相关性判断。出现“薪”或“AI”不等于自动收录，不额外开放硬件岗位、培训推广或消费故事。

- 首尔服务器用正式采集器预览得到2条近一个月的职场候选，详情正文均可读取。分别为10月24日《打工人，开始“表演”AI提效》和10月9日《日薪120元，我给机器人当“老师”》；后者是否符合互联网岗位范围仍交给正常准入流程，预览不代表公开发布。
- 日期读取详情页 JSON-LD 的 `datePublished`，并设为权威时间；不使用抓取时间或页面更新时间。保留原始日期，首次最多导入2篇、最近1个月内容，每120分钟轮询。
- 独立媒体信号组为 `media-dingjiao`。只公开摘要和原文链接，不开全文再分发，自动精选保持暂停；英文界面的来源名同步配置。
- 本轮只新增这个已验证入口。界面“职场”栏目在最近一个月没有可导入的新稿；深燃官方澎湃号最新列表停在2023年，镜观台停在2024年；电厂与刺猬公社的近期公开列表未提供符合本轮职场范围的新稿，均不启用。人物/每日人物的候选第三方RSS条目没有发布日期且摘要不足，同样不启用。

以上是本次实测结果，不代表这些媒体其他发布渠道停更，也不保证公开入口永久可用。采集失败沿用现有健康状态、退避和通知机制；不绕过登录、验证码或付费限制。

## 六种信源

| 类型 | 适合 | 需要 |
|---|---|---|
| `rss` | 有 RSS / Atom 的博客、媒体、Substack、公众号转 RSS 服务 | 无 |
| `web_list` | 没有 RSS 的网页列表（新闻页、博客列表、更新日志） | 写选择器；按需配置 Jina Reader 渲染（按次计费） |
| `json_list` | 返回 JSON 的接口（GitHub Releases 等） | 写字段路径 |
| `x_search` | X（推特）账号 | SocialData 的 key，按请求计费 |
| `mp_account` | 微信公众号 | 极致了（Dajiala）的 key，按请求计费 |
| `external` | 你自己的脚本推送进来的内容 | `INGEST_TOKEN`，见下文 |

`json_list` 的地址或配置可能携带凭据，只跟随同源重定向（协议、主机和端口都相同）。若接口搬到另一个来源，请直接更新信源地址；不要依赖跨源跳转传递认证信息。

每种信源认哪些配置项写在 [`config-keys.ts`](../packages/backend/src/sources/config-keys.ts)。填了不认识的配置项，保存会被拒绝、抓取会直接失败并在后台显示原因，不会悄悄退回通用解析。

## 先预览，再创建

进入 `/admin/sources/new`，填写 ID、名称，选择类型，再把[下一节](#每种信源怎么配置)对应的 JSON 填入“采集配置（JSON）”。这里填的是配置对象，不要包上 `kind` 或 `config`。切换类型会重置配置，先选类型再粘贴。

名称里全角括号中的备注（比如“某媒体（热点 RSS）”）只给后台看，读者在网页、RSS、Agent Markdown、MCP 和搜索里看到的是去掉备注的名字；X 账号写成 `X：显示名 (@handle)` 的，读者只看到显示名。公开 API 的 JSON 里仍是完整的名字。

`rss`、`web_list`、`json_list`、`x_search` 可以点“预览抓取”：显示条目总数和前 20 条的标题、原文链接、发布时间、摘要，不把条目存入文章库。检查抓到的是文章而不是导航，日期与原文一致，再点“创建”。预览和正式采集套用同一组过滤（地址前缀、分类、噪声词、地址改写、`publishedAfter`），看到的就是正式采集会收的条目；但它不等于完成生产采集，也不经过后续详情补齐、精选和公开发布流程。

预览仍会发出抓取请求；X 和 Jina 预览也可能产生费用，经过付费回执和预算。`COLLECT_ENABLED=false` 只关闭后台自动采集，不能用它来保证手动预览不访问外部服务。下面的本地 HTML/JSON 示例不需要任何 API key。

## 每种信源怎么配置

### rss

```json
{ "feedUrl": "https://example.com/feed.xml" }
```

可选：`summaryIsBody`（确认文字订阅里的摘要就是全文时，将 RSS 的 `description`、Atom 的 `summary` 当正文，不再去抓原文页）、`allowCategories` / `denyCategories`（按订阅里的分类过滤）。

所有信源的 YouTube、Vimeo 视频播放页都不作为文章正文提取。Media RSS 的视频描述保留为摘要，即使设置了 `summaryIsBody` 也不会把描述当成视频字幕；订阅通过 `content` / `content:encoded` 提供的真实文字仍可使用。其他文章中嵌入视频，不影响文章本身的正文读取。

文章正文中的原生视频保留安全的媒体地址和候选格式，使用浏览器控件手动播放。视频文件由浏览器直连原站，封面沿用图片代理；不自动播放、不循环，预加载提示设为 `none`，但浏览器不保证交互前完全没有请求。没有媒体地址和可用封面的播放器只保留后备文字。Markdown 和允许再分发的全文 RSS 保留视频结构，能否播放取决于阅读器；动态平台播放器和 iframe 不在此范围。

没有网页的播客单集（没有 `<link>`、`guid` 也不是网址），原文链接用它的音频或视频文件，浏览器可以直接播放；这类单集不抓网页，按订阅里的文字处理。

### web_list

默认 GET。公开列表若通过表单 POST 返回 HTML，可设 `method: "POST"` 和 `bodyForm: {"page_no":"1","page_size":"100"}`（值为字符串）。行内没有 href、由脚本根据行属性跳转时，可设 `urlTemplate: "https://example.com/news/details?id={id}"`，占位符从 `itemSelector` 对应元素的属性读取并进行 URL 编码；缺少属性则跳过该行。此配置仅用于已核验的公开列表查询，POST 不自动重试。日期仍通过列表或详情选择器读取原文发布时间。

支持普通 CSS 选择器，`div` 列表也能采集。关键是 `itemSelector` 要选中**每条新闻**，而不是包住所有新闻的容器。例如：

```html
<div class="news-list">
  <div class="news-item">
    <h2><a href="/posts/first">第一条示例新闻</a></h2>
    <time datetime="2026-10-01T09:00:00+08:00">10 月 1 日</time>
  </div>
  <div class="news-item">
    <h2><a href="/posts/second">第二条示例新闻</a></h2>
    <time datetime="2026-10-01T10:00:00+08:00">10 月 1 日</time>
  </div>
</div>
```

对应配置（`example.com` 是占位地址，换成目标网页；可运行版本见[本地示例](#本地跑通-htmljson-示例)）：

```json
{
  "url": "https://example.com/news",
  "parseMode": "html",
  "itemSelector": ".news-list > .news-item",
  "linkSelector": "h2 a",
  "titleSelector": "h2 a",
  "publishedAtSelector": "time",
  "allowUrlPrefixes": ["https://example.com/posts/"]
}
```

- `itemSelector` 在整个页面找条目；`linkSelector`、`titleSelector` 在每个条目内取第一个匹配节点，也可以匹配条目自身。选 `.news-list` 只会得到一个容器，通常只取到第一条新闻；只写 `div` 又会混入嵌套容器。要选重复出现的新闻节点。
- 链接取自 `href`；`/posts/first` 等相对链接按列表重定向后的最终地址解析，也可用 `baseUrl` 指定基准地址。标题取节点文字。重复链接会合并；Markdown 列表先出现“Read more”等按钮、后出现真实标题时，使用真实标题。指向列表自身的链接通常会跳过。
- 日期在条目内查找 `publishedAtSelector`，依次尝试 `datetime`、`content`、`title` 属性和文字，无法解析的提示文字不会遮住同一节点的有效日期。没有时区的日期时间可用 `publishedAtUtcOffset`（默认 `+08:00`）；自带时区的时间保留原时区语义，纯 `YYYY-MM-DD` 按 UTC 零点读。不完整的月份、产品版本号和不存在的日历日期不作为发布日期。
- `parseMode`：普通网页默认 `html`；`markdown` 按 Markdown 链接读；`docusaurus_changelog` 读更新日志标题；`intercom_changelog` 按 Intercom 帮助中心的日期章节读取标题和正文，每节保留自己的网址锚点，默认按 UTC 日历日读取，也可指定 `publishedAtUtcOffset`。需要 Jina 时，显式把 `url` 写成 `https://r.jina.ai/https://目标站/路径` 并配置 `JINA_API_KEY`，不是抓不到就自动切换。Jina 默认返回 Markdown；要继续使用 CSS 选择器，显式设 `parseMode: "html"`。
- `detail`：列表缺日期、标题或摘要时抓详情页补齐（`publishedAtSelector`、`titleSelector`、`summarySelector` 等）。读取失败或本轮 `maxFetches` 用完的条目，后续抓取继续补全；补元数据时保留已确认的正文。已有真实标题不会因为列表仍写“Read the Blog”而被换回按钮文字，也不会仅因标题较长再次读取详情。需要强制使用详情标题时设置 `titleAuthoritative: true`。详情页和正文提取读到不带时区的时间时，先用 `detail.publishedAtUtcOffset`，未设则继承信源的 `publishedAtUtcOffset`，两处都未设时默认 `+08:00`。RSS、JSON 列表也可以用 `detail`。
- Jina 列表的 `detail.titleRegex`、`publishedAtRegex` 匹配 Jina 文本，可共用同一次详情响应；CSS 选择器读取原站 HTML。应按实际可读取的页面选择规则。
- `allowUrlPrefixes` / `denyUrlPrefixes`：只收某些路径下的文章。

### json_list

假设接口返回下面的结构，`itemsPath` 指向数组，其他字段路径相对**每个数组元素**填写。路径用点分隔，不是 JSONPath，不写 `$` 或 `[*]`。

```json
{
  "data": {
    "items": [
      {
        "id": "first",
        "title": "第一条示例新闻",
        "url": "https://example.com/posts/first",
        "summary": "第一条新闻的摘要。",
        "published_at": "2026-10-01T09:00:00+08:00"
      }
    ]
  }
}
```

对应配置：

```json
{
  "url": "https://example.com/api/news",
  "mode": "json_api",
  "itemsPath": "data.items",
  "titlePaths": ["title"],
  "urlTemplate": "{raw:url}",
  "summaryPaths": ["summary"],
  "publishedAtPath": "published_at",
  "externalIdPath": "id"
}
```

- 接口本身返回数组时，省略 `itemsPath`。`titlePaths`、`summaryPaths`、`authorPaths` 是候选路径数组，按顺序取第一个非空值，例如 `["title", "name"]`。
- 已有完整网址时用 `{raw:url}`；只有 slug 时可用 `https://example.com/posts/{slug}`。`{字段路径}` 会编码字段值，`{raw:字段路径}` 原样插入。JSON 列表不会自动把相对网址补成绝对网址，模板应产出完整的 HTTP(S) 地址。
- `summaryIsBody`：确认接口里的摘要就是全文时设为 `true`，把 `summaryPaths` 取到的文字当正文，不再去抓原文页。
- 日期建议返回带时区的 ISO 字符串；`2026-09-30 17:43:58` 这类不带时区的时间，与网页列表一样按 `publishedAtUtcOffset` 读（默认 `+08:00`）；数字时间戳分别设 `publishedAtUnit: "epoch_s"`（秒）或 `"epoch_ms"`（毫秒），`20261001` 这类日期设 `"yyyymmdd"`。
- 缺少标题或无法生成链接的条目会跳过。非空数组全部映射失败时，会报 `no items mapped (check title/url paths)`；路径不是数组时，会报 `items path did not resolve to an array`。

### 本地跑通 HTML/JSON 示例

仓库提供两份虚构示例：[news.html](examples/sources/news.html) 和 [news.json](examples/sources/news.json)，各有两条新闻。它们用于核对选择器和字段映射，不是运营信源；示例文章链接不提供正文。

在仓库根目录、Node.js 24.11 以上运行以下命令。服务只监听本机，只提供这两份文件；用 `Ctrl+C` 停止。

```bash
node --input-type=module -e '
import http from "node:http";
import { readFileSync } from "node:fs";
const files = {
  "/news.html": ["text/html; charset=utf-8", readFileSync("docs/examples/sources/news.html")],
  "/news.json": ["application/json", readFileSync("docs/examples/sources/news.json")]
};
http.createServer((req, res) => {
  const file = files[req.url];
  res.writeHead(file ? 200 : 404, { "content-type": file ? file[0] : "text/plain" });
  res.end(file ? file[1] : "Not found");
}).listen(8787, "127.0.0.1");'
```

在同一台机器上，按[非 Docker 部署方式](deploy.md#不用-docker)准备好数据库，用 `npm run dev:api`、`npm run dev:web` 运行开发 API 和网页，保持采集、模型、飞书和 IndexNow 开关关闭，不启动 worker。仅为此次本机示例，在开发 API 进程设置 `ALLOW_PRIVATE_NETWORK_FETCH=true` 后重启；默认禁止抓内网地址，生产环境拒绝启用此项，验证后移除。若 API 在容器或另一台服务器，`127.0.0.1` 指向它自己，此命令的地址不能直接用于该部署。

分别选择 `web_list`、`json_list`，粘贴配置并点“预览抓取”，无需创建信源：

```json
{
  "url": "http://127.0.0.1:8787/news.html",
  "parseMode": "html",
  "itemSelector": ".news-list > .news-item",
  "linkSelector": "h2 a",
  "titleSelector": "h2 a",
  "publishedAtSelector": "time",
  "allowUrlPrefixes": ["http://127.0.0.1:8787/posts/"]
}
```

```json
{
  "url": "http://127.0.0.1:8787/news.json",
  "mode": "json_api",
  "itemsPath": "data.items",
  "titlePaths": ["title"],
  "urlTemplate": "http://127.0.0.1:8787/posts/{id}",
  "summaryPaths": ["summary"],
  "publishedAtPath": "published_at",
  "externalIdPath": "id"
}
```

两次都应显示 **2 条**，依次为下表内容。JSON 示例还显示对应摘要，HTML 示例没有配置摘要提取。预览 API 的日期是 UTC，后台界面按 `+08:00` 显示为 09:00 和 10:00。

| 标题 | 原文链接 | 预览 API 的 publishedAt |
|---|---|---|
| 第一条示例新闻 | `http://127.0.0.1:8787/posts/first` | `2026-10-01T01:00:00.000Z` |
| 第二条示例新闻 | `http://127.0.0.1:8787/posts/second` | `2026-10-01T02:00:00.000Z` |

可以把 HTML 的 `itemSelector` 暂改成 `.news-list` 对照：只会返回第一条。改回 `.news-list > .news-item` 后恢复两条，这就是“列表容器”和“每条新闻”的区别。

抓真实网页时先看原始 HTTP 响应中有没有新闻节点。普通 HTML 模式不执行 JavaScript；浏览器里看得到、响应里没有的内容，不能靠换一个 CSS 选择器生成。优先找 RSS 或 JSON 接口，或按需配置 Jina / 自己维护的外部采集。`no items matched (html)` 还可能是选择器不匹配、没有 `href` 或标题、链接被前缀规则过滤；先核对响应与配置，不必先更换采集器。

### x_search

这类信源使用 SocialData 搜索，不是把 X 个人主页 URL 填入网页列表。以 `https://x.com/SomeAccount` 为例，取用户名 `SomeAccount`，不要包含 `@` 或整段 URL：

```json
{ "query": "from:SomeAccount -filter:replies", "searchType": "Latest" }
```

`SomeAccount` 是占位用户名，换成你要关注的真实账号。`-filter:replies` 排除回复；`Latest` 按最新内容查找。

在后端运行环境的 `.env` 配置 `SOCIALDATA_API_KEY`，重启 API（预览）和 worker（定时采集）后生效；不要把 key 写进信源 JSON 或提交到仓库。先在后台“设置 → 付费请求上限”检查 SocialData 额度，再按需预览。未配置 key 会报 `SOCIALDATA_API_KEY is not configured`；服务拒绝请求或预算熔断时看后台错误原因。预览可能有付费请求，本文不要求用真实服务验证，结果取决于账号和服务当时的返回。

生产自动采集时，普通账号会被自动合并成一次搜索（每次最多二十几个账号），省请求数；单个信源的手动预览不是合并采集。

### mp_account

```json
{ "ghid": "gh_xxxxxxxx", "nickname": "公众号名称" }
```

每个公众号按它的抓取间隔检查一次（查列表按次计费），新文章的正文一并取回。

需要在后端 `.env` 配置 `DAJIALA_KEY`，`ghid` 换成公众号原始 ID。配置字段用上面的 `ghid` / `nickname`，不要写成 `biz` / `name`。当前 `mp_account` 不支持“预览抓取”；`external` 也不支持主动试抓，按下方推送接口接入。

## 分级、参与方式与全文

- **分级** `tier`：`T1` 官方一手（官网、官方博客、机构）、`T1_5` 官方账号与准官方创作者、`T2` 媒体与个人、`EXCLUDE_MP` 不参与精选。入选门槛按分级不同（`industry/selection.ts`）。
- **参与方式** `participation_mode`：`editorial` 进精选和全部动态；`hot_signal` 不单独展示，只作为“大家在讨论什么”的热度证据；`isolated` 不进任何公开页面。
- **一手**：只有 `T1` 算一手，不单独设置。同一条新闻有几篇报道时，代表报道优先选一手的，事件页也优先展示一手报道。
- **发布方**（可选，写在 `config` 里）：
  - `publisherUrlPrefixes`：`T1` 信源自己文章网址的前缀，比如 `["https://example.com/blog/"]`。别的信源（聚合站、转帖）带来的这些网址的文章，只要能认定是唯一一个官方信源的，就改记到它名下。网页列表信源不写时，认它自己列表所在的路径（这篇也要在它的列表里出现过）。
  - `publisherRole`：`T1_5` 账号的身份，`organization`（机构官方账号）或 `person`（官方人员）。再填上信源的 `owner_entity_id`（`industry/taxonomy.ts` 的 `ENTITIES` id），这个账号发的、主体正是这家公司的新闻，就能当代表报道（排在 `T1` 之后）。
- **全文**：`site_fulltext` 决定站内能不能显示全文，`syndicate_fulltext` 决定全文 RSS 能不能带正文。两者**默认都关**，只显示摘要和原文链接；来源明确允许时再打开。公众号、付费墙内容不会因为技术上抓得到就获得全文展示。

## 大厂观察新增国内商业媒体（2026-10-24）

新增晚点 LatePost、深网（腾讯新闻）、远川研究所、互联网怪盗团，均使用 BestBlogs 公开维护的 Wechat2RSS 桥接入口。地址来自 [BestBlogs OPML](https://github.com/ginobefun/BestBlogs/blob/main/opml/bestblogs_wechat2rss_opml_all.opml)，并在首尔实际解析了正文、原文链接与发布时间；不是媒体自己提供的官方 RSS，桥接服务仍可能延迟或中断。晚点对话虽然可解析，但最新内容停在2025年，不作为本轮新增来源。

这四个入口的短摘要不能代表正文，不设置标题/摘要关键词闸门：实测该闸门会漏掉田柯宇事件等公司名仅在正文出现的调查稿。入库后仍经过正文相关性预筛、原有精选评分及归组，不因来自知名媒体就公开或精选。首次最多回灌五条、只看近一个月材料，按原文时间归档，不刷成今天的新消息。站内继续只展示摘要和原文链接，不开放转载全文。信息源名称已经补齐英文界面译名。

## 公众号转 RSS 接入（2026-10-26）

公众号转换服务已经提供 RSS/Atom 地址时，按 `rss` 接入，配置 `feedUrl` 即可，不需要改成 `mp_account` 或为本站新增微信公众号 API。当前使用公开的 Wechat2RSS 桥接；如果以后使用自建 WeRSS/WeWe RSS，同样填它生成的订阅地址，服务本身的登录和续期由服务端维护。带私有订阅令牌的地址只放后台，不提交到公开仓库。

本轮在首尔使用现有采集器试读以下入口；数字是此次 RSS 列表条数及经过标题范围、日期检查后的候选数，**不是已经公开的资讯数**，后续仍有模型准入与事件归组。

| 入口 | 类型与范围 | 试读 → 候选 |
| --- | --- | ---: |
| 硅谷101 · 企业与竞争 | 公众号 RSS 桥接，保留具名互联网企业的业务、竞争与管理访谈 | 10 → 2 |
| 游戏研究社 · 企业与员工 | 公众号 RSS 桥接，保留互联网游戏企业及工作室的组织、员工与业务报道，排除普通游戏体验 | 10 → 1 |
| 晚点AI · 企业与商业 | 公众号 RSS 桥接，只保留具名企业的商业与竞争材料；与晚点共用媒体信号组 | 10 → 1 |
| 中国新闻周刊 · 互联网与职场 | 公众号 RSS 桥接，标题须体现互联网企业或从业者范围；不收泛社会新闻 | 10 → 0 |
| [人人都是产品经理 · 业界动态](https://www.woshipm.com/category/it/feed) | 原生 RSS，只取业界栏目，排除教程及泛营销；这是作者与转载平台，不把转载视为独立证实 | 15 → 5 |
| [虎嗅 · 原生RSS](https://rss.huxiu.com/) | 媒体原生 RSS，补充网页栏目覆盖，与既有虎嗅入口共用媒体信号组 | 130 → 11 |

四个公众号订阅地址来自 [BestBlogs OPML](https://github.com/ginobefun/BestBlogs/blob/main/opml/bestblogs_wechat2rss_opml_all.opml)。它们依旧共享同一桥接服务，不能将新增入口数当成新增独立基础设施。两项原生 RSS 不依赖该公众号桥接，但不是其他公众号的自动镜像。公众号转换服务的试用、登录或套餐不属于本站 RSS 适配器的能力。

新增入口每 120 分钟采集，首次各最多导入 2 条、仅回填近一个月并保留原文日期。没有合格候选就记录真实空列表，不放宽范围凑数；自动精选继续暂停，站内和订阅均不开放转载全文。标题范围检查避免文章尾注的“微信”等词放行无关内容，之后仍按正文判断相关性。微信原文查询参数使用既有地址归一化规则，虎嗅 `f=rss` 与网页地址归为同一篇材料。

晚点对话最新条目仍停留在 2025 年；见实近期样本偏私域促销，Z Potentials 等样本偏初创 AI 推广，未启用。Wechat2RSS 的另一公开目录本次返回 403，没有绕过验证或将其算作接通。自建 WeWe RSS 需要微信读书扫码及维护登录状态，本轮没有代建、导入个人会话或新增付费服务。

## 脉脉职场热榜线索（2026-10-26）

本站使用站长授权的服务器私有会话直接读取[脉脉公开热榜](https://maimai.cn/community/hot-rank)。已停用 [decemberpei/Rss](https://github.com/decemberpei/Rss) 的第三方桥接：它曾持续返回 HTTP 200，但正文只有报错占位。榜单只用于发现话题，标题、榜单刷新时间和抓取时间不当作原帖材料。

公开收录需要可追溯原帖或正常媒体、企业公告等来源，并经过既有准入流程。核实范围包括具体公司、部门、时间、岗位、待遇口径和回应；匿名自述、媒体转述与企业确认应明确区分。多家媒体转载同一爆料不算多份独立证据。2026-10-26用户进一步确认：具名企业、原帖内容及可靠时间明确时，可在资讯中展示未经独立核实的发言，不要求先有媒体报道或企业确认。热榜本身仍隔离，原帖采集与公开规则如下。 例如热榜的“TikTok电商负责人离职”，[科创板日报的报道](https://i.ifeng.com/c/8xVjyJ3rBgV)具体指向欧洲业务负责人，不能沿用更宽泛的标题。

### 脉脉原帖接入

`modules/maimai/server.ts` 从公开热榜按榜单顺序读取最多15个不同话题，再合并话题分享页的热门列表与官方“最新”首屏。只对至少10个点赞或5条评论的相关公开原帖回查时间，按“点赞数＋2×评论数”排序，每个话题最多送审5条具备署名、可分享标识、正文及原发时间的帖子，仅处理近7天内容。热榜标题未命中职场和企业关键词时，原帖需要自己提供这两类线索。帖子用 `maimai:post:ID` 去重，不拼接评论，不把二手转述称为本人亲历。原帖入口使用已实际验证的 `/n/content/gossip-detail/ID?egid=…&gid=ID`；不保存分享者标识、operation_id、IP属地、头像或其他页面用户资料。

帖子写入 `external-maimai-posts`。正常每30分钟读取热榜和原帖；失败后按60、90、最长120分钟重试。榜单读取失败时最多沿用24小时内的成功快照，并如实记录失败。原帖列表没有精确发布时间时，先复用同一帖子 ID 已确认的时间，再用原帖短语查询脉脉搜索页。每轮最多24次搜索，分批检查候选；只接受 ID 一致的有效原发时间。找不到精确时间的帖子不入库。会话过期需更新服务器私有配置。

既有站点升级后停用数据库中的旧 `rss-maimai-hot` 信源（`UPDATE sources SET enabled = false WHERE id = 'rss-maimai-hot' AND kind = 'rss';`），保留历史采集记录。新站点不再创建该信源。

入库后复用原有预筛、摘要、分类和事件归组。只有热榜标题仍不公开；泛评论、重复转评及没有新增事件信息的观点不因此放行。`config.publicationNotice: "未经独立核实"` 在发布层强制加入标签及摘要前缀，适用于网页、RSS、Markdown及API，模型漏写或人工改普通标签不会清除声明；手机、电脑及英文界面都有显著标记。来源声明变更会排队重建其公开投影。

采集限于每个话题的两个列表首屏，不读取完整评论，也不声称核验发帖者真实身份/任职。原帖原有的“听说”“据朋友说”等归属必须保留。后续企业回应、否认和媒体跟进仍走既有来源与事件链，不把多帖转述当作多份独立证据。本轮试验的免费搜索 RSS 返回大量无关官网结果，未把它作为已接通的自动跟进搜索服务。

## 抓取频率

大厂观察启用的自动采集来源默认为每120分钟一次，脉脉热榜原帖每30分钟一次。失败时按各自规则退避。下面的自适应节奏是框架在未配置站点固定间隔时的行为，不代表本站当前配置。`external` 仅接收外部推送，不因 enabled 就代表已接通自动轮询。

每个信源有自己的抓取间隔。每天 04:20 会按近 7 天的产出自动调整：产出多的抓得勤，最短 15 分钟（经 Jina 读的网页列表最短 60 分钟）；最长的，一般信源 60 分钟，X 账号和经 Jina 读的网页列表 120 分钟，只作热度证据的 180 分钟。合并搜索的 X 账号跟着合并后的节奏：进精选的半小时一次，只作热度证据的一小时一次。

抓取失败不推进位置，下次从同一处继续；连续失败的信源在后台标红，每周一会在运营群发一份信源周报（配置了飞书内部群时）。

## 规则：旧文不刷屏

首次发现时原文已经发布超过 48 小时的资料、新信源第一次导入的存量条目、标记为回灌的推送，都按原文时间归档：不进入“今天”，也不推送。没有可信发布时间的资料先不公开（不进公开列表、精选、报告、热点和推送），从原信源或原文页读到日期后再判断新旧。这条规则所有入口共用，防止一次性导入历史内容刷屏。

新信源第一次导入时，只取列表里前 `_aihot.initialBackfillLimit` 条（默认 30）、`_aihot.initialBackfillMonths` 个月以内（默认 12）的条目。之后的抓取只收发布时间在信源第一次导入前 48 小时以内或之后的条目，列表里更早的存量不再进来，不会为整个订阅存档付费；第一次导入以后发布的条目，排在长列表第几条都会收。列表上没有发布时间的条目照收，按上面的规则等读到日期再判断。X 账号按抓取位置往后读，不受这条限制。

如果只想从一个固定时间之后开始监控，可在 RSS、网页列表、JSON 配置中设置 `publishedAfter`，例如 `"2026-10-01T00:00:00.000Z"`。必须是完整的 UTC 时间，可省略毫秒；预览、首次和后续采集都只接受**严格晚于**它且发布日期可信的条目，未知日期也会排除。起点当天的单页更新章节若仍使用同一发布日期，之后追加的内容也不会被纳入；选择起点时要把这个限制考虑进去。

## 外部推送接口

自己写脚本抓的内容，可以推进站里，走和普通采集一样的判重、精选和归组。

```
POST /api/ingest/items
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{
  "sourceId": "my-crawler",
  "sourceName": "我的抓取脚本",
  "items": [
    { "title": "必填", "url": "必填", "publishedAt": "2026-10-01T08:00:00+08:00", "author": "可选" }
  ]
}
```

- `INGEST_TOKEN` 在 `.env` 里设置，至少 16 位；不设置时接口一律返回 401。
- 每次最多 50 条，超过返回 413。每个客户端每分钟能推几次由 `INGEST_RATE_LIMIT` 决定：`docker compose` 默认 10，超过返回 429（带 `Retry-After: 60`）；不用 Docker 时默认不限，前面没有反向代理限流的话在 `.env` 里设上，设成 0 表示不限。
- 返回 `{"ok": true, "created": <新建条数>}`。不是 JSON 对象的条目、缺标题或网址的条目会被跳过，同一请求里重复的网址只取第一条。
- `sourceId` 不存在时会自动建一个 `external` 信源，默认不进公开页面：到后台把它的参与方式改成 `editorial` 才会出现在站上。
- 在后台暂停信源后，推送接口返回 409，不再接收新文章；恢复信源后可以继续推送。
- 条目的 `raw._aihot.backfill` 为 `true` 时按历史回灌处理（不进入“今天”、不推送）。

### 微博公开原帖（大厂观察）

`web_list` 的 `adapter: "weibo_profile"` 读取已核验账号的服务端 HTML；例如 `url: "https://weibo.com/foxshuo"`，并用 `allowUrlPrefixes: ["https://weibo.com/1560906700/"]` 限定作者。

只读取公开原创文字，按原帖绝对日期与北京时间入库，移除来源追踪参数。列表里的“展开全文”只作摘录，待原帖详情返回完整文字才确认正文；登录页、其他帖子的文字及转发上下文不当成该帖正文。当前不识别配图里的证据，不采转发帖；摘要应保留作者归属和传闻边界。完整文字仍须通过行业预筛和评分，来源可采集不代表每条都公开或精选。无匹配帖子会记为采集失败，进入既有退避和健康检查，不把登录墙算作成功。

### 宽泛科技媒体的标题准入

`ingestNoiseFilter.requireTitleAnyMatches` 要求标题至少命中一个配置词；`requireAnyMatches` 仍检查标题和摘要，两项同时配置时均须满足。标题准入先于 `keepIfMatches`，尾注里的“关注微信公众号”等文字不能让无关标题获得准入。未配置此项的现有来源行为不变。该规则只减少采集噪声，入库后仍需正常相关性和精选评判。

## 媒体直连接入（2026-10-27）

| 信源 | 公开入口与读取方式 | 范围与时间依据 |
| --- | --- | --- |
| 北京商报 · 科技（暂不启用） | [官方科技栏目](https://www.bbtnews.com.cn/chuizhipd/Company%20Research%20New/KJPD/)，HTML文章列表及详情 | 企业与职场主题；详情页署名栏日期为准。原站仅提供日期时保留日期精度，不以采集时间补造分钟。 |
| 财联社 · 公司报道 | [官方首页](https://www.cls.cn/index)公开的 `__NEXT_DATA__ → depth_list`，原文为 `/detail/{id}` | 过滤 `is_ad != 0`、股票题材合集与促销；使用原始 `ctime` 秒级时间，正文由原文页提取。 |

两者是新增的媒体配置，不依赖Wechat2RSS、BestBlogs或RSSHub。信号组分别为 `media-bbtnews` 和 `media-cls`，不能将同一媒体未来的多个入口重复计作独立热度证据。当前仅启用财联社；北京商报因复验详情持续403保持停用，不计入新增可用数。启用来源首次最多导入2篇、最近1个月内的候选，固定每120分钟采集；仍须通过行业准入、摘要、分类与事件归组。自动精选继续暂停，不为新增来源恢复评分。只有摘要及原文链接公开，未取得全文再分发许可。

首尔服务器首次试读曾读取北京商报金山办公财报稿，但新镜像复验时详情持续403，故停用待恢复；财联社的Meta合作与红果治理稿在新镜像中均提取成功。财联社部分有效HTML响应缺少 `Content-Type`，正文提取仅在缺少该头且存在HTML文档签名时兼容；显式JSON或无文档签名的响应不会按HTML处理。新增的本地HTTP回归覆盖正常提取、详情复用和错误响应拒绝。

本轮未启用的候选：TechWeb原生RSS在本机可读，但服务器将主机名解析至回环地址；新京报科技栏目在服务器连接超时；中新网IT RSS返回空频道；中国经济网当前科技列表及霞光社焦点RSS未找到足够符合本站定位的近期样本；数个公众号免费RSS返回502；部分企业IR页面返回403。不绕过访问限制，不把能打开目录或HTTP 200但无文章的页面算作接通。

文章发布时间有效不代表事件刚发生；旧闻重发、旧事新回应与历史归档的区别见[资讯时间与旧闻重发](content-freshness.md)。时效性核对复用原有行业预筛，不增加模型调用步骤。
