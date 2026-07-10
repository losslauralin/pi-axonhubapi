import { type Api } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_BASE_URL, loadModels, loadModelsDev, normalizeBaseUrl } from "./cache.ts";
import { modelsDevIndex, modelsDevMatch, toProviderModel } from "./model-metadata.ts";

const PROVIDER_ID = "axonhub";
const CACHE_TTL = 24 * 60 * 60 * 1000;

type PluginOptions = {
  baseUrl?: string;
  apiKey?: string;
  cacheTtl?: number;
};

function resolveOption(value: string | undefined) {
  if (!value) return;
  return process.env[value] || value;
}

function resolveBaseUrl(options?: PluginOptions) {
  return normalizeBaseUrl(options?.baseUrl ?? process.env.AXONHUB_BASE_URL ?? DEFAULT_BASE_URL);
}

function resolveApiKey(options?: PluginOptions) {
  return resolveOption(options?.apiKey) ?? process.env.AXONHUB_API_KEY;
}

async function readPiAuthApiKey() {
  try {
    const payload = JSON.parse(await readFile(join(getAgentDir(), "auth.json"), "utf8")) as Record<
      string,
      { type?: string; key?: string }
    >;
    const auth = payload[PROVIDER_ID];
    if (auth?.type === "api_key" && typeof auth.key === "string" && auth.key.length > 0) return auth.key;
  } catch {
    return;
  }
}

export default async function (pi: ExtensionAPI, options?: PluginOptions) {
  const baseUrl = resolveBaseUrl(options);
  const key = resolveApiKey(options) ?? (await readPiAuthApiKey());
  if (!key) return;

  const ttl = options?.cacheTtl ?? CACHE_TTL;

  const [payload, modelsDev] = await Promise.all([loadModels(baseUrl, key, ttl), loadModelsDev(ttl)]);
  const modelIndex = modelsDevIndex(modelsDev);
  const models = (payload.data ?? [])
    .map((item) => toProviderModel(baseUrl, item, modelsDevMatch(item, modelIndex)))
    .filter((model): model is ProviderModelConfig => model !== undefined);

  pi.registerProvider(PROVIDER_ID, {
    baseUrl,
    apiKey: options?.apiKey ?? "$AXONHUB_API_KEY",
    models,
  });

  // Inject web_search tool for gpt-* models from axonhub
  // @ts-expect-error - ExtensionAPI.on exists at runtime via jiti, but ts can't resolve due to symlink
  pi.on("before_provider_request", (event: { payload: unknown }, ctx: { model?: { provider: string; id: string } }) => {
    const model = ctx.model;
    if (model?.provider !== PROVIDER_ID) return;

    // Handle GPT models: inject web_search tool
    if (model.id.startsWith("gpt-")) {
      const payload = event.payload as {
        tools?: Array<{ type: string; name?: string; [key: string]: unknown }>;
        [key: string]: unknown;
      };

      // Add web_search built-in tool
      const webSearchTool = { type: "web_search" as const };
      const existingTools = payload.tools ?? [];
      const hasWebSearch = existingTools.some((t) => t.type === "web_search");
      if (!hasWebSearch) {
        payload.tools = [...existingTools, webSearchTool];
      }
    }

    return event.payload;
  });
}
