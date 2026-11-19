// 这个站用哪些模型。框架自带一个 `default`：环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 指定的模型。
// 这里再列出具名的模型（每个用自己的地址和密钥环境变量），以及每一步默认用哪个；没写的步骤用 default。
// 部署时还可以用环境变量（PREFILTER_MODEL、SCORE_MODEL……）或后台的“模型与评测”页逐步改选。

export interface ModelPreset {
  service: string;
  model: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  /** 额外的请求字段，比如短小的结构化任务关掉推理。 */
  extra?: Record<string, unknown>;
  /** 推理模型先想再答，额外给推理留的输出额度（token），加在每一步自己的额度上。default 用环境变量 LLM_REASONING_TOKENS。 */
  reasoningTokens?: number;
  /** 接口支持 JSON 模式。 */
  jsonMode: boolean;
  /** 能看图。 */
  vision?: boolean;
  /** 不可用时尝试链中的下一通道；每层请求仍经过回执和预算，不允许循环。 */
  fallback?: string;
}

/** 具名的模型示例（每个要配自己的密钥）。用不上可以删掉。 */
export const PRESETS: Record<string, ModelPreset> = {
  "intern-flash": {
    service: "intern", model: "deepseek-v4.1-flash-1017", baseUrlEnv: "INTERN_BASE_URL", apiKeyEnv: "INTERN_API_KEY",
    extra: { thinking: { type: "disabled" } }, jsonMode: true, fallback: "aihubmix-flash",
  },
  "intern-flash-think": {
    service: "intern", model: "deepseek-v4.1-flash-1017", baseUrlEnv: "INTERN_BASE_URL", apiKeyEnv: "INTERN_API_KEY", reasoningTokens: 12000,
    extra: { thinking: { type: "enabled" }, reasoning_effort: "low" }, jsonMode: true, fallback: "aihubmix-flash-think",
  },
  "aihubmix-flash": {
    service: "aihubmix", model: "deepseek-v4.1-flash-1017", baseUrlEnv: "AIHUBMIX_BASE_URL", apiKeyEnv: "AIHUBMIX_API_KEY",
    extra: { thinking: { type: "disabled" }, reasoning_effort: "none" }, jsonMode: true, fallback: "deepseek-flash",
  },
  "aihubmix-flash-think": {
    service: "aihubmix", model: "deepseek-v4.1-flash-1017", baseUrlEnv: "AIHUBMIX_BASE_URL", apiKeyEnv: "AIHUBMIX_API_KEY", reasoningTokens: 12000,
    extra: { thinking: { type: "enabled" }, reasoning_effort: "low" }, jsonMode: true, fallback: "deepseek-flash-think",
  },
  // GLM 5.3 Flash always reasons; the lowest effort keeps short structured tasks fast.
  "glm-5.3-flash": {
    service: "zhipu", model: "glm-5.3-flash", baseUrlEnv: "ZHIPU_BASE_URL", apiKeyEnv: "ZHIPU_API_KEY",
    extra: { thinking: { type: "enabled" }, reasoning_effort: "low" }, jsonMode: true, vision: true,
  },
  // The scorer's parameters for glm-5.3-flash (score calls; temperature 1 is set per call).
  "glm-5.3-flash-selection": {
    service: "zhipu", model: "glm-5.3-flash", baseUrlEnv: "ZHIPU_BASE_URL", apiKeyEnv: "ZHIPU_API_KEY",
    extra: { thinking: { type: "enabled", clear_thinking: false }, reasoning_effort: "high", top_p: 0.95 }, jsonMode: true, vision: true,
  },
  // DeepSeek Flash reasons by default; structured tasks switch it off. deepseek-flash-think keeps it on,
  // with room in the output for the reasoning.
  "deepseek-flash": {
    service: "deepseek", model: "deepseek-flash", baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY",
    extra: { thinking: { type: "disabled" } }, jsonMode: true,
  },
  "deepseek-flash-think": {
    service: "deepseek", model: "deepseek-flash", baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY", reasoningTokens: 12000,
    extra: { thinking: { type: "enabled" }, reasoning_effort: "low" }, jsonMode: true,
  },
  "qwen3.7-flash": {
    service: "dashscope", model: "qwen3.7-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: true,
  },
  "qwen3.8-flash": {
    service: "dashscope", model: "qwen3.8-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: true,
  },
  "mimo-v2.6-flash": {
    service: "mimo", model: "mimo-v2.6-flash", baseUrlEnv: "XIAOMI_MIMO_BASE_URL", apiKeyEnv: "XIAOMI_MIMO_API_KEY",
    extra: { thinking: { type: "disabled" } }, jsonMode: true,
  },
  "qwen3-vl-flash": {
    service: "dashscope", model: "qwen3-vl-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: false, vision: true,
  },
};

/**
 * 每一步默认用的模型（步骤见后台“模型与评测”页），值是上面的名字或 default。没写的步骤用 default。
 * 例：{ score: "glm-5.3-flash-selection", groupReview: "mimo-v2.6-flash" }
 */
export const DEFAULTS: Record<string, string> = { score: "deepseek-flash-think" };

// 同一 service 的普通、推理、重试及维护请求共用节奏；书生为平台 50 RPM 留余量，AIHubMix 采用本站保守节奏。
export const MODEL_REQUESTS_PER_MINUTE: Readonly<Record<string, number>> = { intern: 45, aihubmix: 30 };
// Shared with maintenance processes through receipt reservations; local waiting never buys a fallback.
export const MODEL_MAX_CONCURRENT: Readonly<Record<string, number>> = { intern: 3, aihubmix: 3 };

// 2026-10-21 核验：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 当前 deepseek-flash 对应官方 V4.1-Flash-1017；官方未公布单独可调用的日期版名称。
// 按高峰单价计算上界，不依赖空闲时段折扣；金额限制通过环境变量启用。
export const MODEL_COST_POLICY = {
  origin: "https://api.deepseek.com",
  model: "deepseek-flash",
  inputPerMillion: 2,
  cachedInputPerMillion: 0.04,
  outputPerMillion: 8,
  maxOutputTokens: 4096,
} as const;

// Verified 2026-10-30: list peak USD prices, without temporary promotion or cache discounts.
// https://aihubmix.com/blog/aihubmix-desktop-1-0-one-click-setup-for-11-agents-and-half-price-deepseek-v4-1-flash-1017-for-two-weeks
export const AIHUBMIX_COST_POLICY = {
  inputPerMillion: 0.3098,
  cachedInputPerMillion: 0.3098,
  outputPerMillion: 1.2392,
} as const;
