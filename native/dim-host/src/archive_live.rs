//! Export only a stable, settled ownership closure; unrelated Sessions remain live.
use crate::facts::{and, equal, field, one_of};
use dim_agent_capabilities::methods::RpcError;
use dim_agent_runtime::{
    QueryOutput, QueryPage, QuerySpec, TimelineKey, TimelineReadScope, TimelineReadSegment,
};
use dim_app_server::{AgentIndex, AgentRecords, storage::SessionStore};
use rutis::Ctx;
use serde_json::json;
use std::{collections::BTreeMap, num::NonZeroU64};
use tokio_util::sync::CancellationToken;

pub(crate) fn busy() -> RpcError {
    RpcError::service("daemon_busy", "Selected Native Sessions are not settled")
}

pub(crate) async fn heads(
    ctx: &Ctx,
    store: &SessionStore,
    records: &AgentRecords,
    roots: &[String],
    cancel: &CancellationToken,
) -> Result<BTreeMap<(String, String), u64>, RpcError> {
    let selected = super::archive_selection::select(store, records, roots, cancel).await?;
    let agents = ctx.get::<AgentIndex>().ok_or_else(busy)?;
    if agents
        .hosts()
        .iter()
        .flat_map(|host| host.agent.sessions())
        .any(|session| selected.sessions.contains(session.id()) && session.in_use().is_some())
    {
        return Err(busy());
    }
    let pending = and(vec![
        equal("kind", json!("input/message")),
        json!({"op":"or", "conditions":[
            one_of("data.mode", json!(["queue","steer"])),
            and(vec![
                json!({"op":"not","condition":{"op":"present","value":field("data.mode")}}),
                json!({"op":"present","value":field("data.user")})
            ])
        ]}),
        json!({"op":"not","condition":{"op":"present","value":field("data.handover")}}),
        json!({"op":"not","condition":{"op":"exists","condition":and(vec![
            one_of("kind", json!(["input/consumed","input/deleted"])),
            json!({"op":"compare","left":field("data.input_id"),"comparison":"eq","right":{"kind":"outer","path":"id"}})
        ])}}),
    ]);
    let query: QuerySpec =
        serde_json::from_value(json!({"filter":pending,"select":{"kind":"events"}}))
            .map_err(|_| RpcError::invalid("Invalid Native export readiness query"))?;
    let page = QueryPage {
        limit: NonZeroU64::new(1).expect("one event"),
        after: None,
    };
    let timeline = store.timeline_store();
    let mut heads = BTreeMap::new();
    for session in selected.sessions {
        if cancel.is_cancelled() {
            return Err(RpcError::interrupted());
        }
        for branch in timeline.branches(&session).await? {
            let key = TimelineKey {
                session_id: session.clone(),
                branch_id: branch.info.id.clone(),
            };
            if branch.sequence > 0 {
                let scope = TimelineReadScope {
                    key: key.clone(),
                    through: branch.sequence,
                    segments: vec![TimelineReadSegment {
                        branch_id: key.branch_id.clone(),
                        from: 1,
                        through: branch.sequence,
                        stored_through: branch.sequence,
                        tail: vec![],
                    }],
                };
                let found = timeline.query(&scope, &query, Some(&page)).await?;
                match found.result {
                    QueryOutput::Events { events } if events.is_empty() => {}
                    QueryOutput::Events { .. } => return Err(busy()),
                    _ => return Err(RpcError::invalid("Invalid Native readiness result")),
                }
            }
            heads.insert((session.clone(), key.branch_id), branch.sequence);
        }
    }
    Ok(heads)
}
