//! Wrap inbound channel content in a model-visible `<channel>` tag.

/// Meta attribute names must match this pattern (safe XML attribute names).
fn is_safe_meta_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Escape characters that are unsafe inside double-quoted XML attributes.
fn escape_xml_attr(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '<' => out.push_str("&lt;"),
            _ => out.push(c),
        }
    }
    out
}

/// Wrap channel content for the model, CCB-compatible:
///
/// ```xml
/// <channel source="feishu" chat_id="...">
/// content
/// </channel>
/// ```
///
/// - `source` is always included as an attribute.
/// - Only meta keys matching `^[a-zA-Z_][a-zA-Z0-9_]*$` are included.
/// - Attribute values escape `"`, `&`, and `<`.
pub fn wrap_channel_message(source: &str, content: &str, meta: &[(&str, &str)]) -> String {
    let mut out = String::from("<channel source=\"");
    out.push_str(&escape_xml_attr(source));
    out.push('"');

    for (key, value) in meta {
        if !is_safe_meta_key(key) {
            continue;
        }
        out.push(' ');
        out.push_str(key);
        out.push_str("=\"");
        out.push_str(&escape_xml_attr(value));
        out.push('"');
    }

    out.push_str(">\n");
    out.push_str(content);
    out.push_str("\n</channel>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn rejects_meta_keys_that_start_with_digit_or_use_hyphen() {
        let out = wrap_channel_message(
            "feishu",
            "body",
            &[("1bad", "x"), ("also-bad", "y"), ("_ok", "z")],
        );
        assert!(!out.contains("1bad"));
        assert!(!out.contains("also-bad"));
        assert!(out.contains(r#"_ok="z""#));
    }

    #[test]
    fn escapes_xml_specials_in_attribute_values() {
        let out = wrap_channel_message(r#"feishu"&<"#, "content", &[("chat_id", r#"oc_"1&2<3"#)]);
        assert!(out.contains(r#"source="feishu&quot;&amp;&lt;""#));
        assert!(out.contains(r#"chat_id="oc_&quot;1&amp;2&lt;3""#));
        // Unescaped forms must not appear inside the opening tag attributes.
        let open_end = out.find('>').expect("opening tag");
        let open = &out[..open_end];
        assert!(!open.contains(r#"source="feishu""#));
    }

    #[test]
    fn source_only_when_meta_empty_or_all_unsafe() {
        let out = wrap_channel_message("feishu", "hi", &[("bad key", "x")]);
        assert_eq!(out, "<channel source=\"feishu\">\nhi\n</channel>");
    }
}
