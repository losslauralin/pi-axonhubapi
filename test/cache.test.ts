import assert from "node:assert/strict";
import test from "node:test";
import {
  axonHubCacheFile,
  type CacheDependencies,
  fetchModels,
  loadModels,
  normalizeBaseUrl,
} from "../src/cache.ts";

type MemoryFileSystem = Map<string, string>;

function response(status: number, payload: unknown, statusText = "") {
  return new Response(JSON.stringify(payload), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

function memoryDependencies(
  files: MemoryFileSystem,
  fetchImpl: typeof fetch,
  warnings: string[],
  now = 10_000,
): Partial<CacheDependencies> {
  return {
    now: () => now,
    fetch: fetchImpl,
    readFile: async (file) => {
      const value = files.get(file);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    writeFile: async (file, data) => {
      files.set(file, data);
    },
    mkdir: async () => undefined,
    rename: async (oldPath, newPath) => {
      const value = files.get(oldPath);
      if (value === undefined) throw new Error("ENOENT");
      files.set(newPath, value);
      files.delete(oldPath);
    },
    unlink: async (file) => {
      files.delete(file);
    },
    logger: { warn: (message) => warnings.push(String(message)) },
  };
}

test("cache files are isolated by normalized base URL", () => {
  assert.equal(normalizeBaseUrl("https://example.test/v1/"), "https://example.test");
  assert.equal(axonHubCacheFile("https://a.example/v1"), axonHubCacheFile("https://a.example/"));
  assert.notEqual(axonHubCacheFile("https://a.example"), axonHubCacheFile("https://b.example"));
});

test("one successful endpoint is enough", async () => {
  const warnings: string[] = [];
  const payload = await fetchModels(
    "https://axon.example",
    "secret",
    memoryDependencies(
      new Map(),
      async (input) => {
        const url = String(input);
        if (url.includes("include=all")) {
          return response(200, { data: [{ id: "sol", context_length: 700000 }] });
        }
        return response(500, { error: "failed" }, "Server Error");
      },
      warnings,
    ),
  );

  assert.deepEqual(payload, { data: [{ id: "sol", context_length: 700000 }] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /basic model endpoint failed/);
});

test("basic endpoint can succeed when the detailed endpoint fails", async () => {
  const warnings: string[] = [];
  const payload = await fetchModels(
    "https://axon.example",
    "secret",
    memoryDependencies(
      new Map(),
      async (input) => {
        const url = String(input);
        if (url.includes("include=all")) return response(500, { error: "failed" }, "Server Error");
        return response(200, { data: [{ id: "sol" }] });
      },
      warnings,
    ),
  );

  assert.deepEqual(payload, { data: [{ id: "sol" }] });
  assert.ok(warnings.some((message) => message.includes("detailed model endpoint failed")));
});

test("detailed endpoint fields override basic endpoint fields", async () => {
  const payload = await fetchModels(
    "https://axon.example",
    "secret",
    memoryDependencies(
      new Map(),
      async (input) =>
        String(input).includes("include=all")
          ? response(200, { data: [{ id: "sol", context_length: 700000 }] })
          : response(200, { data: [{ id: "sol", context_length: 200000, name: "Sol" }] }),
      [],
    ),
  );

  assert.deepEqual(payload, { data: [{ id: "sol", name: "Sol", context_length: 700000 }] });
});

test("401, 500, and network failures use stale cache without overwriting it", async () => {
  for (const fetchImpl of [
    async () => response(401, { error: "unauthorized" }, "Unauthorized"),
    async () => response(500, { error: "failed" }, "Server Error"),
    async () => {
      throw new Error("network down");
    },
  ] as const) {
    const baseUrl = "https://axon.example";
    const cacheFile = axonHubCacheFile(baseUrl);
    const staleCache = JSON.stringify({
      schemaVersion: 1,
      baseUrl,
      fetchedAt: 1,
      raw: { data: [{ id: "stale-model", context_length: 123 }] },
    });
    const files = new Map([[cacheFile, staleCache]]);
    const warnings: string[] = [];
    const deps = memoryDependencies(files, fetchImpl, warnings);

    const payload = await loadModels(baseUrl, "secret", 100, deps);

    assert.deepEqual(payload, { data: [{ id: "stale-model", context_length: 123 }] });
    assert.equal(files.get(cacheFile), staleCache);
    assert.ok(warnings.some((message) => message.includes("using stale raw cache")));
  }
});

test("a cache for one base URL is never reused for another", async () => {
  const firstBaseUrl = "https://a.example";
  const secondBaseUrl = "https://b.example";
  const files = new Map([
    [
      axonHubCacheFile(firstBaseUrl),
      JSON.stringify({
        schemaVersion: 1,
        baseUrl: firstBaseUrl,
        fetchedAt: 9_950,
        raw: { data: [{ id: "model-a" }] },
      }),
    ],
  ]);
  const payload = await loadModels(
    secondBaseUrl,
    "secret",
    100,
    memoryDependencies(files, async () => response(200, { data: [{ id: "model-b" }] }), []),
  );

  assert.deepEqual(payload, { data: [{ id: "model-b" }] });
  assert.ok(files.has(axonHubCacheFile(firstBaseUrl)));
  assert.ok(files.has(axonHubCacheFile(secondBaseUrl)));
});

test("failed or empty refresh without cache throws and writes nothing", async () => {
  for (const fetchImpl of [
    async () => response(500, { error: "failed" }, "Server Error"),
    async () => response(200, { data: [] }),
  ] as const) {
    const files = new Map<string, string>();
    const warnings: string[] = [];
    await assert.rejects(
      loadModels("https://empty.example", "secret", 100, memoryDependencies(files, fetchImpl, warnings)),
      /refresh failed|no usable models/,
    );
    assert.equal(files.size, 0);
  }
});

test("fresh cache avoids network access", async () => {
  const baseUrl = "https://fresh.example";
  const cacheFile = axonHubCacheFile(baseUrl);
  const files = new Map([
    [
      cacheFile,
      JSON.stringify({
        schemaVersion: 1,
        baseUrl,
        fetchedAt: 9_950,
        raw: { data: [{ id: "fresh-model" }] },
      }),
    ],
  ]);
  let fetchCount = 0;
  const payload = await loadModels(
    baseUrl,
    "secret",
    100,
    memoryDependencies(
      files,
      async () => {
        fetchCount += 1;
        return response(500, {});
      },
      [],
    ),
  );

  assert.deepEqual(payload, { data: [{ id: "fresh-model" }] });
  assert.equal(fetchCount, 0);
});