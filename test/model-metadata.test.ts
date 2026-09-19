import assert from "node:assert/strict";
import test from "node:test";
import {
  buildThinkingLevelMap,
  modelsDevIndex,
  modelsDevMatch,
  type AxonHubModelsResponse,
  type ModelsDevResponse,
  toProviderModel,
} from "../src/model-metadata.ts";

test("buildThinkingLevelMap keeps xhigh and max independent", () => {
  assert.deepEqual(buildThinkingLevelMap(["none", "low", "medium", "high", "xhigh", "max"]), {
    off: "none",
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  });
});

test("xhigh and max selections preserve their distinct provider values", () => {
  const map = buildThinkingLevelMap(["none", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(map?.xhigh, "xhigh");
  assert.equal(map?.max, "max");
});

test("buildThinkingLevelMap represents holes instead of aliasing extended levels", () => {
  assert.deepEqual(buildThinkingLevelMap(["none", "low", "medium", "high", "max"]), {
    off: "none",
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    max: "max",
  });
  assert.deepEqual(buildThinkingLevelMap(["high", "xhigh"]), {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: "xhigh",
  });
  assert.deepEqual(buildThinkingLevelMap(["high"]), {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: "high",
  });
  assert.deepEqual(buildThinkingLevelMap(["none", "default"]), {
    off: "none",
    minimal: null,
    low: null,
    medium: null,
    high: "default",
  });
  assert.equal(buildThinkingLevelMap(undefined), undefined);
});

test("a reasoning toggle exposes off even when effort values omit none", () => {
  assert.deepEqual(buildThinkingLevelMap(["low", "high", "max"], true), {
    off: "none",
    minimal: "low",
    low: "low",
    medium: null,
    high: "high",
    max: "max",
  });
});

test("a reasoning toggle does not invent a map for effort-less metadata", () => {
  assert.equal(buildThinkingLevelMap(undefined, true), undefined);
});

test("deepseek-flash toggle plus effort keeps off available", () => {
  const axonHubRaw: AxonHubModelsResponse = {
    data: [
      {
        id: "deepseek-flash",
        name: "DeepSeek V4.1 Flash",
        owned_by: "deepseek",
        context_length: 1000000,
        max_output_tokens: 384000,
        capabilities: { vision: true, reasoning: true },
      },
    ],
  };
  const modelsDevRaw: ModelsDevResponse = {
    deepseek: {
      models: {
        "deepseek-flash": {
          id: "deepseek-flash",
          name: "DeepSeek V4.1 Flash",
          reasoning: true,
          reasoning_options: [
            { type: "toggle" },
            { type: "effort", values: ["low", "high", "max"] },
          ],
        },
      },
    },
  };
  const rawFlash = axonHubRaw.data?.[0];
  assert.ok(rawFlash);

  const model = toProviderModel(
    "http://localhost:8090",
    rawFlash,
    modelsDevMatch(rawFlash, modelsDevIndex(modelsDevRaw)),
  );

  assert.ok(model);
  assert.deepEqual(model.thinkingLevelMap, {
    off: "none",
    minimal: "low",
    low: "low",
    medium: null,
    high: "high",
    max: "max",
  });
});

test("raw Sol metadata becomes a complete Pi provider model", () => {
  const axonHubRaw: AxonHubModelsResponse = {
    data: [
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        owned_by: "codex",
        context_length: 700000,
        max_output_tokens: 347000,
        capabilities: { vision: true, reasoning: true },
        pricing: { input: 5, output: 30, cache_read: 0.5, cache_write: 6.25 },
      },
    ],
  };
  const modelsDevRaw: ModelsDevResponse = {
    openai: {
      models: {
        "gpt-5.6-sol": {
          id: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          reasoning: true,
          attachment: true,
          reasoning_options: [
            { type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] },
          ],
        },
      },
    },
  };
  const rawSol = axonHubRaw.data?.[0];
  assert.ok(rawSol);

  const match = modelsDevMatch(rawSol, modelsDevIndex(modelsDevRaw));
  const model = toProviderModel("http://localhost:8090", rawSol, match);

  assert.ok(model);
  assert.equal(model.contextWindow, 700000);
  assert.equal(model.maxTokens, 347000);
  assert.equal(model.reasoning, true);
  assert.deepEqual(model.cost, {
    input: 5,
    output: 30,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  });
  assert.deepEqual(model.thinkingLevelMap, {
    off: "none",
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  });
});