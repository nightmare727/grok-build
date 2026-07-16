# Feishu Channel for Grok Build — Design Spec

**Date:** 2026-07-16  
**Status:** Approved (product decisions)  
**Scope:** Align with CCB channel path B: inbound inject, reply, loading/streaming cards, Feishu-side permission confirm  
**Reference:** CCB (`claude-code-best`) at `/Users/gaofei/CascadeProjects/claude-code`, package `@claude-code-best/feishu`

---

## 1. Goals and non-goals

### Goals (v1)

1. **Inbound:** Feishu private/group messages (after pairing) inject into the current Grok session as user-visible channel messages and drive an agent turn.
2. **Outbound reply:** Agent can reply via MCP tool `reply` (chat_id + text); users see results in Feishu.
3. **Loading / stream:** Immediate loading card on inbound; host streams assistant text via `assistant_delta`; final resolves the same card.
4. **Permission relay:** Tool permission prompts race local TUI vs Feishu structured yes/no + short code.
5. **Auth:** CCB-style **pairing** — unpaired senders get a code only; no session inject until `grok-local feishu access pair <code>`.
6. **Enablement:** Config defaults + CLI override (session opt-in / force-off).
7. **Implementation strategy:** Reuse CCB Feishu as **Node stdio MCP** (vendored); Grok implements **Channel Host** in Rust.

### Non-goals (v1)

- Rewrite Feishu long-connection / card UI in Rust.
- Runtime `/channels` hot plug without restart.
- Rename wire protocol off `claude/channel*` (keep CCB wire compatibility).
- Multi-session routing (one active Grok session per channel-enabled process).
- Disable local permission UI when channel is on.
- Weixin/Slack adapters (design should not block them later).

---

## 2. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Capability depth | **B** — inject + reply + loading/stream + Feishu permission |
| Feishu adapter | **Reuse CCB Feishu MCP subprocess** (Node) |
| Enablement | **Config default + CLI override** |
| Inbound auth | **Pairing** (CCB model) |
| Runtime dependency | **Node ≥ 18** required when Feishu channel is enabled |

---

## 3. Architecture

```
Feishu App (WebSocket long connection)
    │  im.message.receive_v1
    ▼
Feishu MCP Server (Node stdio, vendored under channels/feishu/)
    │  notifications/claude/channel
    │  notifications/claude/channel/permission  (inbound replies)
    ▼
Grok Channel Host (Rust)
    │  wrap <channel> → prompt queue
    ▼
Agent turn
    ├─ MCP tool: reply(chat_id, text)           → Feishu message/card
    ├─ host → notifications/…/assistant_delta   → loading card patch
    └─ host → notifications/…/permission_request → Feishu permission prompt
User replies in Feishu: "yes abcdx" / "no abcdx"
    │
    ▼
Permission race (local TUI vs channel; first claim wins)
```

### Wire protocol (CCB-compatible)

| Direction | Method | Role |
|-----------|--------|------|
| Server → Host | `notifications/claude/channel` | Inbound user content + meta |
| Server → Host | `notifications/claude/channel/permission` | Structured allow/deny for a request_id |
| Host → Server | `notifications/claude/channel/permission_request` | Relay tool permission prompt |
| Host → Server | `notifications/claude/channel/assistant_delta` | Streaming / final assistant text |
| Capability | `experimental['claude/channel']` | Gate inbound registration |
| Capability | `experimental['claude/channel/permission']` | Gate permission relay |
| Capability | `experimental['claude/channel/assistant_delta']` | Gate delta push |
| Tool | `reply` | Agent-facing outbound text (and file paths per Feishu package) |

Inbound payload shape (logical):

```json
{
  "content": "user text",
  "allow_slash_commands": true,
  "meta": {
    "chat_id": "...",
    "sender_id": "...",
    "message_id": "...",
    "attachment_path": "...",
    "attachment_type": "..."
  }
}
```

Host wraps content for the model (same idea as CCB):

```xml
<channel source="feishu" chat_id="..." sender_id="...">
...content...
</channel>
```

System / tool guidance: reply using `reply` with `chat_id` from the channel tag; prefer absolute paths for attachments.

---

## 4. Host module boundaries (Rust)

| Module | Placement | Responsibility |
|--------|-----------|----------------|
| Channel types & protocol | Prefer new crate `xai-grok-channels` (or thin types in `xai-grok-config-types` if crate overhead is too high) | `ChannelEntry`, allowlist parse, method constants, `wrap_channel_message` |
| Channel gate | Same | Register inbound handlers only if capability present **and** session allowlist matches |
| Channel runtime | `xai-grok-shell` session layer | Subscribe MCP notifications → prompt queue; track `channel_context`; emit assistant_delta |
| Permission relay | Alongside existing permission path | Fan-out permission_request; resolve structured channel permission vs local UI |
| Feishu CLI surface | `xai-grok-pager-bin` / shell CLI | `grok-local feishu setup|setup clear|access pair|serve` |
| Feishu MCP process | Vendored Node package `channels/feishu/` | Long connection, pairing, cards, permission parse, `reply` tool |

### Explicit non-responsibilities

- `xai-grok-mcp` remains a generic MCP client; channel policy lives outside pure transport where possible, with a thin notification hook API on the client.
- Feishu secrets and pairing state stay in the Feishu adapter state dir (default under `~/.grok/channels/feishu`), not in Grok session transcripts.

---

## 5. Configuration and CLI

### Config (TOML)

```toml
[channels]
# Default enabled channels for this machine. Empty = channels off unless CLI opts in.
enabled = ["feishu"]

# Optional override of Feishu MCP spawn command (default: vendored entry).
# feishu_command = ["node", "/absolute/path/to/feishu-mcp.js"]

[channels.feishu]
# state_dir = "~/.grok/channels/feishu"
```

### Precedence (high → low)

1. CLI (`--channels`, `--no-channels`)
2. Env (optional): `GROK_CHANNELS` (comma-separated) / clear override if defined later
3. User config `[channels]`
4. Default: empty list (no channels)

### CLI

| Invocation | Behavior |
|------------|----------|
| `grok-local --channels feishu` | Enable feishu for this session (may be multi-valued later) |
| `grok-local --no-channels` or `grok-local --channels none` | Force off for this session |
| `grok-local feishu setup` | Interactive App ID / App Secret → state dir |
| `grok-local feishu setup clear` | Remove credentials |
| `grok-local feishu access pair <code>` | Confirm pairing |
| `grok-local feishu serve` | Standalone MCP for debugging |

### Startup behavior

When effective channels include `feishu`:

1. Verify Node is available; if not, fail with install instructions.
2. Verify account configured (`setup` done); if not, fail with `grok-local feishu setup` hint.
3. Spawn Feishu MCP stdio process and connect via existing MCP pool.
4. Run channel gate on capabilities; if skip, surface reason (not silent).
5. Optional UX: status / `/status` shows `channels: feishu` connected or error.

---

## 6. Auth (pairing)

Align with CCB Feishu package:

- Unpaired inbound: bot replies with pairing code; **no** `notifications/claude/channel` inject to Grok.
- Operator runs `grok-local feishu access pair <code>` (wrapper over Feishu package pairing confirm).
- Paired users’ messages inject and may drive agent turns.
- Pairing store lives in Feishu state dir (same as CCB `AccessConfig` pattern).

---

## 7. Permission flow

```
Tool needs approval
  → Local TUI dialog (unchanged)
  → Also send permission_request to channel servers with
     experimental claude/channel/permission, including:
     request_id, tool_name, description, input_preview,
     channel_context { chat_id, source_server }
  → Feishu MCP posts human-readable prompt to chat
User: "yes <id>" / "no <id>"  (regex aligned with CCB PERMISSION_REPLY_RE)
  → Feishu MCP emits notifications/claude/channel/permission
  → Host claim(request_id): first of local | channel wins
```

Rules:

- Short request ids: 5 letters, alphabet without `l`, blocklist substring rehash (port CCB logic or call shared constants).
- Channel offline: local permission only; no hang.
- v1 does not suppress local UI when channel is active.
- Approvals are structured events only — never “any text containing yes”.

---

## 8. Loading / assistant_delta

1. On inbound message, Feishu MCP posts loading card (best-effort).
2. Host, during assistant streaming for a channel-originated turn, emits `assistant_delta` with `chat_id`, `text`, `is_final=false` (throttled).
3. On turn complete, emit `is_final=true` with full text; Feishu resolves/patches the same card.
4. Agent may still call `reply` for explicit outbound (attachments, second message).

Throttling: coalesce intermediate patches; final always delivered.

---

## 9. Vendoring Feishu MCP

- Source: CCB `packages/feishu` (+ minimal launcher that provides deps CCB injects via `handleFeishuCli` / `FeishuServerDeps` where required).
- Target: e.g. `channels/feishu/` in grok-build (or `third_party/feishu-channel/`).
- Build: ship a small JS entry runnable with `node`; document `npm install` / package lock under that tree.
- Upstream sync: short `channels/feishu/UPSTREAM.md` (source commit/path, how to re-vendor).
- State dir: prefer `~/.grok/channels/feishu` instead of CCB’s Claude config home when patching `getStateDir`.

---

## 10. Delivery slices

| Slice | Deliverable | Acceptance |
|-------|-------------|------------|
| **P0** | Vendored Feishu MCP + `grok-local feishu setup/pair/serve` | Standalone serve connects; pairing works |
| **P1** | Config + CLI channels + spawn + gate | `--channels feishu` connects; capability gated |
| **P2** | Inbound → prompt inject + `reply` | Message in Feishu → agent turn → reply visible |
| **P3** | assistant_delta ↔ loading card | Thinking card updates; final text lands |
| **P4** | Permission relay | Feishu yes/no + code resolves tool permission |
| **P5** | Docs + failure UX | User guide page; clear errors for no Node / no setup / unpaired |

### Testing

- Unit: gate, wrap message, allowlist parse, short request id, permission claim race.
- Integration: mock MCP notifications → assert queue inject and permission resolve.
- Manual E2E checklist against real Feishu (P0–P4); not a merge blocker if unit/integration green.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Node dependency | Fail fast with install guidance when channels enabled |
| Private CCB package | Vendor + UPSTREAM sync notes |
| Protocol name `claude/*` | Document as CCB-compatible channel protocol; optional grok aliases later |
| Compromised channel server | Accept same trust model as CCB; pairing + session allowlist; structured permission only |
| Prompt injection via Feishu | Channel tags + user-visible source; pairing reduces strangers |

---

## 12. Open items for implementation plan (not blocking design)

- Exact crate split (`xai-grok-channels` vs shell-internal module) decided at plan time by dependency graph.
- Whether `GROK_CHANNELS` env ships in v1 or is deferred.
- Precise prompt-queue priority for channel messages vs local typing (prefer “next” / idle-fill, avoid stomping in-flight tool UI carelessly).
- How assistant_delta is hooked into existing stream pipeline (session actor vs pager).

---

## 13. Success criteria

v1 is done when:

1. Operator can setup + pair + start `grok-local --channels feishu` (or config-enabled) with Node present.
2. A paired Feishu user can message the bot and get a correct agent-driven reply in Feishu.
3. Loading card appears and updates to final answer.
4. A tool permission can be approved or denied from Feishu with yes/no + code, racing local UI.
5. Unpaired users cannot drive the agent; missing Node/setup fails loudly.
