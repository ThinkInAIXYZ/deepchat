//! Cold-profile transfer through the native ownership and Timeline writers.
//! The destination is disposable staging: a failed transfer must never be installed.
use dim_agent_capabilities::{file_storage::FileStorage, methods::RpcError};
use dim_agent_runtime::{TimelineKey, TimelineStore};
use dim_app_server::{
    AgentRecord, AgentRecords,
    storage::{SessionStore, SqliteStorage},
};
use rutis::Ctx;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Transfer {
    source_directory: PathBuf,
    target_directory: PathBuf,
}

pub(crate) async fn transfer(
    ctx: &Ctx,
    files: &Arc<FileStorage>,
    input: Transfer,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    let source = super::archive::root(&input.source_directory).await?;
    let target = super::archive::root(&input.target_directory).await?;
    if source == target {
        return Err(RpcError::invalid(
            "Archive transfer requires separate profiles",
        ));
    }
    let source_root = files
        .register_root(source.clone(), cancel)
        .await
        .map_err(|_| RpcError::invalid("Archive files are unavailable"))?;
    let target_root = files
        .register_root(target.clone(), cancel)
        .await
        .map_err(|_| RpcError::invalid("Target files are unavailable"))?;
    let (source_db, format) = SqliteStorage::open_read_only(source.join("dimcode.sqlite"))?;
    let result = async {
        if format != dim_app_server::storage::STORE_FORMAT {
            return Err(RpcError::invalid("Archive format requires migration"));
        }
        // Native's exclusive lease refuses a live destination. No Agent is restored here.
        let target_db = SqliteStorage::open(target.join("dimcode.sqlite"))?;
        let result = merge(
            ctx,
            files,
            source_db.clone(),
            target_db.clone(),
            source_root,
            target_root,
            cancel,
        )
        .await;
        let closed = target_db.close().await;
        let result = result?;
        closed?;
        Ok(result)
    }
    .await;
    let closed = source_db.close().await;
    let result = result?;
    closed?;
    Ok(result)
}

async fn merge(
    ctx: &Ctx,
    files: &Arc<FileStorage>,
    source_db: Arc<SqliteStorage>,
    target_db: Arc<SqliteStorage>,
    source_root: usize,
    target_root: usize,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    let source_path = files
        .root_path(source_root)
        .map_err(|_| RpcError::invalid("Archive files are unavailable"))?;
    let source_records = AgentRecords(source_db.clone());
    let target_records = AgentRecords(target_db.clone());
    let profiles = source_records.agents().await?;
    let existing_agents = target_records.agents().await?;
    let existing_owners = target_records.owners().await?;
    let mut agents: BTreeSet<String> = existing_agents
        .iter()
        .map(|agent| agent.id.clone())
        .collect();
    let mut sessions: BTreeSet<String> = existing_owners
        .iter()
        .map(|owner| owner.session_id.clone())
        .collect();
    let source = SessionStore::new(source_db, ctx.clone(), source_root);
    let target = SessionStore::new(target_db, ctx.clone(), target_root);
    let mut pending = source_records.owners().await?;
    let mut skipped = Vec::new();
    for owner in &pending {
        if owner.error.is_some() || owner.owner.is_none() {
            return Err(RpcError::invalid("Archive Session ownership is invalid"));
        }
        if let Some(existing) = existing_owners
            .iter()
            .find(|existing| existing.session_id == owner.session_id)
        {
            if existing.error.is_some() || existing.owner != owner.owner {
                return Err(RpcError::invalid(
                    "Archive Session identity conflicts with target ownership",
                ));
            }
            skipped.push(owner.session_id.clone());
        } else if source
            .owned_paths(&owner.session_id)
            .await?
            .iter()
            .any(|path| super::archive_files::managed_id(path, &source_path).is_none())
        {
            // Do not publish a Session whose file ownership has not been transferred.
            return Err(RpcError::invalid(
                "Archive Session requires portable output transfer",
            ));
        }
    }
    for profile in &profiles {
        let value = profile
            .profile
            .as_ref()
            .map_err(|_| RpcError::invalid("Archive Agent profile is invalid"))?;
        if let Some(existing) = existing_agents
            .iter()
            .find(|existing| existing.id == profile.id)
        {
            if existing.profile.as_ref().ok() != Some(value) || existing.owner != profile.owner {
                return Err(RpcError::invalid(
                    "Archive Agent identity conflicts with target profile",
                ));
            }
        }
    }
    pending.retain(|owner| !sessions.contains(&owner.session_id));
    let mut pending_agents: Vec<&AgentRecord> = profiles
        .iter()
        .filter(|profile| !agents.contains(&profile.id))
        .collect();
    let mut has_default = !existing_agents.is_empty();
    let mut imported = Vec::new();
    let mut events = 0u64;
    while !pending.is_empty() || !pending_agents.is_empty() {
        if cancel.is_cancelled() {
            return Err(RpcError::interrupted());
        }
        let before = pending.len() + pending_agents.len();
        let mut index = 0;
        while index < pending_agents.len() {
            let profile = pending_agents[index];
            if profile
                .owner
                .as_ref()
                .is_some_and(|owner| !sessions.contains(owner))
            {
                index += 1;
                continue;
            }
            let default = profile.default && !has_default;
            target_records
                .save(
                    &profile.id,
                    profile
                        .profile
                        .as_ref()
                        .map_err(|_| RpcError::invalid("Invalid Agent profile"))?,
                    default,
                    profile.owner.as_deref(),
                )
                .await?;
            has_default |= default;
            agents.insert(profile.id.clone());
            pending_agents.remove(index);
        }
        let mut index = 0;
        while index < pending.len() {
            let owner = &pending[index];
            let (agent, protocol) = owner.owner.as_ref().expect("validated ownership");
            let (origin, leader) = source.creation_record(&owner.session_id).await?;
            if !agents.contains(agent)
                || leader
                    .as_ref()
                    .is_some_and(|parent| !sessions.contains(parent))
            {
                index += 1;
                continue;
            }
            let config = source
                .timeline_store()
                .session_config(&owner.session_id)
                .await?
                .ok_or_else(|| RpcError::invalid("Archive Session config is absent"))?;
            target
                .create_owned_session(
                    &owner.session_id,
                    &config,
                    agent,
                    *protocol,
                    leader.as_deref(),
                    origin,
                )
                .await?;
            events += copy_timeline(
                source.timeline_store(),
                target.timeline_store(),
                &owner.session_id,
                cancel,
            )
            .await?;
            for path in source.owned_paths(&owner.session_id).await? {
                let id = super::archive_files::managed_id(&path, &source_path)
                    .ok_or_else(|| RpcError::invalid("Archive file ownership is invalid"))?;
                super::archive_files::copy_managed(
                    files,
                    source_root,
                    target_root,
                    &target,
                    &owner.session_id,
                    &id,
                    cancel,
                )
                .await?;
            }
            for grant in source.grants(&owner.session_id).await? {
                target
                    .add_grant(&owner.session_id, grant.path, grant.kind, grant.mode)
                    .await?;
            }
            let title = source
                .metadata(&owner.session_id)
                .await
                .map_err(|_| RpcError::invalid("Archive title is unavailable"))?;
            if let Some(title) = title.title {
                target
                    .set_title(&owner.session_id, 0, Some(title))
                    .await
                    .map_err(|_| RpcError::invalid("Cannot transfer archive title"))?;
            }
            sessions.insert(owner.session_id.clone());
            imported.push(owner.session_id.clone());
            pending.remove(index);
        }
        if before == pending.len() + pending_agents.len() {
            return Err(RpcError::invalid(
                "Archive ownership has missing or cyclic dependencies",
            ));
        }
    }
    Ok(json!({"imported":imported,"skipped":skipped,"events":events.to_string()}))
}

async fn copy_timeline(
    source: Arc<dyn TimelineStore>,
    target: Arc<dyn TimelineStore>,
    session: &str,
    cancel: &CancellationToken,
) -> Result<u64, RpcError> {
    let mut pending = source.branches(session).await?;
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
        let mut after = 0;
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
