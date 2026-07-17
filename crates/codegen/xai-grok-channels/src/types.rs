//! Wire method constants and shared channel data types.

/// Server → host: inbound user content + meta.
pub const CHANNEL_NOTIFICATION: &str = "notifications/claude/channel";
/// Server → host: structured allow/deny for a permission request_id.
pub const CHANNEL_PERMISSION: &str = "notifications/claude/channel/permission";
/// Host → server: relay a tool permission prompt to the channel.
pub const CHANNEL_PERMISSION_REQUEST: &str = "notifications/claude/channel/permission_request";
/// Host → server: streaming / final assistant text for loading cards.
pub const CHANNEL_ASSISTANT_DELTA: &str = "notifications/claude/channel/assistant_delta";

/// MCP experimental capability: gate inbound channel registration.
pub const CAP_CHANNEL: &str = "claude/channel";
/// MCP experimental capability: gate permission relay.
pub const CAP_CHANNEL_PERMISSION: &str = "claude/channel/permission";
/// MCP experimental capability: gate assistant_delta push.
pub const CAP_ASSISTANT_DELTA: &str = "claude/channel/assistant_delta";

/// A named channel in the session allowlist (exact match for v1, e.g. `"feishu"`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ChannelEntry {
    pub name: String,
}

impl ChannelEntry {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }
}

/// Common meta fields on inbound channel notifications (logical shape).
///
/// Extra keys may appear on the wire; hosts should also keep the raw map when
/// wrapping so unknown safe attributes can still be forwarded.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelMeta {
    pub chat_id: Option<String>,
    pub sender_id: Option<String>,
    pub message_id: Option<String>,
    pub attachment_path: Option<String>,
    pub attachment_type: Option<String>,
}

/// Logical inbound channel notification (host-facing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelInbound {
    pub content: String,
    pub allow_slash_commands: bool,
    pub meta: ChannelMeta,
}
