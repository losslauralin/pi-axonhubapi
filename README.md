# @pandada8/pi-axonhub

Pi extension that discovers AxonHub models from `/v1/models` and `/v1/models?include=all`, enriches them with cached metadata from `https://models.dev/api.json`, and registers them as the `axonhub` provider.

AxonHub models are cached at `~/.cache/pi/axonhub-models.json` for one day. `models.dev` metadata is cached at `~/.cache/pi/models-dev-api.json` for one day. If no API key is configured, the extension does not register the provider.

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

## Max Effort Support

By default, the extension maps Pi's `xhigh` thinking level to Anthropic's `xhigh` effort for Claude Opus 4.7+/Fable 5, and to `max` for Opus 4.6 (which doesn't support `xhigh`).

To enable **max effort** for all supported Claude models (mapping `xhigh` -> `max`), use one of these methods:

### Method 1: Command (Dynamic Toggle)

Use the `/axonhub-max` command to toggle max effort on/off during a session:

```sh
/axonhub-max
```

This will show:
- `✨ AxonHub max effort enabled (xhigh -> max)` - when turning it on
- `✨ AxonHub max effort disabled (xhigh -> xhigh)` - when turning it off

After toggling, switch models (Ctrl+P) to apply the new mapping.

### Method 2: Configuration (Persistent)

Add the `useMaxEffort` option to your `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "package": "git:github.com/losslauralin/pi-axonhubapi",
      "options": {
        "useMaxEffort": true
      }
    }
  ]
}
```

This setting persists across sessions.

### How It Works

- **Default behavior**: `xhigh` -> `xhigh` (Opus 4.7+/Fable 5), `xhigh` -> `max` (Opus 4.6 fallback)
- **With useMaxEffort**: `xhigh` -> `max` (all models that support it)

When max effort is enabled, selecting `xhigh` in Pi (Shift+Tab) will send `max` effort to the Claude API, giving you the absolute maximum capability.

**Note**: According to Claude's documentation, `max` effort should be reserved for genuinely frontier problems, as it can lead to overthinking and higher costs on routine tasks. Use `xhigh` (default) for most coding and agentic work.
