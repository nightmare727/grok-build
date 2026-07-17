//! Decide whether a connected MCP server should be registered as a channel.

/// Why a channel server was not registered for the current session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateSkipKind {
    /// Server did not advertise the channel capability.
    Capability,
    /// Server name is not on the session allowlist.
    Session,
}

/// Result of gating an MCP server for channel host registration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateResult {
    /// Register inbound channel handlers for this server.
    Register,
    /// Do not register; see `kind` / `reason` for diagnostics.
    Skip { kind: GateSkipKind, reason: String },
}

/// Gate whether `server_name` should be treated as an active channel server.
///
/// Rules (v1):
/// 1. Skip Capability if `!has_channel_capability`.
/// 2. Skip Session if `server_name` is not an exact match in `allowed_channels`.
/// 3. Otherwise Register.
///
/// Capability is a simple bool for v1; full MCP experimental caps can be
/// resolved by the caller before invoking this.
pub fn gate_channel_server(
    server_name: &str,
    has_channel_capability: bool,
    allowed_channels: &[impl AsRef<str>],
) -> GateResult {
    if !has_channel_capability {
        return GateResult::Skip {
            kind: GateSkipKind::Capability,
            reason: format!(
                "server `{server_name}` missing experimental capability `{}`",
                crate::CAP_CHANNEL
            ),
        };
    }

    let allowed = allowed_channels
        .iter()
        .any(|name| name.as_ref() == server_name);
    if !allowed {
        return GateResult::Skip {
            kind: GateSkipKind::Session,
            reason: format!("server `{server_name}` not in session channel allowlist"),
        };
    }

    GateResult::Register
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate_requires_capability_and_allowlist() {
        assert!(matches!(
            gate_channel_server("feishu", true, &["feishu"]),
            GateResult::Register
        ));
        assert!(matches!(
            gate_channel_server("feishu", true, &[] as &[&str]),
            GateResult::Skip {
                kind: GateSkipKind::Session,
                ..
            }
        ));
        assert!(matches!(
            gate_channel_server("feishu", false, &["feishu"]),
            GateResult::Skip {
                kind: GateSkipKind::Capability,
                ..
            }
        ));
    }

    #[test]
    fn gate_uses_exact_name_match() {
        assert!(matches!(
            gate_channel_server("feishu", true, &["Feishu"]),
            GateResult::Skip {
                kind: GateSkipKind::Session,
                ..
            }
        ));
        assert!(matches!(
            gate_channel_server("feishu", true, &["plugin:feishu:feishu"]),
            GateResult::Skip {
                kind: GateSkipKind::Session,
                ..
            }
        ));
        assert!(matches!(
            gate_channel_server("feishu", true, &["slack", "feishu"]),
            GateResult::Register
        ));
    }

    #[test]
    fn capability_checked_before_allowlist() {
        // Missing capability wins even if also not allowlisted.
        assert!(matches!(
            gate_channel_server("feishu", false, &[] as &[&str]),
            GateResult::Skip {
                kind: GateSkipKind::Capability,
                ..
            }
        ));
    }

    #[test]
    fn accepts_string_allowlist_slices() {
        let allowed = vec!["feishu".to_string()];
        assert!(matches!(
            gate_channel_server("feishu", true, &allowed),
            GateResult::Register
        ));
    }
}
