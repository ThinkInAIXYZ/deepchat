//! Preserve immutable history: only a compatible source tail may be appended.
use dim_agent_capabilities::methods::RpcError;
use dim_agent_runtime::{TimelineKey, TimelineStore};
use std::{collections::BTreeSet, sync::Arc};
use tokio_util::sync::CancellationToken;

pub(crate) async fn copy(
    source: Arc<dyn TimelineStore>,
    target: Arc<dyn TimelineStore>,
    session: &str,
    cancel: &CancellationToken,
) -> Result<u64, RpcError> {
    let mut pending = source.branches(session).await?;
    let existing = target.branches(session).await?;
    let mut copied = BTreeSet::new();
    let mut events = 0;
    while !pending.is_empty() {
        let index = pending
            .iter()
            .position(|branch| {
                branch
                    .info
                    .parent
                    .as_ref()
                    .is_none_or(|parent| copied.contains(parent))
            })
            .ok_or_else(|| RpcError::invalid("Archive branch ancestry is invalid"))?;
        let branch = pending.remove(index);
        let key = TimelineKey {
            session_id: session.into(),
            branch_id: branch.info.id.clone(),
        };
        if existing
            .iter()
            .any(|stored| stored.info.id == branch.info.id && stored.info != branch.info)
        {
            return Err(RpcError::invalid(
                "Native history has conflicting branch ancestry",
            ));
        }
        // Parent publication creates new child directories. A missing head here is
        // invalid ancestry; the native writer remains the only branch owner.
        let target_head = target.head(&key).await?;
        let shared = target_head.min(branch.sequence);
        source.batch_end(&key, shared).await?;
        target.batch_end(&key, shared).await?;
        let mut checked = 0;
        while checked < shared {
            if cancel.is_cancelled() {
                return Err(RpcError::interrupted());
            }
            let page = source.read_page(&key, checked, 128, shared).await?;
            let end = page
                .last()
                .ok_or_else(|| RpcError::invalid("Archive Timeline prefix is incomplete"))?
                .batch_end;
            let local = target.read(&key, checked + 1..=end).await?;
            if page.len() != local.len() {
                return Err(RpcError::invalid(
                    "Native histories diverged; incremental import cannot combine them",
                ));
            }
            for (incoming, stored) in page.iter().zip(&local) {
                let trace = serde_json::to_value(&incoming.trace)
                    .map_err(|_| RpcError::invalid("Archive Timeline trace is invalid"))?;
                let stored_trace = serde_json::to_value(&stored.trace)
                    .map_err(|_| RpcError::invalid("Target Timeline trace is invalid"))?;
                if incoming.event != stored.event
                    || incoming.batch_end != stored.batch_end
                    || trace != stored_trace
                {
                    return Err(RpcError::invalid(
                        "Native histories diverged; incremental import cannot combine them",
                    ));
                }
            }
            checked = end;
        }
        let mut after = target_head;
        while after < branch.sequence {
            if cancel.is_cancelled() {
                return Err(RpcError::interrupted());
            }
            let page = source.read_page(&key, after, 128, branch.sequence).await?;
            if page.is_empty() {
                return Err(RpcError::invalid("Archive Timeline page is incomplete"));
            }
            let mut records = page.into_iter().peekable();
            while let Some(first) = records.next() {
                let end = first.batch_end;
                let mut batch = vec![first];
                while records.peek().is_some_and(|record| record.batch_end == end) {
                    batch.push(records.next().expect("peeked record"));
                }
                if batch
                    .last()
                    .is_none_or(|record| record.event.sequence != end)
                {
                    return Err(RpcError::invalid("Archive Timeline batch is incomplete"));
                }
                events += batch.len() as u64;
                let (done, settled) = tokio::sync::oneshot::channel();
                target.append(
                    key.clone(),
                    batch,
                    Box::new(move |result| {
                        let _ = done.send(result);
                    }),
                )?;
                settled
                    .await
                    .map_err(|_| RpcError::invalid("Archive Timeline writer stopped"))??;
                after = end;
            }
        }
        copied.insert(branch.info.id);
    }
    Ok(events)
}
