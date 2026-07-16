//! Channel enablement config and effective-list resolution.
//!
//! TOML shape:
//!
//! ```toml
//! [channels]
//! enabled = ["feishu"]
//!
//! [channels.feishu]
//! state_dir = "~/.grok/channels/feishu"
//! # command = ["node", "/path/to/feishu-mcp.js"]  # optional spawn override
//! ```
//!
//! Precedence for the effective allowlist (high → low):
//! 1. `no_channels = true` (CLI `--no-channels`) → empty
//! 2. `cli_channels = Some(...)` (CLI `--channels`) → that list (empty = force off)
//! 3. `config.enabled` (user config default)
//! 4. Default: empty (channels off)

use serde::{Deserialize, Serialize};

/// Default Feishu adapter state directory (tilde form; host expands at use).
pub const DEFAULT_FEISHU_STATE_DIR: &str = "~/.grok/channels/feishu";

fn default_feishu_state_dir() -> String {
    DEFAULT_FEISHU_STATE_DIR.to_string()
}

/// Top-level `[channels]` configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelsConfig {
    /// Channel names enabled by default for this machine.
    /// Empty = channels off unless CLI opts in.
    #[serde(default)]
    pub enabled: Vec<String>,

    /// Feishu-specific channel settings.
    #[serde(default)]
    pub feishu: FeishuChannelConfig,
}

/// `[channels.feishu]` settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeishuChannelConfig {
    /// Directory for Feishu credentials / pairing state.
    #[serde(default = "default_feishu_state_dir")]
    pub state_dir: String,

    /// Optional override for the Feishu MCP spawn command
    /// (e.g. `["node", "/absolute/path/to/feishu-mcp.js"]`).
    /// When `None`, the host uses the vendored default entry.
    #[serde(default)]
    pub command: Option<Vec<String>>,
}

impl Default for FeishuChannelConfig {
    fn default() -> Self {
        Self {
            state_dir: default_feishu_state_dir(),
            command: None,
        }
    }
}

/// Resolve effective channel names for this session.
///
/// Precedence:
/// - `no_channels == true` → empty
/// - else if `cli_channels` is `Some` → that list (including empty = force none via CLI)
/// - else `config.enabled`
pub fn resolve_effective_channels(
    config: &ChannelsConfig,
    cli_channels: Option<&[String]>,
    no_channels: bool,
) -> Vec<String> {
    if no_channels {
        return Vec::new();
    }
    if let Some(list) = cli_channels {
        return list.to_vec();
    }
    config.enabled.clone()
}

/// Parse a `[channels]` section from a TOML document string.
///
/// Accepts either a full config document containing `[channels]`, or a bare
/// channels table (keys like `enabled` / `feishu` at the root).
pub fn parse_channels_from_toml(toml_str: &str) -> Result<ChannelsConfig, toml::de::Error> {
    let value: toml::Value = toml::from_str(toml_str)?;
    Ok(channels_config_from_value(&value))
}

/// Extract [`ChannelsConfig`] from a root TOML value.
///
/// Prefer the nested `channels` table when present; otherwise treat `root` as
/// the channels table itself. Parse failures fall back to defaults.
pub fn channels_config_from_value(root: &toml::Value) -> ChannelsConfig {
    if let Some(section) = root.get("channels") {
        return section.clone().try_into().unwrap_or_default();
    }
    root.clone().try_into().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_overrides_config_and_none_disables() {
        let cfg = ChannelsConfig {
            enabled: vec!["feishu".into()],
            ..Default::default()
        };
        assert_eq!(
            resolve_effective_channels(&cfg, Some(&["feishu".into()]), false),
            vec!["feishu".to_string()]
        );
        assert!(resolve_effective_channels(&cfg, None, true /* no_channels */).is_empty());
        assert_eq!(
            resolve_effective_channels(&cfg, None, false),
            vec!["feishu".to_string()]
        );
    }

    #[test]
    fn cli_empty_list_forces_none_even_when_config_enabled() {
        let cfg = ChannelsConfig {
            enabled: vec!["feishu".into()],
            ..Default::default()
        };
        assert!(resolve_effective_channels(&cfg, Some(&[]), false).is_empty());
    }

    #[test]
    fn no_channels_wins_over_cli_list() {
        let cfg = ChannelsConfig {
            enabled: vec!["feishu".into()],
            ..Default::default()
        };
        assert!(
            resolve_effective_channels(&cfg, Some(&["feishu".into()]), true).is_empty(),
            "--no-channels must win even when --channels is also set"
        );
    }

    #[test]
    fn default_config_enables_nothing() {
        let cfg = ChannelsConfig::default();
        assert!(cfg.enabled.is_empty());
        assert_eq!(cfg.feishu.state_dir, DEFAULT_FEISHU_STATE_DIR);
        assert!(cfg.feishu.command.is_none());
        assert!(resolve_effective_channels(&cfg, None, false).is_empty());
    }

    #[test]
    fn parse_channels_toml_section() {
        let cfg = parse_channels_from_toml(
            r#"
            [channels]
            enabled = ["feishu"]

            [channels.feishu]
            state_dir = "/tmp/feishu-state"
            command = ["node", "/opt/feishu/mcp.js"]
            "#,
        )
        .expect("parse");

        assert_eq!(cfg.enabled, vec!["feishu".to_string()]);
        assert_eq!(cfg.feishu.state_dir, "/tmp/feishu-state");
        assert_eq!(
            cfg.feishu.command.as_deref(),
            Some(["node".to_string(), "/opt/feishu/mcp.js".to_string()].as_slice())
        );
    }

    #[test]
    fn parse_channels_toml_defaults_state_dir_when_missing() {
        let cfg = parse_channels_from_toml(
            r#"
            [channels]
            enabled = ["feishu"]
            "#,
        )
        .expect("parse");

        assert_eq!(cfg.enabled, vec!["feishu".to_string()]);
        assert_eq!(cfg.feishu.state_dir, DEFAULT_FEISHU_STATE_DIR);
        assert!(cfg.feishu.command.is_none());
    }

    #[test]
    fn parse_bare_channels_table() {
        let cfg = parse_channels_from_toml(
            r#"
            enabled = ["feishu"]
            [feishu]
            state_dir = "~/custom"
            "#,
        )
        .expect("parse");

        assert_eq!(cfg.enabled, vec!["feishu".to_string()]);
        assert_eq!(cfg.feishu.state_dir, "~/custom");
    }

    #[test]
    fn parse_empty_document_is_default() {
        let cfg = parse_channels_from_toml("").expect("parse");
        assert_eq!(cfg, ChannelsConfig::default());
    }

    #[test]
    fn channels_config_from_value_prefers_nested_section() {
        let root: toml::Value = toml::from_str(
            r#"
            enabled = ["ignore-me"]
            [channels]
            enabled = ["feishu"]
            "#,
        )
        .unwrap();
        let cfg = channels_config_from_value(&root);
        assert_eq!(cfg.enabled, vec!["feishu".to_string()]);
    }

    #[test]
    fn resolve_uses_config_when_cli_absent() {
        let cfg = ChannelsConfig {
            enabled: vec!["feishu".into(), "slack".into()],
            ..Default::default()
        };
        assert_eq!(
            resolve_effective_channels(&cfg, None, false),
            vec!["feishu".to_string(), "slack".to_string()]
        );
    }

    #[test]
    fn round_trip_serialize() {
        let cfg = ChannelsConfig {
            enabled: vec!["feishu".into()],
            feishu: FeishuChannelConfig {
                state_dir: "/var/feishu".into(),
                command: Some(vec!["node".into(), "mcp.js".into()]),
            },
        };
        let s = toml::to_string(&cfg).expect("serialize");
        let back: ChannelsConfig = toml::from_str(&s).expect("deserialize");
        assert_eq!(cfg, back);
    }
}
