//! Cold-profile command outputs retain their relative native location. The
//! destination's native ownership records use its installed, final directory.
use dim_agent_capabilities::{
    file_storage::{FileReader, FileStorage, FileStorageError},
    methods::RpcError,
};
use dim_app_server::storage::SessionStore;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

fn invalid() -> RpcError {
    RpcError::invalid("Native command-output transfer failed")
}

fn portable(path: &str) -> String {
    let path = path.replace('\\', "/");
    let path = if let Some(unc) = path.strip_prefix("//?/UNC/") {
        format!("//{unc}")
    } else {
        path.strip_prefix("//?/").unwrap_or(&path).to_owned()
    };
    path.trim_end_matches('/').to_owned()
}

/// The manifest identifies the original product home; no original absolute
/// filename is opened. Foreign Windows separators are data on Unix and vice versa.
pub(crate) fn relative(path: &Path, source_home: &str) -> Result<Option<PathBuf>, RpcError> {
    let Some(result) = within_home(path, source_home)? else {
        return Ok(None);
    };
    let components: Vec<_> = result.iter().collect();
    if components.len() < 3
        || components[0] != "command-output"
        || components[1]
            .to_str()
            .and_then(|value| uuid::Uuid::parse_str(value).ok())
            .is_none()
    {
        return Err(RpcError::invalid(
            "Unsupported owned path inside the native profile",
        ));
    }
    Ok(Some(result))
}

pub(crate) fn within_home(path: &Path, source_home: &str) -> Result<Option<PathBuf>, RpcError> {
    let source = format!("{}/rust", portable(source_home));
    let path = portable(&path.to_string_lossy());
    if path == source {
        return Ok(Some(PathBuf::new()));
    }
    let Some(suffix) = path.strip_prefix(&(source + "/")) else {
        return Ok(None);
    };
    let components: Vec<_> = suffix.split('/').collect();
    if components.iter().any(|part| {
        part.is_empty() || matches!(*part, "." | "..") || part.contains(':') || part.contains('\0')
    }) {
        return Err(invalid());
    }
    let result = components.into_iter().collect::<PathBuf>();
    if result
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid());
    }
    Ok(Some(result))
}

pub(crate) async fn copy(
    files: &Arc<FileStorage>,
    source_root: usize,
    target_root: usize,
    installed_root: &Path,
    target: &SessionStore,
    session: &str,
    relative: &Path,
    cancel: &CancellationToken,
) -> Result<(), RpcError> {
    let source = files.path(source_root, relative).map_err(|_| invalid())?;
    let source = match files.open_read(&source, cancel).await {
        Ok(reader) => Some(reader),
        // A settled command can legitimately retain ownership of an absent output.
        Err(FileStorageError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(invalid()),
    };
    if let Some(source) = source {
        let destination = files.path(target_root, relative).map_err(|_| invalid())?;
        match files.open_read(&destination, cancel).await {
            Ok(existing) => {
                if source.len() != existing.len()
                    || digest(&source, cancel).await? != digest(&existing, cancel).await?
                {
                    return Err(RpcError::invalid(
                        "Native command-output identity conflicts with existing bytes",
                    ));
                }
            }
            Err(FileStorageError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                let parent = relative.parent().ok_or_else(invalid)?;
                files
                    .create_directories(
                        &files.path(target_root, parent).map_err(|_| invalid())?,
                        cancel,
                    )
                    .await
                    .map_err(|_| invalid())?;
                let mut lease = files
                    .lock(&destination, cancel)
                    .await
                    .map_err(|_| invalid())?;
                // replace_from owns its blocking worker. Each read uses the native pinned
                // FileReader and its 64 KiB limit, independent of the output's total size.
                lease
                    .replace_from(
                        Reader {
                            file: source,
                            offset: 0,
                            runtime: tokio::runtime::Handle::current(),
                            cancel: cancel.clone(),
                        },
                        None,
                        cancel,
                    )
                    .await
                    .map_err(|_| invalid())?;
            }
            Err(_) => return Err(invalid()),
        }
    }
    target
        .register(session, installed_root.join(relative))
        .await?;
    Ok(())
}

async fn digest(file: &FileReader, cancel: &CancellationToken) -> Result<[u8; 32], RpcError> {
    let mut hash = Sha256::new();
    let mut offset = 0;
    while offset < file.len() {
        let bytes = file
            .read_at(offset, 64 * 1024, cancel)
            .await
            .map_err(|_| invalid())?;
        if bytes.is_empty() {
            return Err(invalid());
        }
        offset += bytes.len() as u64;
        hash.update(bytes);
    }
    Ok(hash.finalize().into())
}

struct Reader {
    file: FileReader,
    offset: u64,
    runtime: tokio::runtime::Handle,
    cancel: CancellationToken,
}
impl Read for Reader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if buffer.is_empty() || self.offset == self.file.len() {
            return Ok(0);
        }
        let bytes = self
            .runtime
            .block_on(
                self.file
                    .read_at(self.offset, buffer.len().min(64 * 1024), &self.cancel),
            )
            .map_err(std::io::Error::other)?;
        if bytes.is_empty() {
            return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        }
        buffer[..bytes.len()].copy_from_slice(&bytes);
        self.offset += bytes.len() as u64;
        Ok(bytes.len())
    }
}
