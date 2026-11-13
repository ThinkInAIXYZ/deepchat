//! Bounded reads and non-context facts owned by the DeepChat plugins.
use dim_agent_capabilities::methods::RpcError;
use dim_agent_runtime::{QueryOutput, Timeline, TimelineQuery};
use dim_agent_types::{AgentEvent, EventKind, ExtensionEvent};
use serde_json::{Value, json};
use std::sync::Arc;
pub(crate) fn field(path: &str) -> Value {
    json!({"kind":"field", "path":path})
}
pub(crate) fn equal(path: &str, value: Value) -> Value {
    json!({"op":"compare", "left":field(path), "comparison":"eq", "right":{"kind":"value","value":value}})
}
pub(crate) fn one_of(path: &str, values: Value) -> Value {
    json!({"op":"in","value":field(path),"values":values})
}
pub(crate) fn and(conditions: Vec<Value>) -> Value {
    json!({"op":"and","conditions":conditions})
}
pub(crate) async fn events(
    timeline: &Timeline,
    filter: Value,
) -> Result<Vec<Arc<AgentEvent>>, RpcError> {
    let mut query: TimelineQuery = serde_json::from_value(json!({
        "scope":"branch", "through":timeline.committed(), "include_publishing":true,
        "query":{"filter":filter,"select":{"kind":"events"}}, "page":{"limit":128}
    }))
    .map_err(|_| RpcError::invalid("Invalid product fact query"))?;
    let mut found = Vec::new();
    loop {
        let page = timeline.query(query.clone()).await?;
        let QueryOutput::Events { events } = page.result else {
            return Err(RpcError::invalid(
                "Product fact query did not return events",
            ));
        };
        found.extend(events.into_iter().map(|entry| entry.event));
        if found.len() > 4096 {
            return Err(RpcError::invalid("Product fact read exceeds its bound"));
        }
        let Some(next) = page.next else {
            break;
        };
        query.page.as_mut().expect("paged queue query").after = Some(next);
    }
    Ok(found)
}
pub(crate) fn extension(name: &str) -> Value {
    equal("kind", json!(format!("deepchat/{name}")))
}
pub(crate) fn append(timeline: &Timeline, name: &str, data: Value) -> Result<(), RpcError> {
    timeline.append(
        EventKind::Extension(
            ExtensionEvent::new("deepchat", name, data).map_err(RpcError::invalid)?,
        )
        .into(),
    )?;
    Ok(())
}

/// Timeline.append allocates a fact before its store publishes it. A durable product receipt
/// must cross this owner barrier before desktop may discard caches or change generation.
pub(crate) async fn published(timeline: &Timeline, through: u64) -> Result<(), RpcError> {
    let mut changed = timeline.watch();
    loop {
        if timeline.sequence() >= through { return Ok(()); }
        if let Some(error) = timeline.failure() { return Err(error.into()); }
        let closed = changed.borrow().1;
        if closed || changed.changed().await.is_err() {
            return Err(RpcError::service("storage_failed", "Timeline closed before publishing the product receipt"));
        }
    }
}
