//! CCB-compatible channel protocol: wire constants, inbound message wrap, and
//! server registration gate for Grok Build channel host.

mod config;
mod gate;
mod types;
mod wrap;

pub use config::{
    ChannelsConfig, DEFAULT_FEISHU_STATE_DIR, FeishuChannelConfig, channels_config_from_value,
    parse_channels_from_toml, resolve_effective_channels,
};
pub use gate::{GateResult, GateSkipKind, gate_channel_server};
pub use types::{
    CAP_ASSISTANT_DELTA, CAP_CHANNEL, CAP_CHANNEL_PERMISSION, CHANNEL_ASSISTANT_DELTA,
    CHANNEL_NOTIFICATION, CHANNEL_PERMISSION, CHANNEL_PERMISSION_REQUEST, ChannelEntry,
    ChannelInbound, ChannelMeta,
};
pub use wrap::wrap_channel_message;
