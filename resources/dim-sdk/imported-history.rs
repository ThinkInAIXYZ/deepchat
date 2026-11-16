/// Validated historical messages are context data, never ToolExecutor submissions.
/// A whole call/result group shares one source event so compaction cannot split it.
pub fn validate_imported_messages(messages: &[Message]) -> Result<(), String> {
    let mut calls = std::collections::BTreeSet::new();
    let mut pending = std::collections::BTreeSet::new();
    for message in messages {
        match (&message.role, &message.content) {
            (Role::User, MessageContent::Text(_)) | (Role::Assistant, MessageContent::Text(_))
                if pending.is_empty() => {}
            (_, MessageContent::Parts(parts)) if !parts.is_empty() => {
                if message.role != Role::ToolResult && !pending.is_empty() {
                    return Err("Imported tool calls must close before the next message".into());
                }
                for part in parts {
                    match (message.role, part) {
                        (Role::User, MessagePart::Text { .. } | MessagePart::Image { .. })
                        | (Role::Assistant, MessagePart::Text { .. }) => {}
                        (Role::Assistant, MessagePart::ToolUse { id, name, .. })
                            if !id.is_empty() && !name.is_empty() && calls.insert(id.clone()) =>
                        {
                            pending.insert(id.clone());
                        }
                        (Role::ToolResult, MessagePart::ToolResult { tool_use_id, .. })
                            if pending.remove(tool_use_id) => {}
                        _ => return Err("Invalid imported role, content or tool pairing".into()),
                    }
                }
            }
            _ => return Err("Invalid imported history message".into()),
        }
    }
    if messages.is_empty() || !pending.is_empty() {
        return Err("Imported history must contain complete tool pairs".into());
    }
    Ok(())
}

fn imported_messages(extension: &ExtensionEvent) -> Result<Vec<Message>, String> {
    let messages: Vec<Message> = serde_json::from_value(extension.data()["messages"].clone())
        .map_err(|_| "Invalid imported history payload".to_owned())?;
    validate_imported_messages(&messages)?;
    Ok(messages)
}
