//! Read-only archive metadata through native owners, without restoring Agents.
use dim_agent_capabilities::{
    file_storage::FileStorage,
    methods::{Interruption, MethodDecl, RpcError, params, reply},
};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_app_server::{
    AgentRecords,
    methods::ManagementMethods,
    storage::{SessionStore, SqliteStorage},
};
use rutis::{
    Ctx,
    host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(Archives::new(names)?)));
}
struct Archives {
    methods: Key<ManagementMethods>,
    files: Key<FileStorage>,
}
impl Archives {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            methods: names.key()?,
            files: names.key()?,
        })
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Catalog {
    directory: PathBuf,
    after: Option<String>,
    limit: usize,
}
impl DynPlugin for Archives {
    fn name(&self) -> &str {
        "DeepChatArchiveReads"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.methods.erase(), self.files.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let files = ctx.require_at(&self.files)?;
            let context = ctx.clone();
            ctx.require_at(&self.methods)?.register(
                ctx,
                "deepchat.native_archive",
                vec![MethodDecl::new(
                    "deepchat.native_archive.catalog",
                    false,
                    Interruption::Report,
                )],
                Arc::new(move |call, cancel, _| {
                    let (files, context) = (files.clone(), context.clone());
                    Box::pin(async move {
                        let input: Catalog = params(call.params)?;
                        if !(1..=64).contains(&input.limit) || !input.directory.is_absolute() {
                            return Err(RpcError::invalid(
                                "Archive catalog requires an absolute directory and limit 1..64",
                            ));
                        }
                        let root = tokio::fs::canonicalize(input.directory.join("rust"))
                            .await
                            .map_err(|_| {
                                RpcError::invalid("Native archive directory is unavailable")
                            })?;
                        let database = root.join("dimcode.sqlite");
                        let kind = tokio::fs::symlink_metadata(&database)
                            .await
                            .map_err(|_| {
                                RpcError::invalid("Native archive database is unavailable")
                            })?
                            .file_type();
                        if !kind.is_file() || kind.is_symlink() {
                            return Err(RpcError::invalid(
                                "Native archive database must be a regular file",
                            ));
                        }
                        let root = files.register_root(root, &cancel).await.map_err(|_| {
                            RpcError::invalid("Native archive files are unavailable")
                        })?;
                        let (db, format) = SqliteStorage::open_read_only(database)?;
                        let result = async {
                            if format != dim_app_server::storage::STORE_FORMAT {
                                return Err(RpcError::invalid(
                                    "Native archive format requires migration",
                                ));
                            }
                            catalog(&context, db.clone(), root, input, &cancel).await
                        }
                        .await;
                        let closed = db.close().await;
                        let value = result?;
                        closed?;
                        reply(value)
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
async fn catalog(
    ctx: &Ctx,
    db: Arc<SqliteStorage>,
    root: usize,
    input: Catalog,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    let records = AgentRecords(db.clone());
    let profiles = records.agents().await?;
    let owners = records.owners().await?;
    let total = owners.len();
    let mut page = owners
        .into_iter()
        .filter(|owner| {
            input
                .after
                .as_ref()
                .is_none_or(|after| &owner.session_id > after)
        })
        .take(input.limit + 1)
        .collect::<Vec<_>>();
    let next = (page.len() > input.limit).then(|| page[input.limit - 1].session_id.clone());
    page.truncate(input.limit);
    let store = SessionStore::new(db, ctx.clone(), root);
    let mut required = BTreeSet::new();
    let mut sessions = Vec::new();
    for owner in page {
        if cancel.is_cancelled() {
            return Err(RpcError::interrupted());
        }
        if owner.error.is_some() {
            return Err(RpcError::invalid(
                "Native archive has invalid Session ownership",
            ));
        }
        let (agent_id, protocol_version) = owner
            .owner
            .ok_or_else(|| RpcError::invalid("Native archive Session has no Agent"))?;
        required.insert(agent_id.clone());
        let config = store
            .timeline_store()
            .session_config(&owner.session_id)
            .await?
            .ok_or_else(|| RpcError::invalid("Native archive Session configuration is absent"))?;
        let (origin, leader) = store.creation_record(&owner.session_id).await?;
        let metadata = store
            .metadata(&owner.session_id)
            .await
            .map_err(|_| RpcError::invalid("Native archive title metadata is unavailable"))?;
        let paths = store.owned_paths(&owner.session_id).await?;
        let grants = store.grants(&owner.session_id).await?;
        sessions.push(json!({"sessionId":owner.session_id,"agentId":agent_id,
            "protocolVersion":protocol_version,"config":config,"origin":origin,
            "parentSessionId":leader,"title":metadata.title,"titleRevision":metadata.revision.to_string(),
            "ownedPaths":paths,"grants":grants}));
    }
    let mut agents = BTreeMap::new();
    for record in profiles {
        if required.contains(&record.id) {
            let profile = record
                .profile
                .map_err(|_| RpcError::invalid("Native archive Agent profile is invalid"))?;
            agents.insert(
                record.id,
                json!({"profile":profile,"default":record.default,"ownerSessionId":record.owner}),
            );
        }
    }
    if agents.len() != required.len() {
        return Err(RpcError::invalid("Native archive Agent profile is absent"));
    }
    if cancel.is_cancelled() {
        return Err(RpcError::interrupted());
    }
    let value = json!({"storeFormat":dim_app_server::storage::STORE_FORMAT,"totalSessions":total,
        "sessions":sessions,"agents":agents,"next":next});
    if serde_json::to_vec(&value)
        .map_err(|_| RpcError::invalid("Cannot encode native archive catalog"))?
        .len()
        > 12 * 1024 * 1024
    {
        return Err(RpcError::invalid(
            "Native archive catalog page is too large; reduce its limit",
        ));
    }
    Ok(value)
}
