//! Native Session-file transfer. History remains immutable; ownership names the
//! same file id under the receiving SessionStore's current filesystem root.
use dim_agent_capabilities::{
    file_storage::{EntryKind, FileStorage, FileStorageError},
    methods::RpcError,
};
use dim_app_server::storage::SessionStore;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

fn invalid() -> RpcError {
    RpcError::invalid("Native archive file transfer failed")
}

pub(crate) fn managed_id(path: &Path, source: &Path) -> Option<String> {
    let relative = path
        .strip_prefix(source.join("dimcode.sqlite.session-files"))
        .ok()?;
    let value = relative.to_str()?;
    uuid::Uuid::parse_str(value)
        .ok()
        .filter(|id| id.to_string() == value)
        .map(|_| value.to_owned())
}

pub(crate) async fn copy_managed(
    files: &Arc<FileStorage>,
    source_root: usize,
    target_root: usize,
    target: &SessionStore,
    session: &str,
    id: &str,
    cancel: &CancellationToken,
) -> Result<(), RpcError> {
    let relative = PathBuf::from("dimcode.sqlite.session-files").join(id);
    let source = files.path(source_root, &relative).map_err(|_| invalid())?;
    let entries = files.list(&source, cancel).await.map_err(|_| invalid())?;
    if entries.len() != 1 || entries[0].kind != EntryKind::File {
        return Err(invalid());
    }
    let file = relative.join(&entries[0].name);
    let source = files.path(source_root, &file).map_err(|_| invalid())?;
    let bytes = files
        .read_limited(&source, 16 * 1024 * 1024, cancel)
        .await
        .map_err(|_| invalid())?;
    let destination = files.path(target_root, &file).map_err(|_| invalid())?;
    match files
        .read_limited(&destination, 16 * 1024 * 1024, cancel)
        .await
    {
        Ok(existing) if existing != bytes => {
            return Err(RpcError::invalid(
                "Native archive file id conflicts with existing bytes",
            ));
        }
        Ok(_) => {}
        Err(FileStorageError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            files
                .create_directories(
                    &files.path(target_root, &relative).map_err(|_| invalid())?,
                    cancel,
                )
                .await
                .map_err(|_| invalid())?;
            #[cfg(unix)]
            let permissions = {
                use std::os::unix::fs::PermissionsExt;
                std::fs::Permissions::from_mode(0o400)
            };
            #[cfg(not(unix))]
            let permissions = {
                let mut permissions = std::fs::metadata(
                    files
                        .root_path(target_root)
                        .map_err(|_| invalid())?
                        .join("dimcode.sqlite"),
                )
                .map_err(|_| invalid())?
                .permissions();
                permissions.set_readonly(true);
                permissions
            };
            files
                .replace(&destination, bytes, Some(permissions), cancel)
                .await
                .map_err(|_| invalid())?;
        }
        Err(_) => return Err(invalid()),
    }
    target.adopt_file(session, id, cancel).await?;
    Ok(())
}
