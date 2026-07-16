# Feishu channel — upstream provenance

## Source

| Field | Value |
|-------|--------|
| Upstream project | Claude Code Best (CCB) / claude-code |
| Upstream path | `packages/feishu` |
| Local absolute path used for this vendor | `/Users/gaofei/CascadeProjects/claude-code/packages/feishu` |
| Vendored into | `channels/feishu` (this package) |
| Vendored date | 2026-07-16 |
| Package name (here) | `@xai/grok-feishu-channel` |
| Upstream package name | `@claude-code-best/feishu` |

## What was copied

- `src/accounts.ts`, `api.ts`, `cli.ts`, `index.ts`, `loading.ts`, `pairing.ts`, `permissions.ts`, `send.ts`, `server.ts`, `types.ts`, `webhook.ts`
- Upstream unit tests under `src/__tests__` were **not** copied (Bun-only).

## Grok-specific adaptations (do not drop on sync)

1. **State directory** (`accounts.ts` `getStateDir()`):
   - Default: `~/.grok/channels/feishu`
   - Override: `FEISHU_STATE_DIR`
   - Upstream default was `~/.claude/channels/feishu`

2. **Standalone serve/CLI** (new files, not in upstream):
   - `bin/serve.mjs` — MCP stdio entry (`grok-feishu-mcp`)
   - `bin/cli.mjs` — setup / pair / serve CLI (`grok-feishu-cli`)
   - `src/run-serve.ts`, `src/run-cli.ts` — TS entrypoints
   - `src/standalone-deps.ts` — no-op analytics + notification handler wiring

3. **User-facing strings** rebranded from `ccb feishu …` / Claude → Grok CLI paths and product name. **Wire protocol methods are unchanged** (CCB-compatible):
   - `notifications/claude/channel`
   - `notifications/claude/channel/permission`
   - `notifications/claude/channel/permission_request`
   - `notifications/claude/channel/assistant_delta`
   - Experimental caps: `claude/channel`, `claude/channel/permission`, `claude/channel/assistant_delta`

4. **Dependencies**: this package adds `@modelcontextprotocol/sdk`, `tsx`, and `zod` (upstream relied on the monorepo root for the MCP SDK and host-provided deps).

## How to re-sync from upstream

```bash
UPSTREAM=/path/to/claude-code/packages/feishu
DEST=channels/feishu

# 1. Refresh pure protocol modules (review diffs carefully)
for f in api.ts pairing.ts permissions.ts send.ts types.ts webhook.ts loading.ts server.ts accounts.ts cli.ts index.ts; do
  cp "$UPSTREAM/src/$f" "$DEST/src/$f"
done

# 2. Re-apply Grok patches (see list above), especially:
#    - accounts.ts getStateDir → ~/.grok/channels/feishu
#    - cli/server/webhook/loading user-facing strings
#    - keep standalone-deps.ts / run-*.ts / bin/* intact

# 3. Diff and restore standalone files if accidentally overwritten
git checkout -- channels/feishu/src/standalone-deps.ts \
  channels/feishu/src/run-cli.ts \
  channels/feishu/src/run-serve.ts \
  channels/feishu/bin

# 4. Install & smoke
cd channels/feishu && npm install
node bin/cli.mjs            # usage
node bin/cli.mjs serve      # clear error if no account
```

## How to run

```bash
cd channels/feishu
npm install

# Interactive app credentials → ~/.grok/channels/feishu/account.json
# Preferred (local host binary, distinct from official `grok`):
#   grok-local feishu setup
#   grok-local feishu access pair <code>
#   grok-local --channels feishu
#
# Or call the Node CLI directly:
node bin/cli.mjs setup
# node bin/cli.mjs setup clear

# Pair a Feishu user after they receive a pairing code
node bin/cli.mjs access pair <code>

# Start MCP server on stdio (long connection to Feishu)
node bin/serve.mjs
# or: node bin/cli.mjs serve
```

Environment:

| Variable | Meaning |
|----------|---------|
| `FEISHU_STATE_DIR` | Override state directory (account.json, access.json, pending pairings) |
| `npm_package_version` | Optional version reported to MCP clients (defaults to `0.1.0`) |

## Runtime notes

- Sources are TypeScript ESM; `bin/*.mjs` registers `tsx` then imports `src/run-*.ts`.
- Node **≥ 18** required (`engines`).
- Without a saved account, `serve` exits with a clear stderr message and code 1 (expected).
