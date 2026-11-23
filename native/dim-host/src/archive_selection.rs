//! A portable Session closure, read only through native ownership owners.
use dim_agent_capabilities::methods::RpcError;
use dim_app_server::{AgentRecords, storage::SessionStore};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use tokio_util::sync::CancellationToken;

pub(crate) struct Selection {
    pub sessions: BTreeSet<String>,
    pub agents: BTreeSet<String>,
}
pub(crate) async fn select(
    store: &SessionStore,
    records: &AgentRecords,
    roots: &[String],
    cancel: &CancellationToken,
) -> Result<Selection, RpcError> {
    if roots.is_empty() || roots.len() > 100_000 {
        return Err(RpcError::invalid("Invalid archive Session selection"));
    }
    let owners = records.owners().await?;
    let profiles = records.agents().await?;
    let mut selected = Selection {
        sessions: BTreeSet::new(),
        agents: BTreeSet::new(),
    };
    let mut visited = BTreeMap::new();
    let mut pending: VecDeque<_> = roots.iter().cloned().map(|id| (id, true)).collect();
    // Native's Agent directory always has one default profile, even when the
    // selected Sessions use another Agent. It need not bring unrelated Sessions.
    if let Some(default) = profiles.iter().find(|profile| profile.default) {
        selected.agents.insert(default.id.clone());
        if let Some(parent) = &default.owner {
            pending.push_back((parent.clone(), false));
        }
    }
    while let Some((id, descend)) = pending.pop_front() {
        if cancel.is_cancelled() {
            return Err(RpcError::interrupted());
        }
        if visited
            .get(&id)
            .is_some_and(|previous| *previous || !descend)
        {
            continue;
        }
        visited.insert(id.clone(), descend);
        let owner = owners
            .iter()
            .find(|owner| owner.session_id == id)
            .filter(|owner| owner.error.is_none())
            .and_then(|owner| owner.owner.as_ref())
            .ok_or_else(|| {
                RpcError::invalid("Selected archive Session ownership is unavailable")
            })?;
        let agent = profiles
            .iter()
            .find(|agent| agent.id == owner.0)
            .ok_or_else(|| RpcError::invalid("Selected archive Agent ownership is unavailable"))?;
        selected.sessions.insert(id.clone());
        selected.agents.insert(agent.id.clone());
        // Required ancestors do not pull in their unrelated siblings.
        if let Some(parent) = &agent.owner {
            pending.push_back((parent.clone(), false));
        }
        let (_, leader) = store.creation_record(&id).await?;
        if let Some(leader) = leader {
            pending.push_back((leader, false));
        }
        if descend {
            for child in records.owned_agents(&id).await? {
                selected.agents.insert(child.clone());
                for member in records.member_sessions(&child).await? {
                    pending.push_back((member, true));
                }
            }
            for member in records.led_members(&id).await? {
                pending.push_back((member, true));
            }
        }
    }
    Ok(selected)
}
