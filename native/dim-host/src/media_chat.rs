//! Media conversations use the native Agent loop and input queue. This model
//! host translates one native model request into a native Modality task.
use crate::media::MediaCatalog;
use crate::media_files::MediaFiles;
use base64::{Engine, engine::general_purpose::STANDARD};
use dim_agent_capabilities::{
    context_model::ProductContextModel, file_storage::FileStorage, host::*,
};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_agent_types::{
    ContentBlock, ImageSourceType, Message, MessageContent, MessagePart, ModelId, ModelRequest,
    Role,
};
use dim_modality::{
    ModalityTasks, TaskCancel, TaskResultQuery, TaskState, TaskStatus, TaskSubmit, TaskWait,
};
use futures_util::Stream;
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    pin::Pin,
    sync::{Arc, RwLock},
    task::{Context, Poll},
};
use tokio::sync::mpsc;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

const PREFIX: &str = "imgcache://dim_";
type Shared = Arc<RwLock<Option<Arc<Ready>>>>;
struct Ready {
    model: Arc<ModelHost>,
    auxiliary: Arc<AuxiliaryModelHost>,
    catalog: Arc<MediaCatalog>,
    tasks: Arc<ModalityTasks>,
    files: Arc<FileStorage>,
    artifacts: Arc<MediaFiles>,
    stop: CancellationToken,
    work: TaskTracker,
}
pub fn install(builder: &mut AgentBuilder) {
    let shared = Shared::default();
    // Agent-local process values preserve the host's own native providers.
    // Root auxiliary calls still use the default Aimux implementation.
    builder.process_value(Arc::new(ModelHost(Arc::new(Driver(shared.clone())))));
    builder.process_value(Arc::new(AuxiliaryModelHost(Arc::new(Auxiliary(
        shared.clone(),
    )))));
    builder.replace_session_host(move |identity| {
        Arc::new(PrepareContextHost(Arc::new(MediaRequest {
            session: identity.session_id.clone(),
        })))
    });
    let context = shared.clone();
    builder.replace_session_host(move |_| {
        Arc::new(ContextModelHost(Some(Arc::new(MediaContext(
            context.clone(),
        )))))
    });
    builder.plugin(move |names| Ok(Box::new(Startup::new(names, shared.clone())?)));
}
struct Startup {
    shared: Shared,
    model: Key<ModelHost>,
    auxiliary: Key<AuxiliaryModelHost>,
    catalog: Key<MediaCatalog>,
    tasks: Key<ModalityTasks>,
    files: Key<FileStorage>,
    artifacts: Key<MediaFiles>,
}
impl Startup {
    fn new(names: &Names<'_>, shared: Shared) -> rutis::Result<Self> {
        Ok(Self {
            shared,
            model: names.key()?,
            auxiliary: names.key()?,
            catalog: names.key()?,
            tasks: Key::named("modalityTasks"),
            files: names.key()?,
            artifacts: names.key()?,
        })
    }
}
impl DynPlugin for Startup {
    fn name(&self) -> &str {
        "DeepChatMediaConversations"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.model.erase(),
            self.auxiliary.erase(),
            self.catalog.erase(),
            self.tasks.erase(),
            self.files.erase(),
            self.artifacts.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let ready = Arc::new(Ready {
                model: ctx.require_at(&self.model)?,
                auxiliary: ctx.require_at(&self.auxiliary)?,
                catalog: ctx.require_at(&self.catalog)?,
                tasks: ctx.require_at(&self.tasks)?,
                files: ctx.require_at(&self.files)?,
                artifacts: ctx.require_at(&self.artifacts)?,
                stop: ctx.cancellation_token(),
                work: TaskTracker::new(),
            });
            *self.shared.write().unwrap() = Some(ready.clone());
            let shared = self.shared.clone();
            ctx.effect(move || async move {
                ready.work.close();
                ready.work.wait().await;
                let mut current = shared.write().unwrap();
                if current
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &ready))
                {
                    *current = None;
                }
                Ok(())
            })?;
            Ok(Effect::Done)
        })
    }
}
fn ready(shared: &Shared) -> Result<Arc<Ready>, HostError> {
    shared
        .read()
        .unwrap()
        .clone()
        .filter(|state| !state.stop.is_cancelled())
        .ok_or_else(|| HostError::Cancelled("Native media conversation host closed".into()))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Conversation {
    target: ModelId,
    category: String,
    #[serde(default, rename = "videoBodyShape")]
    video_body_shape: Option<String>,
}
fn conversation(state: &Ready, model: &ModelId) -> Result<Option<Conversation>, HostError> {
    state
        .catalog
        .conversation(model)
        .map(|value| {
            serde_json::from_value(value)
                .map_err(|_| HostError::failed("Invalid native media conversation declaration"))
        })
        .transpose()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    session_id: String,
    branch_id: String,
    request_id: String,
    turn_id: String,
    through: String,
    content: Vec<ContentBlock>,
}
async fn input(
    state: &Ready,
    request: &ModelRequest,
    cancel: &CancellationToken,
) -> Result<Input, HostError> {
    let metadata = request
        .metadata
        .as_ref()
        .ok_or_else(|| HostError::failed("Media request has no source"))?;
    let session = metadata
        .session_id
        .as_ref()
        .ok_or_else(|| HostError::failed("Media request has no session"))?;
    let turn = metadata
        .turn_id
        .as_ref()
        .ok_or_else(|| HostError::failed("Media request has no turn"))?;
    let id = metadata
        .extensions
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or_else(|| HostError::failed("Media request has no identity"))?;
    let reference = crate::gateway::request(
        json!({"kind":"media_input","sessionId":session,"turnId":turn,"requestId":id}),
        cancel.clone(),
        64 * 1024,
    )
    .await?;
    let decoded = crate::payload::decode::<Input>(reference.clone(), &state.files, cancel).await;
    crate::payload::discard(&reference).await;
    let input = decoded.map_err(|_| HostError::failed("Native media input is unavailable"))?;
    if input.session_id != *session
        || input.turn_id != *turn
        || input.request_id != id
        || input.branch_id.is_empty()
        || input.through.parse::<u64>().is_err()
    {
        return Err(HostError::failed(
            "Native media input has a different source",
        ));
    }
    Ok(input)
}
struct Driver(Shared);
impl ModelDriver for Driver {
    fn invoke(
        &self,
        request: Arc<ModelRequest>,
        connection: ModelConnection,
        cancel: CancellationToken,
    ) -> HostFuture<'_, ModelStream> {
        Box::pin(async move {
            let state = ready(&self.0)?;
            let model = ModelId {
                provider_id: request.provider_id.clone(),
                model_id: request.model_id.clone(),
            };
            let Some(plan) = conversation(&state, &model)? else {
                let request = rewrite(&state, request, &cancel).await?;
                return state.model.0.invoke(request, connection, cancel).await;
            };
            let (sender, receiver) = mpsc::unbounded_channel();
            let stop = cancel.child_token();
            let worker_stop = stop.clone();
            let owned = state.clone();
            state.work.spawn(async move {
                let result = run(&owned, &request, plan, &worker_stop).await;
                match result {
                    Ok(chunks) => {
                        for chunk in chunks {
                            if sender.send(Ok(chunk)).is_err() {
                                break;
                            }
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error));
                    }
                }
            });
            Ok(Box::pin(MediaStream { receiver, stop }) as ModelStream)
        })
    }
}
struct MediaStream {
    receiver: mpsc::UnboundedReceiver<Result<ModelChunk, HostError>>,
    stop: CancellationToken,
}
impl Stream for MediaStream {
    type Item = Result<ModelChunk, HostError>;
    fn poll_next(mut self: Pin<&mut Self>, ctx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.receiver.poll_recv(ctx)
    }
}
impl Drop for MediaStream {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}
async fn run(
    state: &Ready,
    request: &ModelRequest,
    plan: Conversation,
    cancel: &CancellationToken,
) -> Result<Vec<ModelChunk>, HostError> {
    let source = input(state, request, cancel).await?;
    let prompt = source
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    if prompt.trim().is_empty() {
        return Err(HostError::failed("Media prompt is required"));
    }
    let mut files = Vec::new();
    if plan.category == "image" {
        for block in &source.content {
            if let ContentBlock::Image { source } = block {
                let data = match source.source_type {
                    ImageSourceType::Base64 => source
                        .data
                        .clone()
                        .ok_or_else(|| HostError::failed("Media image input is missing"))?,
                    ImageSourceType::Url => {
                        let url = source.url.as_deref().unwrap_or_default();
                        if let Some((file, _)) = crate::media_files::reference(url) {
                            let (mime, bytes) = state
                                .artifacts
                                .read(&file, cancel)
                                .await
                                .map_err(|error| HostError::failed(error.message))?;
                            if !mime.starts_with("image/") {
                                return Err(HostError::failed("Media edit requires an image"));
                            }
                            STANDARD.encode(bytes)
                        } else {
                            let (task, name) = parse_reference(url).ok_or_else(|| {
                                HostError::failed("Media image input is not a native file")
                            })?;
                            STANDARD.encode(read_file(state, &task, &name, cancel).await?)
                        }
                    }
                };
                files.push(json!({"name":format!("input-{}",files.len()),"media_type":source.media_type,"data_base64":data}));
            }
        }
    }
    let options = request
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.extensions.get("deepchatMedia"))
        .cloned()
        .unwrap_or(Value::Null);
    let params = match plan.category.as_str() {
        "image" => {
            let mut extra = options["image"].clone();
            let mut params = json!({"prompt":prompt});
            if let Some(fields) = extra.as_object_mut() {
                for (from, to) in [("size", "size"), ("outputFormat", "outputFormat")] {
                    if let Some(value) = fields.remove(from) {
                        params[to] = value;
                    }
                }
                params["providerOptions"] = extra;
            }
            params
        }
        "video" => {
            let video = &options["video"];
            let mut params = json!({"prompt":prompt,"providerOptions":{"deepchat":video,"deepchatBodyShape":plan.video_body_shape}});
            for (from, to) in [
                ("ratio", "aspectRatio"),
                ("resolution", "resolution"),
                ("generateAudio", "generateAudio"),
            ] {
                if let Some(value) = video.get(from) {
                    params[to] = value.clone();
                }
            }
            if let Some(duration) = video["duration"]
                .as_f64()
                .or_else(|| video["seconds"].as_str().and_then(|s| s.parse().ok()))
            {
                params["durationSeconds"] = json!(duration);
            }
            params
        }
        "speech" => {
            let mut params = json!({"text":prompt});
            if let Some(options) = options["speech"].as_object() {
                for (key, value) in options {
                    params[if key == "responseFormat" {
                        "outputFormat"
                    } else {
                        key
                    }] = value.clone();
                }
            }
            params
        }
        _ => return Err(HostError::failed("Unsupported media conversation category")),
    };
    let task:TaskSubmit=serde_json::from_value(json!({"category":plan.category,"operation":if plan.category=="speech"{"synthesize"}else if files.is_empty(){"generate"}else{"edit"},
        "model":plan.target,"params":params,"files":files,"client_task_id":format!("deepchat/media/{}/{}",source.session_id,source.request_id)}))
        .map_err(|_|HostError::failed("Invalid native media task"))?;
    // Native admission is completed once. A dropped stream cancels the returned
    // task instead of guessing whether a cancelled submission was accepted.
    let admitted = state
        .tasks
        .submit(task, &state.stop)
        .await
        .map_err(|error| HostError::failed(error.message))?;
    let task_id = admitted.task.task_id.clone();
    let done = loop {
        if cancel.is_cancelled() || state.stop.is_cancelled() {
            let _ = state
                .tasks
                .cancel(
                    TaskCancel {
                        task_id: task_id.clone(),
                    },
                    &CancellationToken::new(),
                )
                .await;
            return Err(HostError::Cancelled("Media conversation cancelled".into()));
        }
        let wait = state.tasks.wait(
            TaskWait {
                task_id: task_id.clone(),
                timeout_ms: Some(600_000),
            },
            &state.stop,
            None,
        );
        let outcome = tokio::select! {
            result=wait=>Some(result), _=cancel.cancelled()=>None, _=state.stop.cancelled()=>None
        };
        let Some(outcome) = outcome else {
            continue;
        };
        let record = outcome
            .map_err(|error| HostError::failed(error.message))?
            .task;
        if record.state.is_terminal() {
            break record;
        }
    };
    if done.state != TaskState::Succeeded {
        return Err(HostError::failed(
            done.error
                .map(|error| error.message)
                .unwrap_or_else(|| "Native media task did not succeed".into()),
        ));
    }
    let links = state
        .artifacts
        .publish(&source.session_id, &done, &state.tasks, &state.stop)
        .await
        .map_err(|error| HostError::failed(error.message))?;
    let mut chunks = vec![ModelChunk::MessageStart {
        message_id: task_id.clone(),
    }];
    for (mime, reference) in links {
        chunks.push(ModelChunk::Text(format!("![{mime}]({reference})\n")));
        chunks.push(ModelChunk::TextEnd);
    }
    if chunks.len() == 1 {
        return Err(HostError::failed(
            "Native media task completed without media output",
        ));
    }
    chunks.push(ModelChunk::MessageStop {
        message_id: task_id,
        reason: ModelStopReason::EndTurn,
    });
    Ok(chunks)
}

pub(crate) fn parse_reference(value: &str) -> Option<(String, String)> {
    let (task, name) = value.strip_prefix(PREFIX)?.split_once("__")?;
    if !task.starts_with("mt_")
        || uuid::Uuid::parse_str(&task[3..]).is_err()
        || name.is_empty()
        || name.len() > 200
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || matches!(name, "." | "..")
    {
        return None;
    }
    Some((task.into(), name.into()))
}
async fn read_file(
    state: &Ready,
    task: &str,
    name: &str,
    cancel: &CancellationToken,
) -> Result<Vec<u8>, HostError> {
    let record = state
        .tasks
        .status(TaskStatus {
            task_id: task.into(),
        })
        .await
        .map_err(|error| HostError::failed(error.message))?
        .task;
    if record.state != TaskState::Succeeded {
        return Err(HostError::failed("Native media file is unavailable"));
    }
    let file = record
        .result
        .as_ref()
        .and_then(|output| output.files.iter().find(|file| file.name == name))
        .ok_or_else(|| HostError::failed("Native media file is missing"))?;
    if file.bytes > 256 * 1024 * 1024 {
        return Err(HostError::failed("Native media file exceeds its limit"));
    }
    let mut bytes = Vec::new();
    while (bytes.len() as u64) < file.bytes {
        let part = state
            .tasks
            .result(
                TaskResultQuery {
                    task_id: task.into(),
                    name: name.into(),
                    offset: bytes.len() as u64,
                    length: (file.bytes - bytes.len() as u64).min(1024 * 1024),
                },
                cancel,
            )
            .await
            .map_err(|error| HostError::failed(error.message))?;
        let data = STANDARD
            .decode(part.data_base64)
            .map_err(|_| HostError::failed("Invalid native media file chunk"))?;
        if data.is_empty() {
            return Err(HostError::failed("Incomplete native media file"));
        }
        bytes.extend_from_slice(&data);
    }
    if bytes.len() as u64 != file.bytes || format!("{:x}", Sha256::digest(&bytes)) != file.sha256 {
        return Err(HostError::failed("Native media file changed"));
    }
    Ok(bytes)
}
async fn rewrite(
    state: &Ready,
    request: Arc<ModelRequest>,
    cancel: &CancellationToken,
) -> Result<Arc<ModelRequest>, HostError> {
    let mut rewritten = (*request).clone();
    let mut changed = false;
    for message in &mut rewritten.messages {
        let MessageContent::Parts(parts) = &message.content else {
            continue;
        };
        let mut parts = parts.clone();
        let mut local = false;
        for part in &mut parts {
            let MessagePart::Image { source } = part else {
                continue;
            };
            if let Some((file, _)) = source
                .url
                .as_deref()
                .and_then(crate::media_files::reference)
            {
                local = true;
                if source.media_type.starts_with("image/")
                    && request
                        .capability_snapshot
                        .as_ref()
                        .is_some_and(|snapshot| snapshot.capabilities.vision)
                {
                    let (mime, bytes) = state
                        .artifacts
                        .read(&file, cancel)
                        .await
                        .map_err(|error| HostError::failed(error.message))?;
                    if !mime.starts_with("image/") {
                        return Err(HostError::failed("Native vision input is not an image"));
                    }
                    source.media_type = mime;
                    source.source_type = ImageSourceType::Base64;
                    source.data = Some(STANDARD.encode(bytes));
                    source.url = None;
                } else {
                    *part = MessagePart::Text {
                        provider_metadata: None,
                        text: format!(
                            "Generated {} is available at {}",
                            source.media_type,
                            source.url.as_deref().unwrap_or_default()
                        ),
                        start_time: None,
                        end_time: None,
                    };
                }
                continue;
            }
            let Some((task, name)) = source.url.as_deref().and_then(parse_reference) else {
                continue;
            };
            local = true;
            if source.media_type.starts_with("image/")
                && request
                    .capability_snapshot
                    .as_ref()
                    .is_some_and(|snapshot| snapshot.capabilities.vision)
            {
                source.data = Some(STANDARD.encode(read_file(state, &task, &name, cancel).await?));
                source.url = None;
                source.source_type = ImageSourceType::Base64;
            } else {
                *part = MessagePart::Text {
                    provider_metadata: None,
                    text: format!(
                        "Generated {} is available at {PREFIX}{task}__{name}",
                        source.media_type
                    ),
                    start_time: None,
                    end_time: None,
                };
            }
        }
        if local {
            let mut next = (**message).clone();
            next.content = MessageContent::Parts(parts);
            *message = Arc::new(next);
            changed = true;
        }
    }
    Ok(if changed {
        Arc::new(rewritten)
    } else {
        request
    })
}
struct Auxiliary(Shared);
impl CompleteAuxiliary for Auxiliary {
    fn complete(
        &self,
        model: ModelId,
        request: AuxiliaryRequest,
        cancel: CancellationToken,
    ) -> Pin<
        Box<dyn std::future::Future<Output = Result<AuxiliaryReply, AuxiliaryError>> + Send + '_>,
    > {
        Box::pin(async move {
            let state = ready(&self.0)?;
            if conversation(&state, &model)?.is_some() {
                return Err(AuxiliaryError {
                    code: AuxiliaryErrorCode::ModelUnavailable,
                    message: "Media models do not provide auxiliary text inference".into(),
                });
            }
            state.auxiliary.0.complete(model, request, cancel).await
        })
    }
}
struct MediaRequest {
    session: String,
}
impl PrepareContext for MediaRequest {
    fn prepare(
        &self,
        request: Arc<ModelRequest>,
        source: ContextSource,
        _cancel: CancellationToken,
    ) -> HostFuture<'_, Arc<ModelRequest>> {
        Box::pin(async move { Ok(stamp(&self.session, &source, request)) })
    }
}
pub(crate) fn stamp(
    session: &str,
    source: &ContextSource,
    request: Arc<ModelRequest>,
) -> Arc<ModelRequest> {
    let mut next = (*request).clone();
    let metadata = next.metadata.get_or_insert_with(Default::default);
    metadata.session_id = Some(session.to_owned());
    metadata.turn_id = Some(source.turn_id.clone());
    metadata
        .extensions
        .insert("requestId".into(), json!(source.request_id));
    Arc::new(next)
}

struct MediaContext(Shared);
impl ResolveContextModel for MediaContext {
    fn resolve(
        &self,
        request: Arc<ModelRequest>,
        cancel: CancellationToken,
    ) -> HostFuture<'_, Arc<dyn ContextModel>> {
        Box::pin(async move {
            let base = ProductContextModel
                .resolve(request.clone(), cancel.clone())
                .await?;
            let state = ready(&self.0)?;
            if conversation(
                &state,
                &ModelId {
                    provider_id: request.provider_id.clone(),
                    model_id: request.model_id.clone(),
                },
            )?
            .is_none()
                || !request.metadata.as_ref().is_some_and(|meta| {
                    meta.session_id.is_some()
                        && meta.turn_id.is_some()
                        && meta.extensions.contains_key("requestId")
                })
            {
                return Ok(base);
            }
            // Media endpoints receive the consumed operator input, not the
            // conversational history. Preserve that history in the native owner.
            let source = input(&state, &request, &cancel).await?;
            let mut measured = (*request).clone();
            measured.system = None;
            measured.tools = None;
            measured.messages.clear();
            let parts = source
                .content
                .into_iter()
                .map(|block| match block {
                    ContentBlock::Text { text } => MessagePart::Text {
                        provider_metadata: None,
                        text,
                        start_time: None,
                        end_time: None,
                    },
                    ContentBlock::Image { source } => MessagePart::Image { source },
                })
                .collect();
            measured.messages.push(Arc::new(Message {
                role: Role::User,
                content: MessageContent::Parts(parts),
            }));
            let tokens = base.count_tokens(&measured);
            Ok(Arc::new(MediaWindow { base, tokens }) as Arc<dyn ContextModel>)
        })
    }
}
struct MediaWindow {
    base: Arc<dyn ContextModel>,
    tokens: f64,
}
impl ContextModel for MediaWindow {
    fn context_window(&self) -> f64 {
        self.base.context_window()
    }
    fn output_tokens(&self) -> f64 {
        self.base.output_tokens()
    }
    fn threshold_tokens(&self) -> f64 {
        self.base.threshold_tokens()
    }
    fn count_tokens(&self, _: &ModelRequest) -> f64 {
        self.tokens
    }
}
