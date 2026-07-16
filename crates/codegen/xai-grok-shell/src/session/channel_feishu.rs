//! Feishu channel MCP injection: preflight + stdio server definition.
//!
//! When effective channels include `feishu`, the session MCP merge path
//! injects a stdio MCP server that runs the vendored Node package under
//! `channels/feishu/`. Wire protocol is CCB-compatible
//! (`notifications/claude/channel*`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use agent_client_protocol as acp;
use xai_grok_channels::{
    CAP_CHANNEL, ChannelsConfig, FeishuChannelConfig, GateResult, gate_channel_server,
    resolve_effective_channels,
};

/// Canonical MCP server name for the Feishu channel adapter.
pub const FEISHU_MCP_SERVER_NAME: &str = "feishu";

/// Env: force channels off for this process (CLI `--no-channels`).
pub const ENV_NO_CHANNELS: &str = "GROK_NO_CHANNELS";
/// Env: comma-separated channel list (CLI `--channels`).
pub const ENV_CHANNELS: &str = "GROK_CHANNELS";

/// Resolve effective channel names from config + process env (CLI → env).
pub fn resolve_effective_channels_from_env(config: &ChannelsConfig) -> Vec<String> {
    let no_channels = env_truthy(ENV_NO_CHANNELS);
    let cli_channels = match std::env::var(ENV_CHANNELS) {
        Ok(raw) => Some(
            raw.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>(),
        ),
        Err(_) => None,
    };
    resolve_effective_channels(config, cli_channels.as_deref(), no_channels)
}

fn env_truthy(name: &str) -> bool {
    match std::env::var(name) {
        Ok(v) => {
            let v = v.trim();
            !(v.is_empty() || v == "0" || v.eq_ignore_ascii_case("false") || v.eq_ignore_ascii_case("no"))
        }
        Err(_) => false,
    }
}

/// Expand `~` / `~/path` using the home directory.
pub fn expand_home_path(raw: &str) -> PathBuf {
    crate::claude_import::expand_home(raw)
}

/// Resolve path to vendored `channels/feishu/bin/serve.mjs`.
pub fn resolve_feishu_serve_mjs() -> Result<PathBuf, String> {
    let candidates = |root: &Path| -> Vec<PathBuf> {
        vec![
            root.join("bin/serve.mjs"),
            root.join("serve.mjs"),
            root.join("channels/feishu/bin/serve.mjs"),
            root.join("../channels/feishu/bin/serve.mjs"),
        ]
    };

    if let Ok(dir) = std::env::var("GROK_FEISHU_CHANNEL_DIR") {
        let root = PathBuf::from(&dir);
        for c in candidates(&root) {
            if c.is_file() {
                return Ok(c);
            }
        }
        return Err(format!(
            "GROK_FEISHU_CHANNEL_DIR={dir}: expected bin/serve.mjs under this directory"
        ));
    }

    if let Ok(exe) = std::env::current_exe()
        && let Some(parent) = exe.parent()
    {
        for c in candidates(parent) {
            if c.is_file() {
                return Ok(c);
            }
        }
        let mut walk = parent.to_path_buf();
        for _ in 0..8 {
            let c = walk.join("channels/feishu/bin/serve.mjs");
            if c.is_file() {
                return Ok(c);
            }
            if !walk.pop() {
                break;
            }
        }
    }

    let mut walk = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..8 {
        let c = walk.join("channels/feishu/bin/serve.mjs");
        if c.is_file() {
            return Ok(c);
        }
        if !walk.pop() {
            break;
        }
    }

    Err(
        "could not find channels/feishu/bin/serve.mjs. Set GROK_FEISHU_CHANNEL_DIR \
         or run from a source checkout."
            .into(),
    )
}

/// Ensure `node` is available on PATH.
pub fn ensure_node_available() -> Result<(), String> {
    match std::process::Command::new("node").arg("-v").output() {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Err(format!(
                "Node.js is required for the Feishu channel (`node -v` failed). \
                 Install Node ≥ 18. {stderr}"
            ))
        }
        Err(e) => Err(format!(
            "Node.js is required for the Feishu channel but `node` was not found on PATH ({e}). \
             Install Node ≥ 18."
        )),
    }
}

/// True if Feishu account credentials exist under `state_dir`.
pub fn feishu_account_configured(state_dir: &Path) -> bool {
    state_dir.join("account.json").is_file()
}

/// Build the Feishu stdio MCP server definition, or an error explaining preflight failure.
pub fn try_build_feishu_mcp_server(feishu: &FeishuChannelConfig) -> Result<acp::McpServer, String> {
    ensure_node_available()?;

    let state_dir = expand_home_path(&feishu.state_dir);
    if !feishu_account_configured(&state_dir) {
        return Err(format!(
            "Feishu channel enabled but no account configured at {}. \
             Run `grok feishu setup` first.",
            state_dir.display()
        ));
    }

    let (command, mut args) = if let Some(cmd) = &feishu.command {
        if cmd.is_empty() {
            return Err("channels.feishu.command is empty".into());
        }
        let mut iter = cmd.iter();
        let command = iter.next().cloned().unwrap();
        let rest: Vec<String> = iter.cloned().collect();
        (command, rest)
    } else {
        let serve = resolve_feishu_serve_mjs()?;
        ("node".to_string(), vec![serve.display().to_string()])
    };

    // Ensure state dir is passed even when using custom command.
    let mut env_map = HashMap::new();
    env_map.insert(
        "FEISHU_STATE_DIR".to_string(),
        state_dir.display().to_string(),
    );

    let env_variables: Vec<acp::EnvVariable> = env_map
        .into_iter()
        .map(|(k, v)| acp::EnvVariable::new(k, v))
        .collect();

    // Custom commands may already include the script path.
    let _ = &mut args;

    Ok(acp::McpServer::Stdio(
        acp::McpServerStdio::new(FEISHU_MCP_SERVER_NAME, PathBuf::from(command))
            .args(args)
            .env(env_variables),
    ))
}

/// If effective channels include `feishu`, try to inject the server into `servers`.
/// Failures are logged and do **not** abort the rest of MCP merge.
pub fn inject_feishu_channel_server(servers: &mut Vec<acp::McpServer>, config: &ChannelsConfig) {
    let effective = resolve_effective_channels_from_env(config);
    if !effective.iter().any(|c| c == "feishu") {
        return;
    }

    // Skip if already present (user configured [mcp_servers.feishu]).
    if servers.iter().any(|s| mcp_name(s) == FEISHU_MCP_SERVER_NAME) {
        tracing::debug!("feishu MCP server already present; skipping channel inject");
        return;
    }

    match try_build_feishu_mcp_server(&config.feishu) {
        Ok(server) => {
            tracing::info!(
                server = FEISHU_MCP_SERVER_NAME,
                "injecting Feishu channel MCP server"
            );
            servers.push(server);
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                "Feishu channel is enabled but could not be started"
            );
            // Also surface to stderr so interactive users see it without log config.
            eprintln!("grok: feishu channel: {e}");
        }
    }
}

fn mcp_name(s: &acp::McpServer) -> &str {
    match s {
        acp::McpServer::Http(h) => h.name.as_str(),
        acp::McpServer::Sse(h) => h.name.as_str(),
        acp::McpServer::Stdio(h) => h.name.as_str(),
        _ => "",
    }
}

/// Gate helper for Task 7+: whether inbound channel notifications should be registered.
pub fn is_feishu_channel_gated_in(
    has_channel_capability: bool,
    effective_channels: &[String],
) -> bool {
    matches!(
        gate_channel_server(
            FEISHU_MCP_SERVER_NAME,
            has_channel_capability,
            effective_channels
        ),
        GateResult::Register
    )
}

/// Whether a server's experimental caps include `claude/channel` (best-effort from JSON).
pub fn experimental_has_channel_cap(experimental: Option<&serde_json::Value>) -> bool {
    experimental
        .and_then(|v| v.get(CAP_CHANNEL))
        .map(|v| !v.is_null() && v.as_bool() != Some(false))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize env mutations across tests in this module.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn resolve_from_env_respects_no_channels() {
        let _g = ENV_LOCK.lock().unwrap();
        // SAFETY: single-threaded under ENV_LOCK for this test module.
        unsafe {
            std::env::set_var(ENV_NO_CHANNELS, "1");
            std::env::remove_var(ENV_CHANNELS);
        }
        let cfg = ChannelsConfig {
            enabled: vec!["feishu".into()],
            ..Default::default()
        };
        assert!(resolve_effective_channels_from_env(&cfg).is_empty());
        unsafe {
            std::env::remove_var(ENV_NO_CHANNELS);
        }
    }

    #[test]
    fn resolve_from_env_cli_list_overrides_config() {
        let _g = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::remove_var(ENV_NO_CHANNELS);
            std::env::set_var(ENV_CHANNELS, "feishu");
        }
        let cfg = ChannelsConfig::default();
        assert_eq!(
            resolve_effective_channels_from_env(&cfg),
            vec!["feishu".to_string()]
        );
        unsafe {
            std::env::remove_var(ENV_CHANNELS);
        }
    }

    #[test]
    fn experimental_cap_detection() {
        let v = serde_json::json!({ "claude/channel": {} });
        assert!(experimental_has_channel_cap(Some(&v)));
        let v2 = serde_json::json!({ "claude/channel": false });
        assert!(!experimental_has_channel_cap(Some(&v2)));
        assert!(!experimental_has_channel_cap(None));
    }

    #[test]
    fn gate_register_when_cap_and_allowlisted() {
        assert!(is_feishu_channel_gated_in(
            true,
            &["feishu".to_string()]
        ));
        assert!(!is_feishu_channel_gated_in(false, &["feishu".to_string()]));
        assert!(!is_feishu_channel_gated_in(true, &[]));
    }
}
