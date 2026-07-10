import type { Api } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export type AxonHubModel = {
  id?: string;
  name?: string;
  display_name?: string;
  created?: number;
  created_at?: string;
  owned_by?: string;
  context_length?: number;
  max_output_tokens?: number;
  capabilities?: {
    vision?: boolean;
    tool_call?: boolean;
    toolCall?: boolean;
    reasoning?: boolean;
  };
  pricing?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cacheRead?: number;
    cache_write?: number;
    cacheWrite?: number;
  };
};

export type AxonHubModelsResponse = {
  data?: AxonHubModel[];
};

type ModelsDevReasoningOption = {
  type?: string;
  values?: Array<string | null>;
  min?: number;
};

export type ModelsDevModel = {
  id?: string;
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: ModelsDevReasoningOption[];
  tool_call?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
};

type ModelsDevProvider = {
  id?: string;
  models?: Record<string, ModelsDevModel>;
};

export type ModelsDevResponse = Record<string, ModelsDevProvider>;

export type ModelsDevMatch = {
  providerId: string;
  model: ModelsDevModel;
};

type AxonHubModelConfig = ProviderModelConfig;
type ThinkingLevelMap = NonNullable<ProviderModelConfig["thinkingLevelMap"]>;

export function modelsDevIndex(payload: ModelsDevResponse) {
  const index = new Map<string, ModelsDevMatch[]>();

  for (const [providerId, provider] of Object.entries(payload)) {
    for (const [key, model] of Object.entries(provider.models ?? {})) {
      const match = { providerId, model };
      for (const id of new Set([key, model.id].filter((value): value is string => typeof value === "string"))) {
        const matches = index.get(id);
        if (matches) matches.push(match);
        else index.set(id, [match]);
      }
    }
  }

  return index;
}

export function modelsDevMatch(item: AxonHubModel, index: Map<string, ModelsDevMatch[]>) {
  if (!item.id) return;

  let matches = index.get(item.id);
  if (!matches?.length && item.owned_by) {
    matches = index.get(`${item.owned_by}/${item.id}`);
  }
  if (!matches?.length) return;

  const owner = item.owned_by;
  return (
    (owner ? matches.find((match) => match.providerId === owner) : undefined) ??
    matches.find((match) => match.providerId === "openai") ??
    matches.find((match) => match.providerId === "anthropic") ??
    matches[0]
  );
}

function hasModality(model: ModelsDevModel | undefined, direction: "input" | "output", modality: string) {
  return model?.modalities?.[direction]?.includes(modality);
}

const OWNER_BY_PROVIDER_ID: Record<string, "anthropic" | "gemini" | "openai"> = {
  anthropic: "anthropic",
  gemini: "gemini",
  google: "gemini",
  openai: "openai",
};

function normalizeOwner(owner?: string) {
  return owner ? OWNER_BY_PROVIDER_ID[owner] : undefined;
}

function ownerFromMatch(item: AxonHubModel, match?: ModelsDevMatch) {
  return normalizeOwner(item.owned_by) ?? normalizeOwner(match?.providerId);
}

function modelApi(id: string, owner?: string): Api {
  if (id.includes("gpt")) return "openai-responses";
  if (owner === "anthropic") return "anthropic-messages";
  if (owner === "gemini") return "google-generative-ai";
  return "openai-completions";
}

function modelBaseUrl(baseUrl: string, owner?: string) {
  if (owner === "anthropic") return `${baseUrl}/anthropic`;
  if (owner === "gemini") return `${baseUrl}/gemini/v1beta`;
  return `${baseUrl}/v1`;
}

function getEffortValues(cached?: ModelsDevModel): Array<string | null> | undefined {
  const opt = cached?.reasoning_options?.find((option) => option.type === "effort");
  return opt?.values;
}

export function buildThinkingLevelMap(effortValues: Array<string | null> | undefined): ThinkingLevelMap | undefined {
  if (!effortValues || effortValues.length === 0) return undefined;

  const supported = new Set(effortValues.filter((value): value is string => typeof value === "string"));
  const map: ThinkingLevelMap = {
    off: supported.has("none") ? "none" : null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
  };

  if (supported.has("minimal")) {
    map.minimal = "minimal";
  } else if (supported.has("low")) {
    map.minimal = "low";
  }

  for (const level of ["low", "medium", "high"] as const) {
    if (supported.has(level)) map[level] = level;
  }

  if (supported.has("default") && map.high === null) map.high = "default";

  if (supported.has("xhigh")) map.xhigh = "xhigh";
  if (supported.has("max")) map.max = "max";

  return map;
}

function modelCompat(
  owner: string | undefined,
  effortValues: Array<string | null> | undefined,
): ProviderModelConfig["compat"] | undefined {
  const hasEffort = effortValues !== undefined && effortValues.length > 0;
  if (owner === "anthropic") {
    return hasEffort ? { forceAdaptiveThinking: true } : undefined;
  }
  if (owner === "gemini") return undefined;
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: hasEffort,
    maxTokensField: "max_tokens" as const,
    thinkingFormat: "openai" as const,
  };
}

export function toProviderModel(
  baseUrl: string,
  item: AxonHubModel,
  match?: ModelsDevMatch,
): AxonHubModelConfig | undefined {
  if (!item.id) return;

  const cached = match?.model;
  const owner = ownerFromMatch(item, match);
  const supportsVision = item.capabilities?.vision ?? cached?.attachment ?? hasModality(cached, "input", "image") ?? true;
  const effortValues = getEffortValues(cached);

  return {
    id: item.id,
    name: item.name ?? item.display_name ?? cached?.name ?? item.id,
    api: modelApi(item.id, owner),
    reasoning: item.capabilities?.reasoning ?? cached?.reasoning ?? true,
    input: supportsVision ? ["text", "image"] : ["text"],
    cost: {
      input: item.pricing?.input ?? cached?.cost?.input ?? 0,
      output: item.pricing?.output ?? cached?.cost?.output ?? 0,
      cacheRead: item.pricing?.cache_read ?? item.pricing?.cacheRead ?? cached?.cost?.cache_read ?? 0,
      cacheWrite: item.pricing?.cache_write ?? item.pricing?.cacheWrite ?? cached?.cost?.cache_write ?? 0,
    },
    contextWindow: item.context_length ?? cached?.limit?.context ?? 200000,
    maxTokens: item.max_output_tokens ?? cached?.limit?.output ?? 32000,
    thinkingLevelMap: buildThinkingLevelMap(effortValues),
    compat: modelCompat(owner, effortValues),
    baseUrl: modelBaseUrl(baseUrl, owner),
  };
}