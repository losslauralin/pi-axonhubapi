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