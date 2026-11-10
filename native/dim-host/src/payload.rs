//! File-backed private RPC payloads. Model selection and inference remain native.
use dim_agent_capabilities::{file_storage::FileStorage, methods::RpcError};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

const MAX_BYTES: usize = 256 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    deepchat_payload: Reference,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reference {
    name: String,
    bytes: usize,
    sha256: String,
}
fn valid_name(name: &str) -> bool {
    name.strip_suffix(".json")
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok() && id.len() == 36)
}
fn invalid() -> RpcError {
    RpcError::invalid("Invalid native file payload")
}

pub(crate) fn cleanup() -> rutis::Result<()> {
    static CLEANED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if CLEANED.get().is_some() {
        return Ok(());
    }
    let Some(root) = super::PAYLOAD_ROOT.get() else {
        return Ok(());
    };
    // Startup owns the native database lease. Calls can create transport files only after
    // host startup, so valid files left by a previous process are no longer in use.
    if root.exists() {
        let kind = std::fs::symlink_metadata(root)?.file_type();
        if !kind.is_dir() || kind.is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid native payload directory",
            )
            .into());
        }
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            if entry.file_name().to_str().is_some_and(valid_name) {
                std::fs::remove_file(entry.path())?;
            }
        }
    }
    let _ = CLEANED.set(());
    Ok(())
}

pub(crate) async fn decode<T: DeserializeOwned>(
    value: Value,
    files: &Arc<FileStorage>,
    cancel: &CancellationToken,
) -> Result<T, RpcError> {
    if value.get("deepchatPayload").is_none() {
        return dim_agent_capabilities::methods::params(value);
    }
    let envelope: Envelope = dim_agent_capabilities::methods::params(value)?;
    let reference = envelope.deepchat_payload;
    if !valid_name(&reference.name)
        || reference.bytes == 0
        || reference.bytes > MAX_BYTES
        || reference.sha256.len() != 64
        || !reference
            .sha256
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(invalid());
    }
    let root = super::PAYLOAD_ROOT.get().ok_or_else(invalid)?;
    let kind = tokio::fs::symlink_metadata(root)
        .await
        .map_err(|_| invalid())?
        .file_type();
    if !kind.is_dir() || kind.is_symlink() {
        return Err(invalid());
    }
    // System temp/user-data ancestors can be aliases (for example /var on macOS).
    // FileStorage requires canonical authorized roots and rejects symlinks below them.
    let root = tokio::fs::canonicalize(root).await.map_err(|_| invalid())?;
    let root = files
        .register_root(root, cancel)
        .await
        .map_err(|_| invalid())?;
    let path = files.path(root, &reference.name).map_err(|_| invalid())?;
    let bytes = files
        .read_limited(&path, reference.bytes, cancel)
        .await
        .map_err(|_| invalid())?;
    if bytes.len() != reference.bytes || format!("{:x}", Sha256::digest(&bytes)) != reference.sha256
    {
        return Err(invalid());
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}
