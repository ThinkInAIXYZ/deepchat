//! Cold-profile transfer through the native ownership and Timeline writers.
//! The destination is disposable staging: a failed transfer must never be installed.
use dim_agent_capabilities::{file_storage::FileStorage, methods::RpcError};
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
    source_home: Option<String>,
    installed_directory: Option<PathBuf>,
    session_ids: Option<Vec<String>>,
    #[serde(default)]
    initialize_target: bool,
}

pub(crate) async fn transfer(
    ctx: &Ctx,
    files: &Arc<FileStorage>,
    input: Transfer,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    let source = super::archive::root(&input.source_directory).await?;
    let target = target_root(&input.target_directory, input.initialize_target).await?;
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
    let installed_directory = match input.installed_directory.as_deref() {
        Some(directory) => Some(super::archive_rebase::installed_home(directory).await?),
        None => None,
    };
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
            input.source_home.as_deref(),
            installed_directory.as_deref(),
            input.session_ids.as_deref(),
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

async fn target_root(directory: &std::path::Path, initialize: bool) -> Result<PathBuf, RpcError> {
    if initialize {
        if !directory.is_absolute() {
            return Err(RpcError::invalid("Archive requires an absolute directory"));
        }
        let root = tokio::fs::canonicalize(directory.join("rust"))
            .await
            .map_err(|_| RpcError::invalid("Native archive directory is unavailable"))?;
        match tokio::fs::symlink_metadata(root.join("dimcode.sqlite")).await {
            Ok(_) => super::archive::root(directory).await,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(root),
            Err(_) => return Err(RpcError::invalid("Native archive database is unavailable")),
        }
    } else {
        super::archive::root(directory).await
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Export {
    target_directory: PathBuf,
    session_ids: Vec<String>,
}

pub(crate) async fn export(
    ctx: &Ctx,
    files: &Arc<FileStorage>,
    source_db: Arc<SqliteStorage>,
    input: Export,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    // The assembly sets PAYLOAD_ROOT from this server's --home. The supplied
    // SqliteStorage is the same live owner, not another connection to its file.
    let source = crate::PAYLOAD_ROOT
        .get()
        .and_then(|path| path.parent())
        .ok_or_else(|| RpcError::invalid("Native profile home is unavailable"))?;
    let source = tokio::fs::canonicalize(source)
        .await
        .map_err(|_| RpcError::invalid("Native profile home is unavailable"))?;
    let source_home = source
        .parent()
        .and_then(|path| path.to_str())
        .ok_or_else(|| RpcError::invalid("Native profile home is unavailable"))?;
    let target = target_root(&input.target_directory, true).await?;
    if source == target {
        return Err(RpcError::invalid("Export requires a separate profile"));
    }
    let source_root = files
        .register_root(source.clone(), cancel)
        .await
        .map_err(|_| RpcError::invalid("Native export files are unavailable"))?;
    let target_root = files
        .register_root(target.clone(), cancel)
        .await
        .map_err(|_| RpcError::invalid("Native export target is unavailable"))?;
    let installed = super::archive_rebase::installed_home(&input.target_directory).await?;
    let target_db = SqliteStorage::open(target.join("dimcode.sqlite"))?;
    let result = merge(
        ctx,
        files,
        source_db,
        target_db.clone(),
        source_root,
        target_root,
        Some(source_home),
        Some(&installed),
        Some(&input.session_ids),
        cancel,
    )
    .await;
    let closed = target_db.close().await;
    let result = result?;
    closed?;
    // The live source owner stays open; only the disposable target is ours.
    Ok(result)
}

async fn merge(
    ctx: &Ctx,
    files: &Arc<FileStorage>,
    source_db: Arc<SqliteStorage>,
    target_db: Arc<SqliteStorage>,
    source_root: usize,
    target_root: usize,
    source_home: Option<&str>,
    installed_directory: Option<&std::path::Path>,
    session_ids: Option<&[String]>,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    let source_path = files
        .root_path(source_root)
        .map_err(|_| RpcError::invalid("Archive files are unavailable"))?;
    let source_records = AgentRecords(source_db.clone());
    let target_records = AgentRecords(target_db.clone());
    let mut profiles = source_records.agents().await?;
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
    if let Some(roots) = session_ids {
        let selected =
            super::archive_selection::select(&source, &source_records, roots, cancel).await?;
        pending.retain(|owner| selected.sessions.contains(&owner.session_id));
        profiles.retain(|profile| selected.agents.contains(&profile.id));
    }
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
        } else {
            for path in source.owned_paths(&owner.session_id).await? {
                if super::archive_files::managed_id(&path, &source_path).is_none() {
                    let home = source_home.ok_or_else(|| {
                        RpcError::invalid(
                            "Native output transfer requires the original profile directory",
                        )
                    })?;
                    if !installed_directory.is_some_and(|directory| directory.is_absolute()) {
                        return Err(RpcError::invalid(
                            "Native output transfer requires the installed profile directory",
                        ));
                    }
                    super::archive_outputs::relative(&path, home)?;
                }
            }
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
            events += super::archive_timeline::copy(
                source.timeline_store(),
                target.timeline_store(),
                &owner.session_id,
                cancel,
            )
            .await?;
            copy_assets(
                files,
                &source,
                &target,
                source_root,
                target_root,
                &source_path,
                source_home,
                installed_directory,
                &owner.session_id,
                cancel,
            )
            .await?;
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
    for session in &skipped {
        let incoming = source.timeline_store().session_config(session).await?;
        let existing = target.timeline_store().session_config(session).await?;
        if serde_json::to_value(&incoming)
            .map_err(|_| RpcError::invalid("Invalid source config"))?
            != serde_json::to_value(&existing)
                .map_err(|_| RpcError::invalid("Invalid target config"))?
            || source.creation_record(session).await? != target.creation_record(session).await?
        {
            return Err(RpcError::invalid(
                "Native Session creation identity conflicts",
            ));
        }
        events += super::archive_timeline::copy(
            source.timeline_store(),
            target.timeline_store(),
            session,
            cancel,
        )
        .await?;
        copy_assets(
            files,
            &source,
            &target,
            source_root,
            target_root,
            &source_path,
            source_home,
            installed_directory,
            session,
            cancel,
        )
        .await?;
    }
    Ok(json!({"imported":imported,"skipped":skipped,"events":events.to_string()}))
}

async fn copy_assets(
    files: &Arc<FileStorage>,
    source: &SessionStore,
    target: &SessionStore,
    source_root: usize,
    target_root: usize,
    source_path: &std::path::Path,
    source_home: Option<&str>,
    installed_directory: Option<&std::path::Path>,
    session: &str,
    cancel: &CancellationToken,
) -> Result<(), RpcError> {
    for path in source.owned_paths(session).await? {
        if let Some(id) = super::archive_files::managed_id(&path, &source_path) {
            super::archive_files::copy_managed(
                files,
                source_root,
                target_root,
                &target,
                session,
                &id,
                cancel,
            )
            .await?;
        } else if let Some(relative) = super::archive_outputs::relative(
            &path,
            source_home.ok_or_else(|| {
                RpcError::invalid("Native output transfer requires the original profile directory")
            })?,
        )? {
            super::archive_outputs::copy(
                files,
                source_root,
                target_root,
                &installed_directory
                    .ok_or_else(|| {
                        RpcError::invalid(
                            "Native output transfer requires the installed profile directory",
                        )
                    })?
                    .join("rust"),
                &target,
                session,
                &relative,
                cancel,
            )
            .await?;
        } else {
            target.register(session, path).await?;
        }
    }
    for grant in source.grants(session).await? {
        let path = if let (Some(home), Some(installed)) = (source_home, installed_directory) {
            super::archive_outputs::within_home(&grant.path, home)?
                .map(|relative| installed.join("rust").join(relative))
                .unwrap_or(grant.path)
        } else {
            grant.path
        };
        target
            .add_grant(session, path, grant.kind, grant.mode)
            .await?;
    }
    Ok(())
}
