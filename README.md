# @pandada8/pi-axonhub

Pi extension that discovers AxonHub models from `/v1/models` and `/v1/models?include=all`, enriches them with cached metadata from `https://models.dev/api.json`, and registers them as the `axonhub` provider.

AxonHub raw API responses are cached for one day in base-URL-specific files named `~/.cache/pi/axonhub-models-raw-v1-<hash>.json`. Each file contains a versioned envelope with `schemaVersion`, normalized `baseUrl`, `fetchedAt`, and the raw AxonHub payload. The legacy `~/.cache/pi/axonhub-models.json` file is only used as a stale fallback for the default local AxonHub URL.

`models.dev` metadata is cached at `~/.cache/pi/models-dev-api.json` for one day using the same versioned raw-data envelope. Both caches fall back to stale valid data when refreshes fail, and failed or empty AxonHub refreshes never overwrite a usable model list. If no API key is configured, the extension does not register the provider.

The AxonHub cache uses raw API field names such as `context_length`, `max_output_tokens`, `capabilities.reasoning`, and `pricing.cache_read`. Pi runtime fields such as `contextWindow`, `maxTokens`, `reasoning`, `cost.cacheRead`, and `thinkingLevelMap` are created in memory when the provider is registered; they are not expected to appear in the raw cache.

Model metadata is matched to `models.dev` entries by direct ID lookup. If that fails, the extension retries with `{owned_by}/{id}` (e.g. `anthropic/claude-sonnet-4-6`) to handle providers that prefix model IDs.

Reasoning levels are exposed from `models.dev` effort metadata. `xhigh` and `max` remain independent opt-in levels, so a model can support either one or both without request-time rewriting.

## Usage

Install from GitHub:

```sh
pi install git:github.com/losslauralin/pi-axonhubapi
```

Or use locally for development:

```sh
pi -e /path/to/pi-axonhub
```

This writes the package to `~/.pi/agent/settings.json`. You can also edit it manually:

```json
{
  "packages": ["git:github.com/losslauralin/pi-axonhubapi"]
}
```

Configure AxonHub and run Pi:

```sh
export AXONHUB_BASE_URL=http://localhost:8090
export AXONHUB_API_KEY=ah-your-api-key
pi
```

You can also store the key in `~/.pi/agent/auth.json`:

```json
{
  "axonhub": {
    "type": "api_key",
    "key": "ah-your-api-key"
  }
}
```

When using `auth.json`, `AXONHUB_API_KEY` is not required. `AXONHUB_BASE_URL` is optional and defaults to `http://localhost:8090`.

For local development, point Pi directly at this checkout:

```sh
pi -e /path/to/pi-axonhub
```

OpenAI-compatible models are sent to AxonHub `/v1`. Anthropic-owned models are sent to AxonHub `/anthropic`. Gemini-owned models are sent to AxonHub `/gemini`.

## GPT Web Search

All `gpt-*` models automatically get a `web_search` tool injected into every request. This enables built-in web search without any configuration.
