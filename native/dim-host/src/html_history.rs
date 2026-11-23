use dim_agent_types::{Message, MessageContent, MessagePart, ModelRequest, Role, ToolContent};
use std::{collections::HashMap, sync::Arc};

fn parts(message: &Message) -> &[MessagePart] {
    match &message.content {
        MessageContent::Parts(parts) => parts,
        MessageContent::Text(_) => &[],
    }
}

/// Keep the original timeline for rendering and recovery. Only settled HTML calls
/// become receipts in provider requests, after the other results in their batch.
pub(crate) fn prepare(request: &ModelRequest) -> Option<ModelRequest> {
    let mut messages = Vec::new();
    let mut changed = false;
    let mut remaining = request.messages.as_slice();
    while let Some(first) = remaining.first() {
        if first.role != Role::Assistant {
            messages.push(Arc::clone(first));
            remaining = &remaining[1..];
            continue;
        }
        let assistant_end = prefix(remaining, Role::Assistant);
        let (assistant, tail) = remaining.split_at(assistant_end);
        let (results, tail) = tail.split_at(prefix(tail, Role::ToolResult));
        if let Some(batch) = project_batch(assistant, results) {
            messages.extend(batch);
            changed = true;
        } else {
            messages.extend_from_slice(assistant);
            messages.extend_from_slice(results);
        }
        remaining = tail;
    }
    changed.then(|| ModelRequest {
        messages,
        ..request.clone()
    })
}

fn prefix(messages: &[Arc<Message>], role: Role) -> usize {
    messages
        .iter()
        .take_while(|message| message.role == role)
        .count()
}

fn project_batch(
    assistant: &[Arc<Message>],
    results: &[Arc<Message>],
) -> Option<Vec<Arc<Message>>> {
    let calls = assistant.iter().flat_map(|message| parts(message));
    let results_by_id = results
        .iter()
        .flat_map(|message| parts(message))
        .filter_map(|part| {
            if let MessagePart::ToolResult {
                tool_use_id,
                content,
                is_error,
                ..
            } = part
            {
                Some((tool_use_id.as_str(), (content, *is_error == Some(true))))
            } else {
                None
            }
        })
        .collect::<HashMap<_, _>>();
    let mut receipts = Vec::new();
    let mut consumed = std::collections::HashSet::new();
    for part in calls {
        let MessagePart::ToolUse {
            id, name, input, ..
        } = part
        else {
            continue;
        };
        let (content, is_error) = results_by_id.get(id.as_str())?;
        let fields: &[&str] = match name.as_str() {
            "html_render" => &["title"],
            "html_render_section" => &["panelId", "sectionId"],
            _ => continue,
        };
        let ToolContent::Text(text) = content else {
            continue;
        };
        let receipt = if *is_error || text.starts_with("Error:") {
            let target = fields
                .iter()
                .filter_map(|field| {
                    let value = input.get(*field)?.as_str()?;
                    (!value.is_empty()).then(|| format!("{field}: {value}"))
                })
                .collect::<Vec<_>>()
                .join("; ");
            let target = if target.is_empty() {
                format!("toolCallId: {id}")
            } else {
                target
            };
            format!("{name} failed. {target}\n{text}")
        } else {
            text.clone()
        };
        consumed.insert(id.as_str());
        receipts.push(Arc::new(Message::text(Role::User, receipt)));
    }
    if receipts.is_empty() {
        return None;
    }
    let mut projected = Vec::new();
    for message in assistant.iter().chain(results) {
        let removes = |part: &MessagePart| match part {
            MessagePart::ToolUse { id, .. } => consumed.contains(id.as_str()),
            MessagePart::ToolResult { tool_use_id, .. } => consumed.contains(tool_use_id.as_str()),
            _ => false,
        };
        let original = parts(message);
        if original.iter().any(removes) {
            let kept = original
                .iter()
                .filter(|part| !removes(part))
                .cloned()
                .collect::<Vec<_>>();
            if !kept.is_empty() {
                projected.push(Arc::new(Message {
                    role: message.role,
                    content: MessageContent::Parts(kept),
                }));
            }
        } else {
            projected.push(Arc::clone(message));
        }
    }
    projected.extend(receipts);
    Some(projected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn projects_completed_html_without_interrupting_other_tool_pairs() {
        let messages: Vec<Message> = serde_json::from_value(json!([
            {"role":"assistant", "content":[
                {"type":"tool_use", "id":"section", "name":"html_render_section",
                 "input":{"panelId":"p1", "sectionId":"chart", "html":"<p>Original HTML</p>"}},
                {"type":"tool_use", "id":"read", "name":"read", "input":{"path":"notes.txt"}}
            ]},
            {"role":"tool_result", "content":[
                {"type":"tool_result", "tool_use_id":"section", "content":"Invalid section", "is_error":true}
            ]},
            {"role":"tool_result", "content":[
                {"type":"tool_result", "tool_use_id":"read", "content":"Notes"}
            ]}
        ])).unwrap();
        let pending = ModelRequest::new("fixture", "chat", messages[..2].to_vec());
        assert!(prepare(&pending).is_none());
        let request = ModelRequest::new("fixture", "chat", messages);
        let projected = prepare(&request).unwrap();
        assert_eq!(
            parts(&projected.messages[0]),
            &parts(&request.messages[0])[1..]
        );
        assert_eq!(projected.messages[1], request.messages[2]);
        assert_eq!(
            *projected.messages[2],
            Message::text(
                Role::User,
                "html_render_section failed. panelId: p1; sectionId: chart\nInvalid section"
            )
        );
        assert!(prepare(&projected).is_none());
    }
}
