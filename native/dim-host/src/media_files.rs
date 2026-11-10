//! Conversation media lives in native Session files, so fork, GC and archive
//! transfer use the same ownership as other attachments. Modality keeps its task.
use base64::{Engine, engine::general_purpose::STANDARD};
use dim_agent_capabilities::{
    file_storage::FileStorage,
    host::SessionFilesHost,
    methods::{Interruption, MethodDecl, RpcError, params, reply},
};
use dim_agent_runtime::{AgentBuilder, names};
use dim_app_server::methods::ManagementMethods;
use dim_modality::{ModalityTasks, TaskRecord, TaskResultQuery};
use rutis::{
    Ctx,
    host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

const LIMIT: u64 = 256 * 1024 * 1024;
const CHUNK: usize = 8 * 1024 * 1024;
const PREFIX: &str = "imgcache://dim_file_";

pub(crate) struct MediaFiles {
    files: Arc<FileStorage>,
    sessions: Arc<SessionFilesHost>,
}
pub fn install(builder: &mut AgentBuilder) {
    names::register::<MediaFiles>(builder.catalog_mut(), None);
    builder.plugin(|names| {
        Ok(Box::new(Storage {
            files: names.key()?,
            sessions: names.key()?,
            methods: names.key()?,
        }))
    });
}
struct Storage {
    files: Key<FileStorage>,
    sessions: Key<SessionFilesHost>,
    methods: Key<ManagementMethods>,
}
impl DynPlugin for Storage {
    fn name(&self) -> &str {
        "DeepChatMediaStorage"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.files.erase(),
            self.sessions.erase(),
            self.methods.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let owner = Arc::new(MediaFiles {
                files: ctx.require_at(&self.files)?,
                sessions: ctx.require_at(&self.sessions)?,
            });
            ctx.provide_as::<MediaFiles>(owner.clone())?;
            ctx.require_at(&self.methods)?.register(ctx, "deepchat.media_files", vec![
                MethodDecl::new("deepchat.media_files.describe", false, Interruption::Report),
                MethodDecl::new("deepchat.media_files.read", false, Interruption::Report),
            ], Arc::new(move |call, cancel, _| {
                let owner = owner.clone(); Box::pin(async move {
                    let query: Read = params(call.params)?;
                    let manifest = owner.manifest(&query.file_id, &cancel).await?;
                    if call.method.ends_with(".describe") {
                        return reply(json!({"name":manifest.name,"mediaType":manifest.media_type,"bytes":manifest.bytes,"sha256":manifest.sha256}));
                    }
                    if query.length == 0 || query.length > 1024 * 1024 || query.offset > manifest.bytes { return Err(invalid()); }
                    let bytes = owner.read_manifest(&manifest, query.offset, query.length, &cancel).await?;
                    reply(json!({"data_base64":STANDARD.encode(&bytes),"eof":query.offset + bytes.len() as u64 == manifest.bytes}))
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Read {
    file_id: String,
    #[serde(default)]
    offset: u64,
    #[serde(default)]
    length: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    version: u32,
    name: String,
    media_type: String,
    bytes: u64,
    sha256: String,
    chunks: Vec<Chunk>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Chunk {
    file_id: String,
    bytes: u64,
    sha256: String,
}
fn invalid() -> RpcError {
    RpcError::invalid("Native media file is unavailable or invalid")
}
fn id(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn reference(value: &str) -> Option<(String, String)> {
    let (file, name) = value.strip_prefix(PREFIX)?.split_once("__")?;
    (id(file)
        && !name.is_empty()
        && name.len() <= 200
        && !matches!(name, "." | "..")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte)))
    .then(|| (file.to_owned(), name.to_owned()))
}
impl MediaFiles {
    /// A file is split below the native 16 MiB Session-file limit. Every chunk
    /// and its manifest has native ownership before a conversation receives a link.
    pub(crate) async fn publish(
        &self,
        session: &str,
        task: &TaskRecord,
        tasks: &ModalityTasks,
        cancel: &CancellationToken,
    ) -> Result<Vec<(String, String)>, RpcError> {
        let output = task.result.as_ref().ok_or_else(invalid)?;
        let mut links = Vec::new();
        for file in &output.files {
            if !["image/", "audio/", "video/"]
                .iter()
                .any(|prefix| file.media_type.starts_with(prefix))
            {
                continue;
            }
            if file.bytes > LIMIT || !digest(&file.sha256) {
                return Err(invalid());
            }
            let mut offset = 0;
            let mut hash = Sha256::new();
            let mut chunks = Vec::new();
            while offset < file.bytes {
                let mut buffer = Vec::new();
                while buffer.len() < CHUNK && offset < file.bytes {
                    let length = (file.bytes - offset)
                        .min((CHUNK - buffer.len()) as u64)
                        .min(1024 * 1024);
                    let page = tasks
                        .result(
                            TaskResultQuery {
                                task_id: task.task_id.clone(),
                                name: file.name.clone(),
                                offset,
                                length,
                            },
                            cancel,
                        )
                        .await?;
                    let bytes = STANDARD.decode(page.data_base64).map_err(|_| invalid())?;
                    if bytes.is_empty() || bytes.len() as u64 > length {
                        return Err(invalid());
                    }
                    offset += bytes.len() as u64;
                    hash.update(&bytes);
                    buffer.extend_from_slice(&bytes);
                }
                let sha256 = format!("{:x}", Sha256::digest(&buffer));
                let stored = self
                    .sessions
                    .0
                    .put(
                        session.to_owned(),
                        "media-chunk.bin".into(),
                        buffer,
                        cancel.clone(),
                    )
                    .await
                    .map_err(|_| invalid())?;
                chunks.push(Chunk {
                    file_id: stored.file_id,
                    bytes: stored.bytes,
                    sha256,
                });
            }
            if format!("{:x}", hash.finalize()) != file.sha256 {
                return Err(invalid());
            }
            let manifest = Manifest {
                version: 1,
                name: file.name.clone(),
                media_type: file.media_type.clone(),
                bytes: file.bytes,
                sha256: file.sha256.clone(),
                chunks,
            };
            let content = serde_json::to_vec(&manifest).map_err(|_| invalid())?;
            let stored = self
                .sessions
                .0
                .put(
                    session.to_owned(),
                    "media.json".into(),
                    content,
                    cancel.clone(),
                )
                .await
                .map_err(|_| invalid())?;
            let uri = format!("{PREFIX}{}__{}", stored.file_id, file.name);
            if reference(&uri).is_none() {
                return Err(invalid());
            }
            links.push((file.media_type.clone(), uri));
        }
        Ok(links)
    }
    async fn root(&self, cancel: &CancellationToken) -> Result<usize, RpcError> {
        let home = crate::PAYLOAD_ROOT
            .get()
            .and_then(|path| path.parent())
            .ok_or_else(invalid)?;
        // The pinned store's managed file layout is also the archive owner's
        // immutable-file boundary. Bytes are read only through public FileStorage.
        let directory = home.join("dimcode.sqlite.session-files");
        let info = tokio::fs::symlink_metadata(&directory)
            .await
            .map_err(|_| invalid())?;
        if !info.is_dir() || info.file_type().is_symlink() {
            return Err(invalid());
        }
        let directory = tokio::fs::canonicalize(directory)
            .await
            .map_err(|_| invalid())?;
        self.files
            .register_root(directory, cancel)
            .await
            .map_err(|_| invalid())
    }
    async fn manifest(&self, file: &str, cancel: &CancellationToken) -> Result<Manifest, RpcError> {
        if !id(file) {
            return Err(invalid());
        }
        let root = self.root(cancel).await?;
        let path = self
            .files
            .path(root, format!("{file}/media.json"))
            .map_err(|_| invalid())?;
        let bytes = self
            .files
            .read_limited(&path, 64 * 1024, cancel)
            .await
            .map_err(|_| invalid())?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if manifest.version != 1
            || manifest.bytes > LIMIT
            || !digest(&manifest.sha256)
            || manifest.chunks.len() > 32
            || manifest.chunks.iter().any(|chunk| {
                !id(&chunk.file_id)
                    || chunk.bytes == 0
                    || chunk.bytes > CHUNK as u64
                    || !digest(&chunk.sha256)
            })
            || manifest.chunks.iter().map(|chunk| chunk.bytes).sum::<u64>() != manifest.bytes
            || !["image/", "audio/", "video/"]
                .iter()
                .any(|prefix| manifest.media_type.starts_with(prefix))
        {
            return Err(invalid());
        }
        Ok(manifest)
    }
    async fn read_manifest(
        &self,
        manifest: &Manifest,
        offset: u64,
        length: u64,
        cancel: &CancellationToken,
    ) -> Result<Vec<u8>, RpcError> {
        let root = self.root(cancel).await?;
        let mut result = Vec::new();
        let mut start = 0;
        let end = offset.saturating_add(length).min(manifest.bytes);
        for chunk in &manifest.chunks {
            let next = start + chunk.bytes;
            if next > offset && start < end {
                let path = self
                    .files
                    .path(root, format!("{}/media-chunk.bin", chunk.file_id))
                    .map_err(|_| invalid())?;
                // Chunks are immutable and below the SDK's owned-file bound.
                let bytes = self
                    .files
                    .read_limited(&path, CHUNK, cancel)
                    .await
                    .map_err(|_| invalid())?;
                if bytes.len() as u64 != chunk.bytes
                    || format!("{:x}", Sha256::digest(&bytes)) != chunk.sha256
                {
                    return Err(invalid());
                }
                result.extend_from_slice(
                    &bytes[offset.saturating_sub(start) as usize
                        ..(end - start).min(chunk.bytes) as usize],
                );
            }
            start = next;
        }
        Ok(result)
    }
    pub(crate) async fn read(
        &self,
        file: &str,
        cancel: &CancellationToken,
    ) -> Result<(String, Vec<u8>), RpcError> {
        let manifest = self.manifest(file, cancel).await?;
        let bytes = self
            .read_manifest(&manifest, 0, manifest.bytes, cancel)
            .await?;
        if format!("{:x}", Sha256::digest(&bytes)) != manifest.sha256 {
            return Err(invalid());
        }
        Ok((manifest.media_type, bytes))
    }
}
