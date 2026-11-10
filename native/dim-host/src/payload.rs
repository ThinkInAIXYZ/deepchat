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
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    branch_id: Option<String>,
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
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    // Session-scoped methods must remain routable before file ingress. Their
    // small outer identity cannot select a different Session or branch inside.
    for (key, expected) in [
        ("sessionId", envelope.session_id),
        ("branchId", envelope.branch_id),
    ] {
        if let Some(expected) = expected
            && value.get(key).and_then(Value::as_str) != Some(expected.as_str())
        {
            return Err(invalid());
        }
    }
    serde_json::from_value(value).map_err(|_| invalid())
}

/// A derived frame payload crosses the plugin boundary by reference, never as a large RPC frame.
pub(crate) async fn encode(value: &Value) -> Result<Value, RpcError> {
    let bytes = serde_json::to_vec(value).map_err(|_| invalid())?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(invalid());
    }
    let root = super::PAYLOAD_ROOT.get().ok_or_else(invalid)?;
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|_| invalid())?;
    let directory = tokio::fs::symlink_metadata(root)
        .await
        .map_err(|_| invalid())?;
    if !directory.is_dir() || directory.file_type().is_symlink() {
        return Err(invalid());
    }
    let name = format!("{}.json", uuid::Uuid::new_v4());
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(root.join(&name))
        .await
        .map_err(|_| invalid())?;
    use tokio::io::AsyncWriteExt;
    file.write_all(&bytes).await.map_err(|_| invalid())?;
    file.flush().await.map_err(|_| invalid())?;
    Ok(
        serde_json::json!({"deepchatPayload":{"name":name,"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes))}}),
    )
}

pub(crate) async fn discard(reference: &Value) {
    if let (Some(root), Some(name)) = (
        super::PAYLOAD_ROOT.get(),
        reference["deepchatPayload"]["name"]
            .as_str()
            .filter(|name| valid_name(name)),
    ) {
        let _ = tokio::fs::remove_file(root.join(name)).await;
    }
}
