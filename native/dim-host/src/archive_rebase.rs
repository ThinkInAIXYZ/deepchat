//! Rebase native output ownership in a disposable, exclusively leased restore.
//! Immutable Timeline facts and original filesystem paths are never modified.
use dim_agent_capabilities::{file_storage::FileStorage, methods::RpcError};
use dim_app_server::{
    AgentRecords,
    storage::{SessionStore, SqliteStorage},
};
use rutis::Ctx;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Rebase {
    directory: PathBuf,
    source_home: Option<String>,
    installed_directory: PathBuf,
}

pub(crate) async fn rebase(
    ctx: &Ctx,
    files: &Arc<FileStorage>,
    input: Rebase,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    let installed_home = installed_home(&input.installed_directory).await?;
    let root = super::archive::root(&input.directory).await?;
    let root_index = files
        .register_root(root.clone(), cancel)
        .await
        .map_err(|_| RpcError::invalid("Restore files are unavailable"))?;
    let db = SqliteStorage::open(root.join("dimcode.sqlite"))?;
    let result = async {
        let store = SessionStore::new(db.clone(), ctx.clone(), root_index);
        let owners = AgentRecords(db.clone()).owners().await?;
        let mut outputs = 0;
        let mut grants = 0;
        let source = input
            .source_home
            .as_deref()
            .unwrap_or_else(|| installed_home.to_str().unwrap_or(""));
        for owner in &owners {
            if cancel.is_cancelled() {
                return Err(RpcError::interrupted());
            }
            if owner.error.is_some() || owner.owner.is_none() {
                return Err(RpcError::invalid("Restore Session ownership is invalid"));
            }
            for path in store.owned_paths(&owner.session_id).await? {
                if super::archive_files::managed_id(&path, &root).is_some() {
                    continue;
                }
                if let Some(relative) = super::archive_outputs::relative(&path, source)? {
                    outputs += usize::from(
                        store
                            .relocate_output(
                                &owner.session_id,
                                &path.to_string_lossy(),
                                installed_home.join("rust").join(relative),
                            )
                            .await?,
                    );
                } else if input.source_home.is_none()
                    && path
                        .to_string_lossy()
                        .replace('\\', "/")
                        .contains("/command-output/")
                {
                    return Err(RpcError::invalid(
                        "Native output restore requires the original profile directory",
                    ));
                }
            }
            for grant in store.grants(&owner.session_id).await? {
                if let Some(relative) = super::archive_outputs::within_home(&grant.path, source)? {
                    let next = installed_home.join("rust").join(relative);
                    if next != grant.path {
                        store
                            .add_grant(&owner.session_id, next, grant.kind, grant.mode)
                            .await?;
                        store.remove_grant(&owner.session_id, grant.path).await?;
                        grants += 1;
                    }
                }
            }
        }
        Ok(json!({"sessions":owners.len(),"outputs":outputs,"grants":grants}))
    }
    .await;
    let closed = db.close().await;
    let result = result?;
    closed?;
    Ok(result)
}

pub(crate) async fn installed_home(directory: &std::path::Path) -> Result<PathBuf, RpcError> {
    if !directory.is_absolute() || directory.file_name().is_none_or(|name| name != "dim") {
        return Err(RpcError::invalid(
            "Restore requires the installed dim directory",
        ));
    }
    let parent = directory
        .parent()
        .ok_or_else(|| RpcError::invalid("Invalid installed profile"))?;
    Ok(tokio::fs::canonicalize(parent)
        .await
        .map_err(|_| RpcError::invalid("Installed profile parent is unavailable"))?
        .join("dim"))
}
