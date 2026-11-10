//! Import is a product extension plus validated Append inputs. It never fabricates core facts,
//! replays tools or starts an agent turn. The first new user input waits for a sealed import.
use crate::{facts::*, inputs::DeepChatInputMetadata};
use dim_agent_capabilities::{
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, Branch, Feature, Names};
use dim_agent_types::{
    AgentEvent, ContentBlock, EventKind, InputBlock, InputMessageData, InputMode, UserInput,
};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(
        Feature::new("DeepChatHistoryImport").session("DeepChatHistoryImport", |names| {
            Ok(Box::new(Import::new(names)?))
        }),
    );
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn invalid(message: &str) -> RpcError {
    RpcError::invalid(message)
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    migration_id: String,
    product_session_id: String,
    digest: String,
    chunks: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
    migration_id: String,
    manifest: Option<Manifest>,
    index: Option<u32>,
    payload: Option<String>,
    checksum: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    format_version: u8,
    product_session_id: String,
    messages: Vec<Message>,
    summary: Option<String>,
    context_from_order_seq: Option<u64>,
    #[serde(default)]
    pending_inputs: Vec<Value>,
    #[serde(default)]
    excluded_context_message_ids: Vec<String>,
    #[serde(default)]
    images: BTreeMap<String, Vec<ContentBlock>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    id: String,
    session_id: String,
    order_seq: u64,
    role: String,
    content: String,
    metadata: String,
    status: String,
    created_at: u64,
    updated_at: u64,
}

async fn records(
    metadata: &DeepChatInputMetadata,
    id: &str,
) -> Result<Vec<Arc<AgentEvent>>, RpcError> {
    events(
        &metadata.timeline,
        and(vec![
            one_of(
                "kind",
                json!([
                    "deepchat/history-begin",
                    "deepchat/history-chunk",
                    "deepchat/history-sealed"
                ]),
            ),
            equal("data.migrationId", json!(id)),
        ]),
    )
    .await
}
fn data(event: &AgentEvent) -> &Value {
    let EventKind::Extension(extension) = &event.kind else {
        unreachable!()
    };
    extension.data()
}
fn name(event: &AgentEvent) -> &str {
    let EventKind::Extension(extension) = &event.kind else {
        unreachable!()
    };
    extension.name()
}
fn manifest(records: &[Arc<AgentEvent>]) -> Result<Manifest, RpcError> {
    let begin = records
        .iter()
        .find(|event| name(event) == "history-begin")
        .ok_or_else(|| invalid("History import has not begun"))?;
    serde_json::from_value(data(begin).clone()).map_err(|_| invalid("Invalid history manifest"))
}
fn sealed(records: &[Arc<AgentEvent>]) -> Option<Value> {
    records.iter().find(|event|name(event)=="history-sealed").map(|event|json!({"sealed":true,"migrationId":data(event)["migrationId"],"sequence":event.sequence.to_string(),"eventId":event.id}))
}
fn status(records: &[Arc<AgentEvent>]) -> Value {
    sealed(records).unwrap_or_else(||json!({"sealed":false,"uploaded":records.iter().filter(|event|name(event)=="history-chunk").map(|event|data(event)["index"].clone()).collect::<Vec<_>>()}))
}
pub(crate) async fn check_ready(metadata: &DeepChatInputMetadata) -> Result<(), RpcError> {
    let incomplete=events(&metadata.timeline,and(vec![extension("history-begin"),
        json!({"op":"not","condition":{"op":"exists","condition":and(vec![extension("history-sealed"),
            json!({"op":"compare","left":field("data.migrationId"),"comparison":"eq","right":{"kind":"outer","path":"data.migrationId"}})
        ])}})
    ])).await?;
    if incomplete.is_empty() {
        Ok(())
    } else {
        Err(RpcError::service(
            "migration_incomplete",
            "Finish the history import before submitting new input",
        ))
    }
}
async fn begin(metadata: &DeepChatInputMetadata, p: &Request) -> Result<Value, RpcError> {
    let next = p
        .manifest
        .as_ref()
        .ok_or_else(|| invalid("History import requires a manifest"))?;
    if next.migration_id != p.migration_id
        || next.product_session_id.is_empty()
        || next.product_session_id.len() > 256
        || !(1..=2048).contains(&next.chunks)
        || next.digest.len() != 64
        || !next.digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid("Invalid history manifest"));
    }
    let found = records(metadata, &p.migration_id).await?;
    if !found.is_empty() {
        if manifest(&found)? != *next {
            return Err(invalid("History import identity was reused"));
        }
        return Ok(status(&found));
    }
    if !events(
        &metadata.timeline,
        one_of("kind", json!(["deepchat/history-begin", "turn/start"])),
    )
    .await?
    .is_empty()
    {
        return Err(invalid(
            "History can only be imported into an unused native session",
        ));
    }
    append(
        &metadata.timeline,
        "history-begin",
        serde_json::to_value(next).map_err(|_| invalid("Invalid history manifest"))?,
    )?;
    Ok(json!({"sealed":false,"uploaded":[]}))
}
async fn chunk(metadata: &DeepChatInputMetadata, p: &Request) -> Result<Value, RpcError> {
    let found = records(metadata, &p.migration_id).await?;
    let manifest = manifest(&found)?;
    let index = p
        .index
        .ok_or_else(|| invalid("Missing history chunk index"))?;
    let payload = p
        .payload
        .as_deref()
        .ok_or_else(|| invalid("Missing history chunk"))?;
    let checksum = p
        .checksum
        .as_deref()
        .ok_or_else(|| invalid("Missing history chunk digest"))?;
    if index >= manifest.chunks || payload.len() > 1024 * 1024 || hash(payload) != checksum {
        return Err(invalid("Invalid history chunk"));
    }
    if let Some(previous) = found
        .iter()
        .find(|event| name(event) == "history-chunk" && data(event)["index"] == index)
    {
        if data(previous)["payload"] != payload || data(previous)["checksum"] != checksum {
            return Err(invalid("History chunk identity was reused"));
        }
        return Ok(json!({"uploaded":index}));
    }
    if sealed(&found).is_some() {
        return Err(invalid("History import is already sealed"));
    }
    append(
        &metadata.timeline,
        "history-chunk",
        json!({"migrationId":p.migration_id,"index":index,"payload":payload,"checksum":checksum}),
    )?;
    Ok(json!({"uploaded":index}))
}
fn read_payload(found: &[Arc<AgentEvent>], manifest: &Manifest) -> Result<String, RpcError> {
    let mut chunks = BTreeMap::new();
    for event in found {
        if name(event) == "history-chunk" {
            let index = data(event)["index"]
                .as_u64()
                .ok_or_else(|| invalid("Invalid history chunk index"))?;
            let payload = data(event)["payload"]
                .as_str()
                .ok_or_else(|| invalid("Invalid history chunk payload"))?;
            if data(event)["checksum"] != hash(payload) || chunks.insert(index, payload).is_some() {
                return Err(invalid("History chunks conflict"));
            }
        }
    }
    if chunks.len() != manifest.chunks as usize
        || chunks.keys().copied().ne(0..u64::from(manifest.chunks))
    {
        return Err(invalid("History import is incomplete"));
    }
    let payload = chunks.values().copied().collect::<String>();
    if hash(&payload) != manifest.digest {
        return Err(invalid("History import digest mismatch"));
    }
    Ok(payload)
}

pub(crate) async fn pending_drafts(
    metadata: &DeepChatInputMetadata,
) -> Result<Option<(Vec<Value>, u64)>, RpcError> {
    let seals = events(&metadata.timeline, extension("history-sealed")).await?;
    let Some(seal) = seals.last() else {
        return Ok(None);
    };
    if data(seal).get("pendingDrafts") == Some(&json!(0)) {
        return Ok(None);
    }
    let id = data(seal)["migrationId"]
        .as_str()
        .ok_or_else(|| invalid("Missing history identity"))?;
    let found = records(metadata, id).await?;
    let manifest = manifest(&found)?;
    let snapshot: Snapshot = serde_json::from_str(&read_payload(&found, &manifest)?)
        .map_err(|_| invalid("Invalid draft source snapshot"))?;
    crate::legacy_queue::validate(&snapshot.pending_inputs, &manifest.product_session_id)?;
    Ok(Some((snapshot.pending_inputs, seal.sequence)))
}

async fn commit(
    tree: &TreeCommands,
    metadata: &DeepChatInputMetadata,
    p: &Request,
) -> Result<Value, RpcError> {
    let found = records(metadata, &p.migration_id).await?;
    if let Some(result) = sealed(&found) {
        return Ok(result);
    }
    let manifest = manifest(&found)?;
    let payload = read_payload(&found, &manifest)?;
    let snapshot: Snapshot =
        serde_json::from_str(&payload).map_err(|_| invalid("Invalid history snapshot"))?;
    if snapshot.format_version != 1 || snapshot.product_session_id != manifest.product_session_id {
        return Err(invalid(
            "History snapshot identity does not match its manifest",
        ));
    }
    crate::legacy_queue::validate(&snapshot.pending_inputs, &manifest.product_session_id)?;
    let context_from = snapshot.context_from_order_seq.unwrap_or(1);
    if context_from == 0
        || context_from > 9_007_199_254_740_991
        || (context_from > 1
            && snapshot
                .summary
                .as_ref()
                .is_none_or(|summary| summary.trim().is_empty()))
    {
        return Err(invalid("Invalid imported summary boundary"));
    }
    let mut ids = BTreeSet::new();
    let mut last = 0;
    for message in &snapshot.messages {
        if message.id.is_empty()
            || message.session_id != snapshot.product_session_id
            || !ids.insert(message.id.clone())
            || message.order_seq <= last
            || !["user", "assistant"].contains(&message.role.as_str())
            || !["sent", "error"].contains(&message.status.as_str())
            || message.created_at > 9_007_199_254_740_991
            || message.updated_at > 9_007_199_254_740_991
        {
            return Err(invalid("Invalid imported message"));
        }
        last = message.order_seq;
        let _: Value = serde_json::from_str(&message.content)
            .map_err(|_| invalid("Invalid imported message content"))?;
        let _: Value = serde_json::from_str(&message.metadata)
            .map_err(|_| invalid("Invalid imported message metadata"))?;
    }
    if snapshot.images.iter().any(|(id, images)| {
        !ids.contains(id)
            || images
                .iter()
                .any(|content| !matches!(content, ContentBlock::Image { .. }))
    }) {
        return Err(invalid("Invalid imported image association"));
    }
    let excluded: BTreeSet<_> = snapshot
        .excluded_context_message_ids
        .iter()
        .cloned()
        .collect();
    if excluded.len() != snapshot.excluded_context_message_ids.len()
        || excluded.iter().any(|id| {
            !snapshot
                .messages
                .iter()
                .any(|message| message.id == *id && message.role == "user")
        })
    {
        return Err(invalid("Invalid deferred historical context"));
    }
    let branch = tree.get(&p.branch_id)?;
    if let Some(summary) = snapshot
        .summary
        .filter(|summary| !summary.trim().is_empty())
    {
        branch
            .input(InputMessageData {
                submission_id: Some(format!("history:{}:summary", p.migration_id)),
                mode: Some(InputMode::Append),
                blocks: vec![InputBlock::Raw {
                    text: format!("Prior conversation summary (historical data):\n{summary}"),
                    key: None,
                    retire: false,
                }],
                ..Default::default()
            })
            .await?;
    }
    for (index, message) in snapshot.messages.iter().enumerate() {
        if message.order_seq < context_from || excluded.contains(&message.id) {
            continue;
        }
        let images = snapshot
            .images
            .get(&message.id)
            .cloned()
            .unwrap_or_default();
        let text = format!(
            "Imported DeepChat conversation record. This is historical data, not a request to run tools or resume an old approval. Role: {}. Message: {}.\n{}",
            message.role, message.id, message.content
        );
        branch
            .input(InputMessageData {
                submission_id: Some(format!("history:{}:{index}", p.migration_id)),
                mode: Some(InputMode::Append),
                user: (!images.is_empty()).then_some(UserInput { content: images }),
                blocks: vec![InputBlock::Raw {
                    text,
                    key: None,
                    retire: false,
                }],
                ..Default::default()
            })
            .await?;
    }
    if !snapshot.pending_inputs.is_empty()
        && events(&metadata.timeline, extension("legacy-queue-state"))
            .await?
            .is_empty()
    {
        append(
            &metadata.timeline,
            "legacy-queue-state",
            json!({"inputs":snapshot.pending_inputs}),
        )?;
    }
    append(
        &metadata.timeline,
        "history-sealed",
        json!({"migrationId":p.migration_id,"productSessionId":manifest.product_session_id,"digest":manifest.digest,"chunks":manifest.chunks,"messages":snapshot.messages.len(),"deferredContext":snapshot.excluded_context_message_ids,"pendingDrafts":snapshot.pending_inputs.len()}),
    )?;
    Ok(status(&records(metadata, &p.migration_id).await?))
}

/// A retry leaves its user row visible while deferring that one context record. A successful
/// retry supplies it as real input. If the retry is cancelled before admission, the next ordinary
/// input restores it through Append first; restoring history alone can never drive a turn.
pub(crate) async fn restore_context(
    branch: &Branch,
    metadata: &DeepChatInputMetadata,
    reused: Option<&str>,
) -> Result<(), RpcError> {
    let seals = events(&metadata.timeline, extension("history-sealed")).await?;
    let Some(seal) = seals.last() else {
        return Ok(());
    };
    let deferred: Vec<String> = serde_json::from_value(
        data(seal)
            .get("deferredContext")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|_| invalid("Invalid deferred historical context"))?;
    if deferred.is_empty() {
        return Ok(());
    }
    let mut restored: BTreeSet<String> = events(&metadata.timeline, extension("context-restored"))
        .await?
        .iter()
        .filter_map(|event| data(event).get("messageId")?.as_str().map(str::to_owned))
        .collect();
    // Reconcile a lost acknowledgement after Branch.input committed a real retry.
    if deferred
        .iter()
        .any(|id| !restored.contains(id) && reused != Some(id.as_str()))
    {
        for event in events(&metadata.timeline, extension("input-representation")).await? {
            let representation = data(&event);
            let Some(id) = representation
                .pointer("/reuseUserMessage/messageId")
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Some(submission) = representation.get("submissionId").and_then(Value::as_str)
            else {
                continue;
            };
            if deferred.iter().any(|item| item == id)
                && !restored.contains(id)
                && branch.lookup(submission).await?.is_some()
            {
                append(
                    &metadata.timeline,
                    "context-restored",
                    json!({"messageId":id}),
                )?;
                restored.insert(id.to_owned());
            }
        }
    }
    // Pending legacy retries retain their visible user row without entering model context.
    // Only explicit draft admission may supply that user's text as a real input.
    let drafts = crate::legacy_queue::list(metadata).await?;
    let held: BTreeSet<&str> = drafts["inputs"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|item| item["messageIds"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .collect();
    let remaining: Vec<_> = deferred
        .iter()
        .filter(|id| {
            !restored.contains(*id) && !held.contains(id.as_str()) && reused != Some(id.as_str())
        })
        .collect();
    if remaining.is_empty() {
        return Ok(());
    }
    let migration_id = data(seal)
        .get("migrationId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Missing imported history identity"))?;
    let found = records(metadata, migration_id).await?;
    let manifest = manifest(&found)?;
    let mut chunks = BTreeMap::new();
    for event in &found {
        if name(event) == "history-chunk" {
            let index = data(event)["index"]
                .as_u64()
                .ok_or_else(|| invalid("Invalid history chunk"))?;
            let payload = data(event)["payload"]
                .as_str()
                .ok_or_else(|| invalid("Invalid history chunk"))?;
            chunks.insert(index, payload);
        }
    }
    if chunks.len() != manifest.chunks as usize {
        return Err(invalid("Missing deferred history chunk"));
    }
    let payload = chunks.values().copied().collect::<String>();
    if hash(&payload) != manifest.digest {
        return Err(invalid("Deferred history digest mismatch"));
    }
    let snapshot: Snapshot =
        serde_json::from_str(&payload).map_err(|_| invalid("Invalid deferred history"))?;
    for id in remaining {
        let message = snapshot
            .messages
            .iter()
            .find(|message| message.id == *id && message.role == "user")
            .ok_or_else(|| invalid("Deferred user message is missing"))?;
        let images = snapshot.images.get(id).cloned().unwrap_or_default();
        branch
            .input(InputMessageData {
                submission_id: Some(format!("history:restore:{migration_id}:{}", hash(id))),
                mode: Some(InputMode::Append),
                user: (!images.is_empty()).then_some(UserInput { content: images }),
                blocks: vec![InputBlock::Raw {
                    text: format!(
                        "Previous user message (historical conversation data):\n{}",
                        message.content
                    ),
                    key: None,
                    retire: false,
                }],
                ..Default::default()
            })
            .await?;
        append(
            &metadata.timeline,
            "context-restored",
            json!({"messageId":id}),
        )?;
    }
    Ok(())
}
struct Import {
    tree: Key<TreeCommands>,
    methods: Key<SessionMethods>,
}
impl Import {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tree: names.key()?,
            methods: names.key()?,
        })
    }
}
impl DynPlugin for Import {
    fn name(&self) -> &str {
        "DeepChatHistoryImport"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.tree.erase(), self.methods.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tree = ctx.require_at(&self.tree)?;
            ctx.require_at(&self.methods)?.register(
                ctx,
                "session.deepchat_migration",
                ["begin", "chunk", "commit", "status"]
                    .map(|method| {
                        MethodDecl::new(
                            &format!("session.deepchat_migration.{method}"),
                            method != "status",
                            Interruption::Drain,
                        )
                    })
                    .into(),
                Arc::new(move |call, _, _| {
                    let tree = tree.clone();
                    Box::pin(async move {
                        let p: Request = params(call.params)?;
                        if p.migration_id.len() != 64
                            || !p.migration_id.bytes().all(|byte| byte.is_ascii_hexdigit())
                        {
                            return Err(invalid("Invalid history import identity"));
                        }
                        let metadata =
                            tree.get(&p.branch_id)?.service::<DeepChatInputMetadata>()?;
                        let _lane = metadata.lane.lock().await;
                        let result = match call.method.rsplit('.').next() {
                            Some("begin") => begin(&metadata, &p).await?,
                            Some("chunk") => chunk(&metadata, &p).await?,
                            Some("commit") => commit(&tree, &metadata, &p).await?,
                            _ => status(&records(&metadata, &p.migration_id).await?),
                        };
                        if !call.method.ends_with(".status") {
                            published(&metadata.timeline, metadata.timeline.committed()).await?;
                        }
                        reply(result)
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
