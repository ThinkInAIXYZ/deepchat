//! Replace only a cold staging profile's selected Session ownership closure.
//! Paths must already have been rebased into staging before deletion is admitted.
use dim_agent_capabilities::{file_storage::FileStorage, methods::RpcError};
use dim_app_server::{
    AgentRecords,
    storage::{SessionStore, SqliteStorage},
};
use rutis::Ctx;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::Path};
use std::{path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Prune {
    directory: PathBuf,
    session_ids: Vec<String>,
}

pub(crate) async fn replace(
    ctx: &Ctx,
    files: &Arc<FileStorage>,
    input: Prune,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    let root = super::archive::root(&input.directory).await?;
    // An explicit private dim home is required before any physical output deletion.
    super::archive_rebase::installed_home(&input.directory).await?;
    let root_index = files
        .register_root(root.clone(), cancel)
        .await
        .map_err(|_| RpcError::invalid("Replacement files are unavailable"))?;
    let db = SqliteStorage::open(root.join("dimcode.sqlite"))?;
    let store = SessionStore::new(db.clone(), ctx.clone(), root_index);
    let result = prune(
        &store,
        &AgentRecords(db.clone()),
        &root,
        &input.session_ids,
        cancel,
    )
    .await;
    let closed = db.close().await;
    result?;
    closed?;
    Ok(json!({"replaced": true}))
}

pub(crate) async fn prune(
    store: &SessionStore,
    records: &AgentRecords,
    root: &Path,
    roots: &[String],
    cancel: &CancellationToken,
) -> Result<(), RpcError> {
    if roots.len() > 100_000 {
        return Err(RpcError::invalid("Invalid replacement selection"));
    }
    let home = root
        .parent()
        .and_then(Path::to_str)
        .ok_or_else(|| RpcError::invalid("Invalid staging home"))?;
    let owners = records.owners().await?;
    let mut active = BTreeSet::new();
    let mut complete = BTreeSet::new();
    let mut ordered = Vec::new();
    let mut pending: Vec<_> = roots.iter().cloned().map(|id| (id, false)).collect();
    while let Some((id, ready)) = pending.pop() {
        if cancel.is_cancelled() {
            return Err(RpcError::interrupted());
        }
        if complete.contains(&id) {
            continue;
        }
        let Some(owner) = owners.iter().find(|owner| owner.session_id == id) else {
            continue;
        };
        if owner.error.is_some() || owner.owner.is_none() {
            return Err(RpcError::invalid(
                "Replacement Session ownership is invalid",
            ));
        }
        if ready {
            active.remove(&id);
            complete.insert(id.clone());
            ordered.push(id);
            continue;
        }
        if !active.insert(id.clone()) || active.len() + complete.len() > 100_000 {
            return Err(RpcError::invalid(
                "Replacement ownership ancestry is invalid",
            ));
        }
        pending.push((id.clone(), true));
        let mut children = records.led_members(&id).await?;
        for agent in records.owned_agents(&id).await? {
            children.extend(records.member_sessions(&agent).await?);
        }
        children.sort();
        children.dedup();
        pending.extend(children.into_iter().map(|child| (child, false)));
    }
    // Validate the entire deletion closure before touching any physical output.
    // A copied ownership row must never authorize deleting an original profile.
    for id in &ordered {
        for path in store.owned_paths(id).await? {
            if super::archive_files::managed_id(&path, root).is_none()
                && super::archive_outputs::relative(&path, home)?.is_none()
            {
                return Err(RpcError::invalid(
                    "Replacement outputs must be rebased into staging",
                ));
            }
        }
    }
    let profiles = records.agents().await?;
    for id in ordered {
        if cancel.is_cancelled() {
            return Err(RpcError::interrupted());
        }
        for agent in records.owned_agents(&id).await? {
            if profiles
                .iter()
                .any(|profile| profile.id == agent && profile.default)
            {
                return Err(RpcError::invalid(
                    "Replacement cannot remove the default Agent",
                ));
            }
            records.delete(&agent).await?;
        }
        store.delete_session(&id).await?;
    }
    Ok(())
}
