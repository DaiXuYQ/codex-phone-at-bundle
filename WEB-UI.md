# Web Console

Local web UI for the existing phone signup, AT pool, and PPXY Plus upgrade workflow.

## Start

Windows:
```bat
start-web.cmd
```

Or:
```bash
cd codex_register
npm run web
```

Default URL is `http://127.0.0.1:8787/`. If port 8787 is already in use, the server automatically tries 8788, 8789, etc. Check the terminal output for the actual URL.

## Pages

- `/register`: phone signup task runner. It calls `src/index.ts --phone --at --st` and appends successful ATs to `pool_tokens.txt`.
- `/plus`: AT pool, AT import, trial check, PPXY Plus job create/query/OTP submit.

## Config

PPXY settings are reused from root `ppxy-env.cmd`:

- `PPXY_API_KEY`
- `PPXY_BASE_URL`
- `PPXY_PROXY_JP`
- `TOKEN_FILE`

Register tasks still use the existing `codex_register/config.json` and related environment variables.
