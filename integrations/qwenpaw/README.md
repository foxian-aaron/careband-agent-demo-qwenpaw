# QwenPaw Integration

Run `scripts/configure-qwenpaw-agent.ps1` after QwenPaw is installed. The script creates `careband_summary_agent` when missing, disables all runtime tools and MCP clients, selects Alibaba `qwen3.6-plus`, and installs the prompt files in this directory.

After configuring or refreshing the Alibaba credential, run the credential-safe synthetic probe:

```powershell
& scripts/probe-qwenpaw-provider.ps1
```

The probe sends only fictional E001 aggregate text, stores its log under `%LOCALAPPDATA%\CareBandDemo\qwen-probes`, validates JSON-only output and the rule-owned risk fields, and exits non-zero when QwenPaw reports an expired/invalid credential. Then start the local service and run `npm run smoke:qwenpaw` in `backend` to validate the real `/api/agent/process` SSE bridge and the full Agent Schema.

No API key or provider secret is stored in this repository.
