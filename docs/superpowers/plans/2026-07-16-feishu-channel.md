# Feishu Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CCB-compatible Feishu channel in Grok Build: paired inbound messages inject into the session, agent replies via `reply`, loading cards stream via `assistant_delta`, and tool permissions race Feishu yes/no+code against local TUI.

**Architecture:** Vendored Node Feishu MCP (stdio) speaks CCB wire methods (`notifications/claude/channel*`). Grok adds a Rust channel host: config/CLI allowlist, MCP custom-notification fan-out, prompt inject, permission relay, and assistant_delta push. Pairing and Feishu I/O stay in the Node package.

**Tech Stack:** Rust (workspace crates), rmcp 2.1 (`on_custom_notification`), Node ≥18 + `@modelcontextprotocol/sdk` + `@larksuiteoapi/node-sdk`, TOML config, clap CLI.

**Spec:** `docs/superpowers/specs/2026-07-16-feishu-channel-design.md`

---

## File map (create / modify)

### New

| Path | Responsibility |
|------|----------------|
| `channels/feishu/**` | Vendored Feishu MCP (from CCB `packages/feishu`) + standalone launcher + `package.json` + `UPSTREAM.md` |
| `crates/codegen/xai-grok-channels/Cargo.toml` | New crate |
| `crates/codegen/xai-grok-channels/src/lib.rs` | Re-exports |
| `crates/codegen/xai-grok-channels/src/types.rs` | `ChannelEntry`, wire method constants, meta structs |
| `crates/codegen/xai-grok-channels/src/wrap.rs` | `wrap_channel_message` |
| `crates/codegen/xai-grok-channels/src/gate.rs` | `gate_channel_server` / allowlist match |
| `crates/codegen/xai-grok-channels/src/config.rs` | Parse `[channels]` TOML + resolve effective list |
| `crates/codegen/xai-grok-channels/src/permission_id.rs` | Short request id (CCB alphabet / blocklist) |
| `crates/codegen/xai-grok-channels/src/permission_claim.rs` | First-wins claim map for permission race |
| `crates/codegen/xai-grok-channels/tests/*.rs` | Unit tests |

### Modify

| Path | Change |
|------|--------|
| `Cargo.toml` (workspace) | Add `xai-grok-channels` member + workspace dep |
| `crates/codegen/xai-grok-mcp/src/servers.rs` | `McpClientEvent::CustomNotification`; implement `on_custom_notification` on `GrokClientHandler`; helper to send custom notifications host→server if needed |
| `crates/codegen/xai-grok-shell/src/session/mcp_dispatcher.rs` | Route channel events to channel runtime |
| `crates/codegen/xai-grok-shell/src/session/` (new `channel_runtime.rs`) | Inject prompts; track chat context; emit deltas; permission fan-out |
| `crates/codegen/xai-grok-shell/Cargo.toml` | Depend on `xai-grok-channels` |
| `crates/codegen/xai-grok-config-types` or shell config resolve | Wire `[channels]` into loaded config |
| `crates/codegen/xai-grok-pager-bin/src/main.rs` (and/or shell CLI) | `--channels` / `--no-channels`; `feishu` subcommands |
| `crates/codegen/xai-grok-workspace/src/permission/` | Optional hook: on prompt, also notify channel; accept remote resolve |
| User guide under `crates/codegen/xai-grok-pager/docs/user-guide/` | Feishu channel page |

---

## Task 0: Preconditions

- [ ] **Step 0.1:** Confirm Node ≥ 18 available (`node -v`).
- [ ] **Step 0.2:** Read design spec end-to-end.
- [ ] **Step 0.3:** Skim CCB sources:
  - `packages/feishu/src/{server,webhook,pairing,accounts,loading,permissions,cli}.ts`
  - CCB host: `src/services/mcp/channelNotification.ts`, `channelPermissions.ts`

---

## Task 1: Vendor Feishu MCP (P0)

**Files:**
- Create: `channels/feishu/**` (copy from CCB)
- Create: `channels/feishu/UPSTREAM.md`
- Create: `channels/feishu/bin/serve.mjs` (or `dist` entry) with no-op analytics deps

- [ ] **Step 1.1:** Copy CCB package tree

```bash
mkdir -p channels/feishu
cp -R /Users/gaofei/CascadeProjects/claude-code/packages/feishu/src channels/feishu/
cp /Users/gaofei/CascadeProjects/claude-code/packages/feishu/package.json channels/feishu/
# Add package-lock after npm install
```

- [ ] **Step 1.2:** Write `channels/feishu/package.json` dependencies at minimum:

```json
{
  "name": "@xai/grok-feishu-channel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "grok-feishu-mcp": "./bin/serve.mjs"
  },
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.68.0",
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

(Pin versions to whatever resolves cleanly; match CCB where possible.)

- [ ] **Step 1.3:** Default state dir to Grok home

In `accounts.ts` `getStateDir()`:

```typescript
export function getStateDir(): string {
  const dir =
    process.env.FEISHU_STATE_DIR ||
    join(homedir(), '.grok', 'channels', 'feishu')
  // mkdir as today
  return dir
}
```

Document `FEISHU_STATE_DIR` override in UPSTREAM.md.

- [ ] **Step 1.4:** Standalone serve entry (`bin/serve.mjs` or TS compiled)

Implement deps stubs for CCB `FeishuServerDeps`:

```typescript
const deps = {
  enableConfigs() {},
  initializeAnalyticsSink() {},
  async shutdownDatadog() {},
  async shutdown1PEventLogging() {},
  logForDebugging(msg) { process.stderr.write(msg + '\n') },
  registerPermissionHandler(server, handler) { /* wire server.setNotificationHandler for permission_request */ },
  registerAssistantDeltaHandler(server, handler) { /* wire assistant_delta */ },
}
await runFeishuMcpServer(process.env.npm_package_version ?? '0.1.0', deps)
```

Wire notification handlers exactly as CCB `handleFeishuCli` does for permission + assistant_delta (see CCB `cli.tsx` feishu branch).

- [ ] **Step 1.5:** CLI helpers for setup/pair in Node (`bin/cli.mjs`) or pure shell wrapping the same modules as CCB `cli.ts` (`setup`, `setup clear`, `access pair`, `serve`).

- [ ] **Step 1.6:** `npm install` in `channels/feishu`; smoke:

```bash
cd channels/feishu && node bin/cli.mjs setup   # interactive once
node bin/cli.mjs serve   # expect "Server ready" or account error if unset
```

- [ ] **Step 1.7:** Write `UPSTREAM.md` (source path, date, sync instructions).

- [ ] **Step 1.8:** Commit

```bash
git add channels/feishu
git commit -m "feat(channels): vendor Feishu MCP from CCB"
```

---

## Task 2: `xai-grok-channels` crate — types, wrap, gate (P1 foundation)

**Files:**
- Create crate as in file map
- Modify: workspace `Cargo.toml`

- [ ] **Step 2.1:** Scaffold crate + workspace member.

- [ ] **Step 2.2:** Write failing tests for wrap + gate.

```rust
// crates/codegen/xai-grok-channels/src/wrap.rs tests
#[test]
fn wraps_content_with_source_and_safe_meta() {
    let out = wrap_channel_message(
        "feishu",
        "hello",
        &[("chat_id", "oc_1"), ("bad key", "x"), ("sender_id", "ou_2")],
    );
    assert!(out.contains(r#"source="feishu""#));
    assert!(out.contains(r#"chat_id="oc_1""#));
    assert!(out.contains(r#"sender_id="ou_2""#));
    assert!(!out.contains("bad key"));
    assert!(out.contains("hello"));
}

#[test]
fn gate_requires_capability_and_allowlist() {
    let caps = experimental_with("claude/channel");
    assert!(matches!(
        gate_channel_server("feishu", Some(&caps), &["feishu"]),
        GateResult::Register
    ));
    assert!(matches!(
        gate_channel_server("feishu", Some(&caps), &[]),
        GateResult::Skip { kind: GateSkipKind::Session, .. }
    ));
    assert!(matches!(
        gate_channel_server("feishu", None, &["feishu"]),
        GateResult::Skip { kind: GateSkipKind::Capability, .. }
    ));
}
```

- [ ] **Step 2.3:** Implement `types.rs`, `wrap.rs`, `gate.rs` until tests pass.

Constants:

```rust
pub const CHANNEL_NOTIFICATION: &str = "notifications/claude/channel";
pub const CHANNEL_PERMISSION: &str = "notifications/claude/channel/permission";
pub const CHANNEL_PERMISSION_REQUEST: &str = "notifications/claude/channel/permission_request";
pub const CHANNEL_ASSISTANT_DELTA: &str = "notifications/claude/channel/assistant_delta";
pub const CAP_CHANNEL: &str = "claude/channel";
pub const CAP_CHANNEL_PERMISSION: &str = "claude/channel/permission";
pub const CAP_ASSISTANT_DELTA: &str = "claude/channel/assistant_delta";
```

- [ ] **Step 2.4:** Commit

```bash
git commit -m "feat(channels): add xai-grok-channels wrap and gate"
```

---

## Task 3: Channel config resolution (P1)

**Files:**
- `xai-grok-channels/src/config.rs`
- Shell/config load path that already parses TOML sections

- [ ] **Step 3.1:** Failing tests for precedence:

```rust
#[test]
fn cli_overrides_config_and_none_disables() {
    let cfg = ChannelsConfig { enabled: vec!["feishu".into()], ..Default::default() };
    assert_eq!(
        resolve_effective_channels(&cfg, Some(&["feishu".into()]), None),
        vec!["feishu".to_string()]
    );
    assert!(resolve_effective_channels(&cfg, Some(&[]), Some(true /* no_channels */)).is_empty());
    assert_eq!(
        resolve_effective_channels(&cfg, None, None),
        vec!["feishu".to_string()]
    );
}
```

- [ ] **Step 3.2:** Implement `ChannelsConfig` serde for:

```toml
[channels]
enabled = ["feishu"]

[channels.feishu]
state_dir = "~/.grok/channels/feishu"
# feishu_command = ["node", "..."]
```

- [ ] **Step 3.3:** Hook into existing config merge (follow patterns in `xai-grok-shell` config resolve for new sections). Expose resolved list on session/agent config.

- [ ] **Step 3.4:** Commit

```bash
git commit -m "feat(channels): config and effective channel resolution"
```

---

## Task 4: MCP custom notification plumbing (P1)

**Files:**
- Modify: `crates/codegen/xai-grok-mcp/src/servers.rs` (`McpClientEvent`, `GrokClientHandler`, `McpClientEventKind`)
- Modify: `crates/codegen/xai-grok-shell/src/session/mcp_dispatcher.rs`

- [ ] **Step 4.1:** Extend event enum:

```rust
McpClientEvent::CustomNotification {
    server: McpServerName,
    method: String,
    params: serde_json::Value,
}
```

Add matching `McpClientEventKind::CustomNotification`.

- [ ] **Step 4.2:** Implement on handler (rmcp has this hook):

```rust
async fn on_custom_notification(
    &self,
    notification: CustomNotification,
    _context: NotificationContext<RoleClient>,
) {
    self.emit(McpClientEvent::CustomNotification {
        server: self.server_name.clone(),
        method: notification.method,
        params: notification.params.unwrap_or(serde_json::Value::Null),
    });
}
```

(Adjust field names to match actual `CustomNotification` type in rmcp 2.1.)

- [ ] **Step 4.3:** Unit test: emit custom notification → receiver gets method + params (mirror existing `GrokClientHandler` emit tests around line ~7427).

- [ ] **Step 4.4:** Dispatcher: do not drop `CustomNotification` in the kind match; forward to a channel callback / actor message (stub ok if channel runtime not ready — log + ignore only if no subscriber).

- [ ] **Step 4.5:** Commit

```bash
git commit -m "feat(mcp): fan out custom server notifications"
```

---

## Task 5: CLI — `--channels` / `feishu` subcommands (P0/P1)

**Files:**
- `crates/codegen/xai-grok-pager-bin/src/main.rs` (or wherever top-level clap lives)
- Possibly thin wrapper that execs `node channels/feishu/bin/cli.mjs`

- [ ] **Step 5.1:** Add clap flags:

```rust
/// Enable session channels (e.g. feishu). Repeatable or comma-separated per existing style.
#[arg(long = "channels", value_name = "NAME")]
channels: Vec<String>,

/// Disable all channels for this session (overrides config).
#[arg(long = "no-channels")]
no_channels: bool,
```

- [ ] **Step 5.2:** Add subcommand:

```text
grok-local feishu setup
grok-local feishu setup clear
grok-local feishu access pair <code>
grok-local feishu serve
```

Implementation: spawn Node CLI with `FEISHU_STATE_DIR` set from config/default `~/.grok/channels/feishu`. Resolve vendored path relative to executable or `CARGO_MANIFEST_DIR` / install layout — document both dev and release.

- [ ] **Step 5.3:** Tests for clap parse of `--channels feishu` and `--no-channels` (follow existing pager-bin clap tests).

- [ ] **Step 5.4:** Commit

```bash
git commit -m "feat(cli): channels flags and feishu subcommands"
```

---

## Task 6: Spawn Feishu MCP when enabled (P1)

**Files:**
- Shell session MCP startup (`session/mcp_servers.rs` / managed MCP)
- Channel config → inject stdio server definition

- [ ] **Step 6.1:** When effective channels contain `feishu`, ensure an MCP server entry is present, e.g. name `feishu`:

```rust
McpServerTransportConfig::Stdio {
    command: "node".into(),
    args: vec![feishu_serve_script_path()],
    env: Some(maplit! {
        "FEISHU_STATE_DIR" => state_dir,
    }),
    cwd: None,
}
```

Preflight:

1. `which node` / `Command::new("node").arg("-v")` — error string if missing.
2. Account file exists under state dir — error with `grok-local feishu setup`.

- [ ] **Step 6.2:** After handshake Ready, read server capabilities (`experimental` map). Call `gate_channel_server`. If Register, mark server as channel-active for this session.

- [ ] **Step 6.3:** Integration-style test with fake stdio MCP optional; at minimum unit-test preflight helpers.

- [ ] **Step 6.4:** Commit

```bash
git commit -m "feat(channels): spawn and gate Feishu MCP server"
```

---

## Task 7: Inbound inject + reply path (P2)

**Files:**
- Create: `crates/codegen/xai-grok-shell/src/session/channel_runtime.rs`
- Wire from mcp_dispatcher CustomNotification
- Session actor: enqueue user prompt

- [ ] **Step 7.1:** Parse channel notification params:

```rust
struct ChannelInbound {
    content: String,
    allow_slash_commands: bool,
    meta: HashMap<String, String>,
}
```

- [ ] **Step 7.2:** On `notifications/claude/channel` from gated server:

1. `wrap_channel_message(server, content, &meta)`
2. Record last `chat_id` for permission / delta routing
3. Enqueue as user prompt with `kind: "channel"` (or existing synthetic prompt path used for auto-wake / scheduler — **find and reuse** the same inject API as scheduled tasks / goal continue)

Search for existing inject patterns:

```bash
rg -n "ScheduledTaskFired|auto.wake|enqueue.*prompt|UserPrompt" crates/codegen/xai-grok-shell/src -g '*.rs'
```

Reuse that path; do not invent a second queue.

- [ ] **Step 7.3:** Ensure Feishu `reply` tool is available via normal MCP tools list (no special case if tools already exposed). System reminder once per session when channel connects:

```text
Messages from Feishu arrive as <channel source="feishu" chat_id="...">.
Reply with the reply tool using that chat_id.
```

- [ ] **Step 7.4:** Unit test: wrap + parse params + “would enqueue” with mock actor/channel.

- [ ] **Step 7.5:** Manual checklist note in plan comments; commit

```bash
git commit -m "feat(channels): inject Feishu messages into session"
```

---

## Task 8: assistant_delta streaming (P3)

**Files:**
- `channel_runtime.rs`
- Stream pipeline in session actor (assistant text chunks)
- MCP host→server custom notification send API on `McpClient`

- [ ] **Step 8.1:** Add `McpClient::notify_custom(method, params)` (or use existing JSON-RPC notify if present) to push to the Feishu server.

- [ ] **Step 8.2:** For turns originated from channel (track flag / chat_id on prompt meta):

- On assistant text delta: throttled `assistant_delta` with `{ text, is_final: false, channel_context: { chat_id } }`
- On turn complete: `{ text: full, is_final: true, channel_context }`

Throttle: ≥300–500ms between intermediate patches or only when text grows by N chars (match CCB loading coalescing intent).

- [ ] **Step 8.3:** Unit test throttle/coalesce helper pure functions.

- [ ] **Step 8.4:** Commit

```bash
git commit -m "feat(channels): stream assistant_delta to Feishu loading card"
```

---

## Task 9: Permission relay (P4)

**Files:**
- `xai-grok-channels/src/permission_id.rs`, `permission_claim.rs`
- `xai-grok-workspace` permission prompter / manager
- `channel_runtime.rs`

- [ ] **Step 9.1:** Port short request id tests from CCB behavior:

```rust
#[test]
fn short_id_is_five_letters_without_l() {
    let id = short_request_id("toolu_abc123");
    assert_eq!(id.len(), 5);
    assert!(id.chars().all(|c| c.is_ascii_lowercase() && c != 'l'));
}
```

- [ ] **Step 9.2:** `PermissionClaimMap`: `register(id, oneshot)` / `resolve(id, Allow|Deny) -> bool`.

- [ ] **Step 9.3:** When local permission prompt starts, if channel server has `claude/channel/permission` capability:

Send `permission_request` with preview truncated to 200 chars (shared helper).

- [ ] **Step 9.4:** On inbound `notifications/claude/channel/permission`, `claim.resolve` — if true, complete pending prompt as Allow/Deny.

Race with local UI: both registered; first completion wins; second is no-op.

- [ ] **Step 9.5:** Unit tests for claim race (two resolvers, only first succeeds).

- [ ] **Step 9.6:** Commit

```bash
git commit -m "feat(channels): Feishu permission relay with claim race"
```

---

## Task 10: Docs + failure UX (P5)

**Files:**
- `crates/codegen/xai-grok-pager/docs/user-guide/` (new `feishu-channel.md` or under integrations)
- README pointer if appropriate
- Error strings for preflight

- [ ] **Step 10.1:** User guide: setup Feishu app, long connection, subscribe `im.message.receive_v1`, `grok-local feishu setup`, pair, `grok-local --channels feishu` or config, troubleshooting (Node missing, unpaired, not gated).

- [ ] **Step 10.2:** Ensure failed channel start shows in TUI/status (not silent).

- [ ] **Step 10.3:** Commit

```bash
git commit -m "docs: Feishu channel user guide and error UX"
```

---

## Task 11: End-to-end verification checklist

Manual (real Feishu; operator-owned):

- [ ] `grok-local feishu setup` saves account under `~/.grok/channels/feishu`
- [ ] Unpaired user gets pairing code only
- [ ] `grok-local feishu access pair <code>` then message injects
- [ ] Agent `reply` appears in Feishu
- [ ] Loading card updates during turn
- [ ] Tool permission: `yes <id>` / `no <id>` works; local UI still works
- [ ] `grok-local --no-channels` does not spawn Feishu
- [ ] Config `enabled = ["feishu"]` works without CLI flag

Automated regression to keep green:

```bash
cargo test -p xai-grok-channels
cargo test -p xai-grok-mcp custom_notification
cargo test -p xai-grok-shell channel
```

---

## Dependency / build notes

- Do **not** add Node as a hard dependency of the Rust binary at link time; only require Node when channels enabled.
- Vendored `channels/feishu/node_modules` should be **gitignored**; CI or postinstall docs explain `npm ci` in that directory for release packaging if needed.
- Release packaging follow-up (out of v1 if needed): ship `channels/feishu` assets next to the binary or embed path discovery.

---

## Execution order summary

```
Task 1 vendor Feishu
  → Task 2 types/wrap/gate
  → Task 3 config
  → Task 4 MCP custom notifications
  → Task 5 CLI
  → Task 6 spawn+gate
  → Task 7 inject+reply
  → Task 8 assistant_delta
  → Task 9 permission
  → Task 10 docs
  → Task 11 E2E checklist
```

Tasks 2–3 can partially parallel after crate scaffold; 4 blocks 7–9; 1 blocks 5–6.

---

## Out of scope reminders

- Hot `/channels` toggle mid-session  
- Renaming wire methods off `claude/*`  
- Multi-session Feishu routing  
- Weixin/Slack adapters  
- Suppressing local permission UI  
