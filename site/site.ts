// 站点身份和读者看得到的文案。换成你的行业时，先改这个文件。
// 网页和后端都读它；改完重新构建（docker compose up --build）即可生效。
// 域名不在这里：部署时用环境变量 SITE_URL 设置。

/**
 * 日报、周报、月报什么时候出（北京时间，HH:mm）：日报收这个时间之前的 24 小时，周报在每个自然周之后的周一出，
 * 月报在每月 1 日出。排程、成刊时间窗口、缺期告警和所有提到时间的文案都读它（public/ 里的文件写占位
 * {{dailyTime}}、{{weeklyTime}}、{{monthlyTime}}）；排程每半小时检查一次，所以写整点或半点。
 */
export const EDITION_TIMES = { daily: "08:00", weekly: "10:00", monthly: "10:30" };

/** 大厂观察默认每两小时采集，脉脉热榜对应原帖每半小时采集。 */
export const MAIMAI_COLLECTION = { sourceId: "external-maimai-posts", intervalMinutes: 30, maxBackoffMinutes: 120 };

export function collectionIntervalMinutes(sourceId?: string): number {
  return sourceId === MAIMAI_COLLECTION.sourceId ? MAIMAI_COLLECTION.intervalMinutes : 120;
}

/** “每天 08:00”“每周一 10:00”“每月 1 日 10:30”：写进句子里的出刊时间。 */
export const EDITION_WHEN = {
  daily: `每天 ${EDITION_TIMES.daily}`,
  weekly: `每周一 ${EDITION_TIMES.weekly}`,
  monthly: `每月 1 日 ${EDITION_TIMES.monthly}`,
};

/** 建设期暂停自动精选；恢复为 true 后沿用既有评分、门槛和历史标注。 */
export const EDITORIAL = { selectionEnabled: false as boolean };

export const SITE = {
  // Public ownership marker for the operator's Google Search Console account, not a login secret.
  googleSiteVerification: "yQ1Un6Ws5qt8wnM0-47uJDDpA8ri--EkT3grzXElG8g",
  /** 站名：导航、页面标题、分享图、RSS、MCP、后台都用它。 */
  name: "大厂观察",
  /**
   * 行业词：拼进默认说法里，比如“AI 日报”“AI 动态”。
   * 改成“法律”“HR”“黄金”之类，页面上就会变成“法律日报”“法律动态”。
   */
  subject: "互联网",
  /** 首页的完整标题（浏览器标签、搜索结果）。 */
  homeTitle: "大厂观察 — 互联网公司与职场动态",
  /** 主题目录页（/topics）的标题。 */
  topicsTitle: "互联网主题：公司、产品与行业变化",
  /** 反馈表单输入框里的示例。 */
  feedbackExample: "例如：我在搜索某个关键词时遇到……我原本想……",
  /** 反馈页标题下面的一句话。 */
  feedbackLead: "发现 bug、想要的功能、看不顺眼的地方，都可以告诉我们。",
  /** 反馈表单邮箱框里的提示。 */
  feedbackEmailHint: "留下邮箱，我们可以回信联系你",
  /** 一句话介绍：搜索引擎、分享卡片、RSS、llms.txt 会用。 */
  description: `面向互联网中大厂职场人的资讯站，聚焦互联网行业与企业发展，关注公司战略、经营数据、业务布局、产品竞争和资本动作，重点追踪阿里、电商与本地生活，把同一件事的多篇报道归到一起，${EDITION_WHEN.daily} 出一份日报。`,
  /** llms.txt 里一句话介绍下面的一段详细介绍（选填）。 */
  llmsIntro: null as string | null,
  /** 一行小字：分享图、海报下方。 */
  tagline: "看懂互联网行业与企业发展",
  /** 搜索引擎读到的关键词（首页结构化数据）。 */
  keywords: ["大厂观察", "互联网资讯", "互联网日报", "互联网行业动态", "产品动态", "阿里巴巴", "电商", "本地生活", "即时零售", "组织人才", "职业成长"] as string[],
  /** 网站开始收录的年份（结构化数据的时间范围，选填）。 */
  since: null as string | null,
  /** 界面语言（HTML lang、og:locale）。 */
  locale: "zh-CN",
  /** 默认域名，只在没设置 SITE_URL 时使用。 */
  defaultUrl: "http://localhost:3000",
  /** 标准图标（favicon.ico、icon.png、icon-192.png、apple-icon.png、logo.svg）以外也放在网站根目录的图标，site/brand/ 里的文件名（选填）；manifest.webmanifest 或外站引用了它们时用。 */
  rootIcons: [] as string[],
  /**
   * MCP 工具名的前缀（小写字母、数字、下划线），工具会叫 tiantianhot_get_latest、tiantianhot_search……
   * 已经有人接入后就不要再改。
   */
  mcpPrefix: "tiantianhot",
  /**
   * 公开接口（MCP、OpenAPI、llms.txt）的版本号，只升不降。
   * 改了接口里已有的字段或含义时升主版本，并在部署说明里写清。
   */
  interfaceVersion: "4.0.0",
  /** 对外联系邮箱（选填）：llms.txt 和给 Agent 的使用说明里会写。 */
  contactEmail: "skynettiantian@gmail.com" as string | null,
  /** 关于页底部的一行小字（选填）。 */
  footerNote: "由 AIHOT 开源框架驱动",
  /** 中国大陆网站的 ICP 备案号（选填），填了就显示在侧栏底部和“我的”页底部，并链接到工信部备案系统。 */
  icp: null as string | null,
  /** 源码的 GitHub 仓库地址（选填），填了就在侧栏底部和“我的”页底部显示“GitHub 开源”。 */
  github: null as string | null,
  /** 结构化数据里的网站运营者（搜索引擎用）。 */
  organization: {
    name: "大厂观察",
    /** 创始人（选填）。 */
    founder: null as null | { name: string; alternateName?: string; jobTitle?: string; description?: string; url?: string },
  },
  /** 抓取信源时报上的名字和版本（User-Agent 里用），不要冒用别的站。 */
  crawlerName: "DachangGuanchaBot/1.0",
} as const;

/** 使用规则和隐私说明两页（正文在 pages/ 里）。 */
export const POLICY = {
  terms: {
    /** 页面名：导航、页脚、页面标题都用它。 */
    name: "使用规则",
    description: "本站网页、RSS、公开 API 与 MCP 的使用规则。",
    /** llms.txt 里对这一页的一句说明（选填）。 */
    covers: null as string | null,
    /** Agent 接入页的 RSS、API 两栏各自提醒的使用规则（选填）。 */
    notes: null as null | { rss: string; api: string },
    /**
     * 讲清哪些用途要先取得授权的话（选填）：llms 接在 llms.txt“使用说明”的版权说明后面，
     * agent 写在给 Agent 的使用说明“使用规则”一节的开头。
     */
    license: null as null | { llms: string; agent: string },
    /**
     * 公开 API、RSS 和 OpenAPI 文件声明使用规则的响应头（选填）：原样附上，再加一个指向这一页的
     * Link 头（rel="terms-of-service"）；浏览器里的调用方也读得到它们。
     */
    headers: null as null | Record<string, string>,
  },
  privacy: {
    description: "本站如何处理浏览器本地数据、反馈资料与访问日志。",
    /** llms.txt 里对这一页的一句说明（选填）。 */
    covers: null as string | null,
  },
  /**
   * X 帖子本身的文字和图片算不算全文：算的话，只在这篇允许站内全文时显示（信源允许全文、正文也取到了）；
   * 不算的话总是显示，和标题、摘要一样。
   */
  xPostIsFullText: true,
} as const;

/** 导航（电脑侧栏、手机底栏、“我的”页）。 */
export const NAV = {
  /**
   * 不放进导航的引擎入口：热点榜、主题、关于、更新日志。页面照样能打开；原来回到它的返回按钮和链接改回精选，
   * 写 "/hot" 时首页也不放当前热点。
   */
  hidden: ["/about", "/changelog"] as Array<"/hot" | "/topics" | "/about" | "/changelog">,
};

/** 条目卡片和详情页上的几处说法和显示。 */
export const ITEM_COPY = {
  /** 模型写的那句理由叫什么：卡片、详情页、Markdown 导出、给 Agent 的回答和群推送都用它。 */
  reasonLabel: "推荐理由",
  /** 读者在网页和分享图上看不看得到 AI 评分。只管显示：公开 API 和 MCP 的数据照样带 score，后台照常显示。 */
  showScore: EDITORIAL.selectionEnabled,
};

/** 关于页的一张二维码卡片。 */
interface ContactCard {
  kind: string;
  title: string;
  note: string;
  /** 站外链接过的根目录文件名（选填），比如 qr-wechat.jpg：这个地址总是跳到现在的二维码。 */
  alias?: string;
}

/** 关于页的文案。数字（信源数、收录数、精选数、日报期数）来自站内实时统计，不用写在这里。 */
export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  /** 页面描述（搜索结果、分享卡片）。 */
  description: `关于 ${SITE.name}：${SITE.description}`,
  /** 大标题：第一行正常颜色，第二行强调色。 */
  headline: ["互联网每天都有新动静，", "值得看的，只有几条。"] as [string, string],
  /** 标题下面的一段话。{sources} 会换成实时的信源数（两边自动加空格，所以 {sources} 两边不写空格）；统计没取到时换成 sourcesFallback。 */
  lead: `${SITE.name} 替你盯着{sources}个信源：抓取、归并、打分、精选，${EDITION_WHEN.daily} 出一份日报。免费，不用注册。`,
  sourcesFallback: "十几",
  /** 信源河动画下面的四个环节。 */
  steps: {
    collect: "每两小时检查一次启用的自动信源；抓取失败时适当延后，发现新内容后继续处理。",
    store: "抓到的都存下来，同一件事的报道归到一起，热点榜就是从这里算出来的。",
    select: `模型先看是不是这个行业的事、有没有实际信息，再写中文标题、摘要和${ITEM_COPY.reasonLabel}；营销稿和重复转发进不来。`,
    publish: `${EDITION_WHEN.daily} 出日报，${EDITION_WHEN.weekly} 出周报，${EDITION_WHEN.monthly} 出月报。`,
  },
  /**
   * 作者块（选填），null 就不显示。
   * avatarSourceId：一个 X 账号信源的 id，头像取它的（选填）。
   * 二维码在后台“设置”里上传，或者放进 site/brand/contact/；没有二维码就不显示那张卡片。
   */
  maker: null as null | {
    name: string;
    avatarSourceId?: string | null;
    greeting: string[];
    wechat?: ContactCard;
    feishu?: ContactCard;
  },
  /** 页面底部的版权与下架说明，中间接“反馈页”的链接。 */
  copyright: [`${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。如果你是来源方，希望更正、下架或调整展示方式，可以通过`, "联系我们。"] as [string, string],
  /** 页面底部“使用规则”链接的锚点 id（选填）：外部文档写死过这个锚点就填上，以后不要改。 */
  termsAnchor: null as string | null,
} as const;

/** 后台页面上给管理员的提示（选填）。 */
export const ADMIN = {
  /** “反馈”页标题下的一行。 */
  feedbackNote: null as string | null,
  /** 确认框里补的一句本站规定：封禁反馈来源时。 */
  banNote: null as string | null,
  /** 确认框里补的一句本站规定：调整付费服务的请求上限时。 */
  budgetNote: null as string | null,
};

/** Agent 接入页的示例。 */
export const AGENT = {
  /** MCP 工具表里“搜索”一行：能搜什么、可以怎么问。 */
  search: { scope: "按公司、产品、人物或话题搜最近 7 天", ask: "这家公司最近发了什么？" },
};

/** 日报、周报、月报版面上的说法。 */
export const REPORTS = {
  /** 报头下面的出版者一行。 */
  imprint: SITE.name.toUpperCase(),
  /** 报头旁边的一个词。 */
  motto: SITE.subject as string,
  /** 每种报告页面的描述（搜索结果、分享卡片），不带句号；llms.txt 介绍周报、月报时也用它。 */
  descriptions: {
    daily: `${SITE.name} ${subjectAfter(`${EDITION_WHEN.daily}（北京时间）发布的`, "行业精编日报")}`,
    weekly: subjectAfter("每周", "行业综合回顾"),
    monthly: subjectAfter("每月", "行业盘点"),
  },
  /**
   * 一期里的一条怎么称呼（“4 件大事”）：没有头条时的标题（“这一天的 4 件 AI 大事”）、报头和往期目录的条数、
   * 周报月报没有总述时的那句话，以及订阅说明里的“按栏目分好的大事”都用它。
   */
  entry: { measure: "件", noun: "大事" },
  /** 报头上其余几个数字后面的说法；精选数和日报期数在关于页、主题页也这样写。 */
  metricUnits: { sourcesCount: "个来源", firstPartyEvents: "件一手发布", selectedCount: "条精选", reportsCovered: "期日报" },
  /** 报告分享图上“共几条”的说法。 */
  shareUnit: "件大事",
  /** 日报时段内有资料经过评判、但没有新大事时的标题与导语。 */
  quiet: { title: "本期暂无入选要闻", paragraph: "本站已评判北京时间 {start} 至 {end} 的收录材料，本期暂无符合选稿标准的新要闻。" },
};

/** 运维告警（只发给站长）里随部署而变的几处说法。 */
export const ALERTS = {
  /** 多少分钟没有收录新文章就告警“网站停止收录新内容”（最多一天）；环境变量 ALERT_QUIET_MINUTES 优先。 */
  quietMinutes: 360,
  /** 同一条告警里，“没有”后面补一句平时的收录量；null 就不写。 */
  usualFlow: null as string | null,
  /** worker 停了的告警里，怎么看它的日志。 */
  workerLogs: "看 worker 的日志（docker compose logs worker）",
};

/** 后台新建信源时的默认设置。 */
export const SOURCE_DEFAULTS = {
  /** 站内展示全文；false 时只显示摘要和原文链接。 */
  siteFulltext: false,
};

/**
 * 社区站的信源（填信源 id）：算热度时按发帖的账号计，一个账号算一个独立来源，而不是整个信源只算一个。
 * dev 是 dev.to 的文章流，hn 是 Hacker News 的帖子流。
 */
export const COMMUNITY_FEEDS: { dev: string[]; hn: string[] } = {
  dev: [],
  hn: [],
};

/** 各页分享图（/og/pages/*.png）上的文字。主题目录页的那张按主题数自动生成。 */
export const CARDS: Record<string, { kicker: string; title: string; subtitle: string; accent?: "hot" | "amber" }> = {
  site: { kicker: subjectAfter("每日", "精选"), title: SITE.tagline, subtitle: SITE.description },
  all: { kicker: subjectAfter("全部", "动态"), title: "所有信源的最新动态，一站看完", subtitle: "按时间汇总各信源的最新动态，可按类别与标签筛选。" },
  hot: { kicker: "热点榜", title: "过去 48 小时，大家在讨论什么", subtitle: "热度指数、趋势与组成热度的公开来源。", accent: "hot" },
  daily: { kicker: withSubject("日报"), title: subjectAfter(`每天 ${spokenTime(EDITION_TIMES.daily)}，一份读得完的`, "日报"), subtitle: `${subjectAfter("前一天值得关注的", "动态")}。` },
  weekly: { kicker: withSubject("周报"), title: `一周${REPORTS.entry.noun}，一次看清`, subtitle: "本周的主线、重要发布与值得回看的讨论。" },
  monthly: { kicker: withSubject("月报"), title: "一个月的变化", subtitle: "月度主线与关键事件回顾。" },
  about: { kicker: "关于", title: `关于 ${SITE.name}`, subtitle: SITE.description },
  terms: { kicker: "使用规则", title: `${SITE.name} 使用规则`, subtitle: "网页、API、RSS 与 MCP 的使用范围。" },
  privacy: { kicker: "隐私说明", title: `${SITE.name} 隐私说明`, subtitle: "访问日志、浏览器本地数据与反馈资料的处理方式。" },
  changelog: { kicker: "更新日志", title: `${SITE.name} 更新日志`, subtitle: "功能更新、优化、公告与下线记录。" },
  feedback: { kicker: "反馈", title: "告诉我们哪里可以更好", subtitle: "内容、功能、接入，或来源方的更正与下架请求。" },
  agent: { kicker: "Agent 接入", title: `把 ${SITE.name} 接进你的 Agent`, subtitle: "MCP、RSS、API 三种方式，匿名只读，无需 API Key。" },
};

/** 公开接口的访问约定里随部署而变的几处：给 Agent 的使用说明、llms.txt 会写。 */
export const ACCESS = {
  /** 同一 IP 每分钟大约能请求多少次，超过会收到 429 并带 Retry-After（选填，由部署的反向代理限流）；null 表示不限流，说明里不提。 */
  ratePerMinute: null as number | null,
  /** 请写程序同步数据的人报上的 User-Agent（选填），写在 JSON 接口的说明后面。 */
  userAgent: null as string | null,
};

/** 这个部署自己的几处安排（选填）。 */
export const DEPLOYMENT = {
  /** 凭据分组文件（models.env、collectors.env……）默认放在哪个目录，相对仓库根目录；环境变量 AIHOT_CREDENTIALS_DIR 优先，都没有就只读环境变量。 */
  credentialsDir: null as string | null,
  /** 凭据分组的文件名（放在凭据目录下，选填）：没写的分组用“分组名.env”，比如 models.env。 */
  credentialFiles: {} as Partial<Record<string, string>>,
  /** 这个部署额外要求的凭据（[分组, 环境变量名]）；生产 API 启动时检查，默认没有额外要求。 */
  requiredSecrets: [] as const,
  /** 线上 api 收到的 Host（CDN 回源用的域名，选填）；本地开发时，网页开发服务器转给 api 的请求也换成它，和线上一致。 */
  originHost: null as string | null,
  /** 反向代理把没登录的后台访问转去登录时，用哪个请求头带上原来的地址（选填，登录后回到那里）。 */
  loginReturnHeader: null as string | null,
  /**
   * 图片代理从原站取图的流量上限：超过后没缓存的图先返回 503，等这一分钟或这一天过去，当天额度用完会进运营日报；
   * null 就不设上限。环境变量 IMGPROXY_UPSTREAM_MB_PER_MINUTE、IMGPROXY_UPSTREAM_GB_PER_DAY 优先。
   */
  imageUpstreamBudget: null as null | { mbPerMinute: number; gbPerDay: number },
  /**
   * 已实测应由服务器直接连接、不走出网代理（EGRESS_PROXY_URL）的域名，采集和图片共用（选填）。
   * 每次重定向重新按目标域名选路，直连仍检查实际连接地址。
   */
  directFetchHosts: [] as string[],
  /**
   * 精选评测（scripts/eval-selection.ts）不带参数时用的金标集：文件（相对仓库根目录）、抽样条数、只抽哪一份、门槛扫描范围。
   * null 就用 .data/gold.jsonl 的全部样本（最多 200 条），在 40–90 之间扫描。
   */
  selectionGold: null as null | { file: string; sample: number; split: string; sweep: [number, number] },
};

/** RSS 订阅源的说明里随站点而变的说法。 */
export const FEED_COPY = {
  /** “全部动态”源的说明里，除了未审内容、低相关条目和已合并重复条目，还写明不含的内容（选填）。 */
  allLeavesOut: [] as string[],
};

/** 面向互联网中大厂职场人的阅读栏目；细分类仍用于后台判断和既有订阅。 */
export const READER_CATEGORIES = [
  { key: "jobs", label: "裁员与招聘", members: ["jobs"] },
  { key: "workplace", label: "职场与组织", members: ["workplace", "career"] },
  { key: "industry", label: "经营与竞争", members: ["industry", "ai-products", "opinion", "paper", "ecommerce", "local-life", "ai-models", "tip"] },
  { key: "policy", label: "政策与监管", members: ["policy"] },
] as const;

/**
 * 公开接口（API、RSS、MCP）里和网页不同的类别（选填）。上线后不要改：接口参数和订阅地址里有类别的 key。
 * merge：并进另一类发布的类别，key 是行业包里的类别，值是它并进的类别（公开接口比网页少一类时用）；
 * feedLabels：分类 RSS 标题里的名字，替换行业包里的 feedLabel（并进了别的类别时，名字常常也要跟着改）。
 */
export const PUBLIC_CATEGORIES = {
  merge: {},
  feedLabels: {},
} as const;

/** “AI 日报”这类说法：行业词和名词之间，英文词加空格，中文词不加。 */
export function withSubject(noun: string): string {
  return /[A-Za-z0-9]$/.test(SITE.subject) ? `${SITE.subject} ${noun}` : `${SITE.subject}${noun}`;
}

/** “按主题看 AI”“往期 AI 日报”这类说法：行业词接在中文后面，英文词前加空格，中文词不加；noun 照 withSubject 接上。 */
export function subjectAfter(text: string, noun?: string): string {
  const gap = /^[A-Za-z0-9]/.test(SITE.subject) ? " " : "";
  return `${text}${gap}${noun ? withSubject(noun) : SITE.subject}`;
}

/** “8 点”“10 点 30 分”：口语里的 HH:mm。 */
function spokenTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return `${hour} 点${minute ? ` ${minute} 分` : ""}`;
}

/** 首页还没有精选时，给读者一个清晰的内容导览。 */
/** Public feed masthead, kept with the site's other copy. */
export const FEED_EDITORIAL = {
  imprint: "DACHANG OBSERVER", kicker: "互联网 · 公司 · 人",
  featuredTitle: "看见大厂的下一步。", allTitle: "行业变化，持续发生。",
  featuredLead: "面向互联网中大厂职场人的资讯聚合站，关注企业发展与员工处境。阅读无需登录，登录可同步收藏与已读。",
  allLead: "从业务竞争到组织变动，沿着时间读懂事情的来龙去脉。",
};

export const FEED_WELCOME = {
  kicker: "互联网中大厂职场人的每日信息站",
  title: "看懂行业变化，跟踪企业发展。",
  lead: "关注公司战略、财报、业务布局和竞争动作。重点追踪阿里、电商与本地生活，覆盖腾讯、字节、美团、京东、拼多多等互联网企业。",
  status: "精选内容尚未发布",
  statusDetail: "第一批资讯需要完成采集与筛选后才会出现。下面是本站的关注方向。",
  directions: [
    { category: "jobs", title: "裁员与招聘", description: "岗位增减、编制变化与招聘机会" },
    { category: "workplace", title: "薪酬与职场", description: "薪酬绩效、工作制度与员工权益" },
    { category: "career", title: "人事与组织", description: "高管任免、部门拆并与汇报关系" },
    { category: "industry", title: "经营与资本", description: "整体财报、融资并购与集团战略" },
    { category: "ai-products", title: "业务与竞争", description: "产品、用户增长、商业化与市场竞争" },
    { category: "policy", title: "政策与监管", description: "行业法规、正式监管与劳动政策" },
  ],
};
