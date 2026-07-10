import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  type AxonHubModel,
  type AxonHubModelsResponse,
  type ModelsDevResponse,
} from "./model-metadata.ts";

export const DEFAULT_BASE_URL = "http://localhost:8090";
const CACHE_SCHEMA_VERSION = 1;
const CACHE_DIR = join(homedir(), ".cache", "pi");
const LEGACY_AXONHUB_CACHE_FILE = join(CACHE_DIR, "axonhub-models.json");
const MODELS_DEV_CACHE_FILE = join(CACHE_DIR, "models-dev-api.json");
const MODELS_DEV_URL = "https://models.dev/api.json";

type CacheEnvelope<T> = {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  baseUrl: string;
  fetchedAt: number;
  raw: T;
};

type CacheRecord<T> = {
  envelope: CacheEnvelope<T>;
  file: string;
  legacy: boolean;
};

type Logger = Pick<Console, "warn">;

export type CacheDependencies = {
  now: () => number;
  fetch: typeof globalThis.fetch;
  readFile: (file: string, encoding: "utf8") => Promise<string>;
  writeFile: (file: string, data: string) => Promise<unknown>;
  mkdir: (directory: string, options: { recursive: true }) => Promise<unknown>;
  rename: (oldPath: string, newPath: string) => Promise<unknown>;
  unlink: (file: string) => Promise<unknown>;
  logger: Logger;
};

const defaultDependencies: CacheDependencies = {
  now: Date.now,
  fetch: globalThis.fetch,
  readFile: (file, encoding) => readFile(file, encoding),
  writeFile: (file, data) => writeFile(file, data),
  mkdir: (directory, options) => mkdir(directory, options),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  unlink: (file) => unlink(file),
  logger: console,
};

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

export function axonHubCacheFile(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  const sourceHash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return join(CACHE_DIR, `axonhub-models-raw-v${CACHE_SCHEMA_VERSION}-${sourceHash}.json`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function warn(deps: CacheDependencies, message: string) {
  deps.logger.warn(`[pi-axonhub] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAxonHubPayload(value: unknown): value is AxonHubModelsResponse {
  return isRecord(value) && Array.isArray(value.data);
}

function hasAxonHubModels(value: AxonHubModelsResponse) {
  return (value.data ?? []).some((model) => typeof model.id === "string" && model.id.length > 0);
}

function isUsableAxonHubPayload(value: unknown): value is AxonHubModelsResponse {
  return isAxonHubPayload(value) && hasAxonHubModels(value);
}

function isModelsDevPayload(value: unknown): value is ModelsDevResponse {
  if (!isRecord(value)) return false;
  return Object.values(value).some((provider) => {
    if (!isRecord(provider) || !isRecord(provider.models)) return false;
    return Object.keys(provider.models).length > 0;
  });
}

function isEnvelope<T>(
  value: unknown,
  source: string,
  validate: (raw: unknown) => raw is T,
): value is CacheEnvelope<T> {
  return (
    isRecord(value) &&
    value.schemaVersion === CACHE_SCHEMA_VERSION &&
    value.baseUrl === source &&
    typeof value.fetchedAt === "number" &&
    Number.isFinite(value.fetchedAt) &&
    validate(value.raw)
  );
}

async function readJson(file: string, deps: CacheDependencies): Promise<unknown> {
  try {
    return JSON.parse(await deps.readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function readEnvelope<T>(
  file: string,
  source: string,
  validate: (raw: unknown) => raw is T,
  deps: CacheDependencies,
): Promise<CacheRecord<T> | undefined> {
  const parsed = await readJson(file, deps);
  if (parsed === undefined) return undefined;
  if (!isEnvelope(parsed, source, validate)) {
    warn(deps, `Ignoring invalid cache ${basename(file)}.`);
    return undefined;
  }
  return { envelope: parsed, file, legacy: false };
}

async function readLegacyAxonHubCache(
  baseUrl: string,
  deps: CacheDependencies,
): Promise<CacheRecord<AxonHubModelsResponse> | undefined> {
  if (baseUrl !== DEFAULT_BASE_URL) return undefined;

  const parsed = await readJson(LEGACY_AXONHUB_CACHE_FILE, deps);
  if (parsed === undefined) return undefined;
  if (!isAxonHubPayload(parsed) || !hasAxonHubModels(parsed)) {
    warn(deps, `Ignoring invalid legacy cache ${basename(LEGACY_AXONHUB_CACHE_FILE)}.`);
    return undefined;
  }

  return {
    envelope: {
      schemaVersion: CACHE_SCHEMA_VERSION,
      baseUrl,
      fetchedAt: 0,
      raw: parsed,
    },
    file: LEGACY_AXONHUB_CACHE_FILE,
    legacy: true,
  };
}

async function writeEnvelope<T>(file: string, envelope: CacheEnvelope<T>, deps: CacheDependencies) {
  await deps.mkdir(dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await deps.writeFile(tempFile, JSON.stringify(envelope, null, 2));
    await deps.rename(tempFile, file);
  } catch (error) {
    await deps.unlink(tempFile).catch(() => undefined);
    throw error;
  }
}

function isFresh<T>(cache: CacheRecord<T>, ttl: number, now: number) {
  if (cache.legacy) return false;
  if (ttl <= 0) return false;
  const age = now - cache.envelope.fetchedAt;
  return age >= 0 && age <= ttl;
}

async function fetchAxonHubEndpoint(
  baseUrl: string,
  key: string,
  endpoint: "basic" | "detailed",
  deps: CacheDependencies,
): Promise<AxonHubModelsResponse> {
  const suffix = endpoint === "basic" ? "/v1/models" : "/v1/models?include=all";
  const response = await deps.fetch(`${baseUrl}${suffix}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    throw new Error(`${endpoint} endpoint returned ${response.status} ${response.statusText}`.trim());
  }

  const payload = (await response.json()) as unknown;
  if (!isAxonHubPayload(payload)) {
    throw new Error(`${endpoint} endpoint returned an invalid models payload`);
  }
  return payload;
}

function mergeAxonHubPayloads(payloads: AxonHubModelsResponse[]): AxonHubModelsResponse {
  const byId = new Map<string, AxonHubModel>();
  for (const payload of payloads) {
    for (const model of payload.data ?? []) {
      if (!model.id) continue;
      byId.set(model.id, { ...byId.get(model.id), ...model });
    }
  }
  return { data: [...byId.values()] };
}

export async function fetchModels(
  baseUrl: string,
  key: string,
  overrides: Partial<CacheDependencies> = {},
): Promise<AxonHubModelsResponse> {
  const deps = { ...defaultDependencies, ...overrides };
  const endpoints = ["basic", "detailed"] as const;
  const results = await Promise.allSettled(
    endpoints.map((endpoint) => fetchAxonHubEndpoint(baseUrl, key, endpoint, deps)),
  );
  const payloads: AxonHubModelsResponse[] = [];
  const errors: string[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      payloads.push(result.value);
    } else {
      const endpoint = endpoints[index];
      const message = errorMessage(result.reason);
      errors.push(`${endpoint}: ${message}`);
      warn(deps, `AxonHub ${endpoint} model endpoint failed: ${message}.`);
    }
  });

  if (payloads.length === 0) {
    throw new Error(`AxonHub model refresh failed (${errors.join("; ")})`);
  }

  const payload = mergeAxonHubPayloads(payloads);
  if (!hasAxonHubModels(payload)) {
    throw new Error("AxonHub model refresh returned no usable models");
  }
  return payload;
}

export async function loadModels(
  baseUrl: string,
  key: string,
  ttl: number,
  overrides: Partial<CacheDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const cacheFile = axonHubCacheFile(normalizedBaseUrl);
  const isolatedCache = await readEnvelope(cacheFile, normalizedBaseUrl, isUsableAxonHubPayload, deps);
  const cached = isolatedCache ?? (await readLegacyAxonHubCache(normalizedBaseUrl, deps));
  if (cached && hasAxonHubModels(cached.envelope.raw) && isFresh(cached, ttl, deps.now())) {
    return cached.envelope.raw;
  }

  try {
    const payload = await fetchModels(normalizedBaseUrl, key, deps);
    const envelope: CacheEnvelope<AxonHubModelsResponse> = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      baseUrl: normalizedBaseUrl,
      fetchedAt: deps.now(),
      raw: payload,
    };
    try {
      await writeEnvelope(cacheFile, envelope, deps);
    } catch (error) {
      warn(deps, `Could not write AxonHub raw model cache: ${errorMessage(error)}.`);
    }
    return payload;
  } catch (error) {
    if (cached && hasAxonHubModels(cached.envelope.raw)) {
      warn(deps, `AxonHub model refresh failed; using stale raw cache: ${errorMessage(error)}.`);
      return cached.envelope.raw;
    }
    throw error;
  }
}

async function fetchModelsDev(deps: CacheDependencies) {
  const response = await deps.fetch(MODELS_DEV_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${MODELS_DEV_URL}: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as unknown;
  if (!isModelsDevPayload(payload)) throw new Error(`${MODELS_DEV_URL} returned an invalid payload`);
  return payload;
}

async function readModelsDevCache(deps: CacheDependencies): Promise<CacheRecord<ModelsDevResponse> | undefined> {
  const parsed = await readJson(MODELS_DEV_CACHE_FILE, deps);
  if (parsed === undefined) return undefined;
  if (isEnvelope(parsed, MODELS_DEV_URL, isModelsDevPayload)) {
    return { envelope: parsed, file: MODELS_DEV_CACHE_FILE, legacy: false };
  }
  if (isModelsDevPayload(parsed)) {
    return {
      envelope: {
        schemaVersion: CACHE_SCHEMA_VERSION,
        baseUrl: MODELS_DEV_URL,
        fetchedAt: 0,
        raw: parsed,
      },
      file: MODELS_DEV_CACHE_FILE,
      legacy: true,
    };
  }
  warn(deps, `Ignoring invalid cache ${basename(MODELS_DEV_CACHE_FILE)}.`);
  return undefined;
}

export async function loadModelsDev(ttl: number, overrides: Partial<CacheDependencies> = {}) {
  const deps = { ...defaultDependencies, ...overrides };
  const cached = await readModelsDevCache(deps);
  if (cached && isFresh(cached, ttl, deps.now())) return cached.envelope.raw;

  try {
    const payload = await fetchModelsDev(deps);
    const envelope: CacheEnvelope<ModelsDevResponse> = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      baseUrl: MODELS_DEV_URL,
      fetchedAt: deps.now(),
      raw: payload,
    };
    try {
      await writeEnvelope(MODELS_DEV_CACHE_FILE, envelope, deps);
    } catch (error) {
      warn(deps, `Could not write models.dev raw cache: ${errorMessage(error)}.`);
    }
    return payload;
  } catch (error) {
    if (cached) {
      warn(deps, `models.dev refresh failed; using stale raw cache: ${errorMessage(error)}.`);
      return cached.envelope.raw;
    }
    warn(deps, `models.dev refresh failed without a usable cache: ${errorMessage(error)}.`);
    return {};
  }
}