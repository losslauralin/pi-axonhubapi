# @pandada8/pi-axonhub

Pi extension that discovers AxonHub models from `/v1/models` and `/v1/models?include=all`, merges both responses, and registers them as the `axonhub` provider.

Models are cached at `~/.cache/pi/axonhub-models.json` for one day. If no API key is configured, the extension does not register the provider.

## Usage

Install or reference this package as a Pi extension:

```sh
pi -e /path/to/pi-axonhub
```

Configure AxonHub through environment variables:

```sh
export AXONHUB_BASE_URL=http://localhost:8090
export AXONHUB_API_KEY=ah-your-api-key
pi -e /path/to/pi-axonhub
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

When using `auth.json`, still set `AXONHUB_API_KEY` for model discovery during extension load, or pass an extension option if your Pi launcher supports options.

OpenAI-compatible models are sent to AxonHub `/v1`. Anthropic-owned models are sent to AxonHub `/anthropic/v1`.
