//! Product presentation metadata is a namespaced, non-context extension fact.
//! Only dim's Branch facade can admit the associated user input.
use dim_agent_capabilities::{
    agent_loop::AgentLoop,
    input_queue::{InputQueue, Withdrawal},
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{
    AgentBuilder, BRANCH_GROUP, Feature, LoopPhase, LoopState, Names, PublicService, Timeline,
};
use dim_agent_types::{EventKind, ExtensionEvent, InputMessageData, InputMode, InputWithdrawData};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};

pub fn install(builder: &mut AgentBuilder) {
    dim_agent_runtime::names::register::<DeepChatInputMetadata>(
        builder.catalog_mut(),
        Some(BRANCH_GROUP),
    );
    builder.require_feature(
        Feature::new("DeepChatInputs")
            .branch("DeepChatInputMetadata", |names| {
                Ok(Box::new(InputMetadataPlugin {
                    timeline: names.key()?,
                    metadata: names.key()?,
                }))
            })
            .session("DeepChatInputs", |names| Ok(Box::new(Inputs::new(names)?))),
    );
}

pub(crate) struct DeepChatInputMetadata {
    pub(crate) timeline: Arc<Timeline>,
    pub(crate) lane: Mutex<()>,
    pub(crate) legacy_source: OnceCell<Option<(Vec<Value>, u64)>>,
}
impl PublicService for DeepChatInputMetadata {}
struct InputMetadataPlugin {
    timeline: Key<Timeline>,
    metadata: Key<DeepChatInputMetadata>,
}
impl DynPlugin for InputMetadataPlugin {
    fn name(&self) -> &str {
        "DeepChatInputMetadata"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.timeline.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            ctx.provide_at(
                self.metadata.clone(),
                Arc::new(DeepChatInputMetadata {
                    timeline: ctx.require_at(&self.timeline)?,
                    lane: Mutex::new(()),
                    legacy_source: OnceCell::new(),
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
struct Inputs {
    tree: Key<TreeCommands>,
    methods: Key<SessionMethods>,
}
impl Inputs {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tree: names.key()?,
            methods: names.key()?,
        })
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Submit {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
    input: InputMessageData,
    representation: Option<Value>,
    max_provider_rounds: Option<std::num::NonZeroU64>,
    reuse_user_message: Option<ReuseUserMessage>,
    legacy_draft: Option<crate::legacy_queue::DraftRef>,
    #[serde(default)]
    require_idle: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StopTurn {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
    turn_id: String,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelSubmission {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
    submission_id: String,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IsBusy {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
}

async fn has_busy_timeline_activity(metadata: &DeepChatInputMetadata) -> Result<bool, RpcError> {
    let active_turn = crate::facts::and(vec![
        crate::facts::equal("kind", json!("turn/start")),
        json!({"op":"not","condition":{"op":"exists","condition":crate::facts::and(vec![
            crate::facts::equal("kind", json!("turn/end")),
            json!({"op":"compare","left":crate::facts::field("data.turn_id"),"comparison":"eq","right":{"kind":"outer","path":"data.turn_id"}})
        ])}}),
    ]);
    let pending_input = crate::facts::and(vec![
        crate::facts::equal("kind", json!("input/message")),
        json!({"op":"not","condition":{"op":"present","value":crate::facts::field("data.handover")}}),
        json!({"op":"not","condition":{"op":"exists","condition":crate::facts::and(vec![
            crate::facts::one_of("kind", json!(["input/consumed","input/deleted"])),
            json!({"op":"compare","left":crate::facts::field("data.input_id"),"comparison":"eq","right":{"kind":"outer","path":"id"}})
        ])}}),
    ]);
    let busy_events = crate::facts::events(
        &metadata.timeline,
        json!({"op":"or","conditions":[active_turn, pending_input]}),
    )
    .await?;
    Ok(busy_events.iter().any(|event| match &event.kind {
        EventKind::TurnStart(_) => true,
        EventKind::InputMessage(input) => input.effective_mode() != InputMode::Append,
        _ => false,
    }))
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReuseUserMessage {
    message_id: String,
    order_seq: u64,
    created_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Retire {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
    operation_id: String,
    #[serde(default)]
    require_empty_queue: bool,
}
pub(crate) async fn ensure_active(metadata: &DeepChatInputMetadata) -> Result<(), RpcError> {
    if !crate::facts::events(
        &metadata.timeline,
        crate::facts::extension("session-retired"),
    )
    .await?
    .is_empty()
    {
        return Err(RpcError::service(
            "session_retired",
            "This native generation no longer admits product input",
        ));
    }
    Ok(())
}

pub(crate) fn validate_representation(value: &Value) -> Result<(), RpcError> {
    let valid = value.get("text").is_some_and(Value::is_string)
        && value.get("search").is_some_and(Value::is_boolean)
        && value.get("think").is_some_and(Value::is_boolean)
        && value
            .get("links")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().all(Value::is_string))
        && value
            .get("files")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.iter().all(|file| {
                    file.get("name").is_some_and(Value::is_string)
                        && file.get("path").is_some_and(Value::is_string)
                })
            });
    if !valid {
        return Err(RpcError::invalid("Invalid product input representation"));
    }
    Ok(())
}
impl DynPlugin for Inputs {
    fn name(&self) -> &str {
        "DeepChatInputs"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.tree.erase(), self.methods.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tree = ctx.require_at(&self.tree)?;
            ctx.require_at(&self.methods)?.register(ctx, "session.deepchat_inputs", vec![
                MethodDecl::new("session.deepchat_inputs.submit", true, Interruption::Drain),
                MethodDecl::new("session.deepchat_inputs.retire", true, Interruption::Drain),
                MethodDecl::new("session.deepchat_inputs.stop_turn", true, Interruption::Report),
                MethodDecl::new("session.deepchat_inputs.cancel_submission", true, Interruption::Drain),
                MethodDecl::new("session.deepchat_inputs.is_busy", false, Interruption::Report)
            ], Arc::new(move |call, _cancel, _| {
                let tree = tree.clone();
                Box::pin(async move {
                    if call.method.ends_with(".is_busy") {
                        let value: IsBusy = params(call.params)?;
                        let branch = tree.get(&value.branch_id)?;
                        let metadata = branch.service::<DeepChatInputMetadata>()?;
                        let _lane = metadata.lane.lock().await;
                        let busy = has_busy_timeline_activity(&metadata).await?
                            || branch.service::<AgentLoop>()?.state().phase != LoopPhase::Idle;
                        return reply(json!({ "busy": busy }));
                    }
                    if call.method.ends_with(".cancel_submission") {
                        let value: CancelSubmission = params(call.params)?;
                        if value.submission_id.is_empty() {
                            return Err(RpcError::invalid("Submission identity is required"));
                        }
                        let branch = tree.get(&value.branch_id)?;
                        let metadata = branch.service::<DeepChatInputMetadata>()?;
                        let _lane = metadata.lane.lock().await;
                        let Some(input_event) = branch.lookup(&value.submission_id).await? else {
                            return reply(json!({ "cancelled": false }));
                        };
                        let reason = value
                            .reason
                            .filter(|r| !r.trim().is_empty())
                            .unwrap_or_else(|| "Stopped by submission cancel".to_owned());
                        let withdrawal = branch
                            .service::<InputQueue>()?
                            .withdraw(InputWithdrawData {
                                input_id: input_event.id.clone(),
                                reason: Some(reason.clone()),
                                steer: None,
                            })
                            .await?;
                        if matches!(withdrawal.0, Withdrawal::Deleted { .. }) {
                            return reply(json!({ "cancelled": true }));
                        }
                        let initial_transitions = crate::facts::events(
                            &metadata.timeline,
                            crate::facts::and(vec![
                                crate::facts::one_of(
                                    "kind",
                                    json!(["input/applied", "input/consumed", "input/deleted"]),
                                ),
                                crate::facts::equal("data.input_id", json!(input_event.id)),
                            ]),
                        )
                        .await?;
                        if initial_transitions
                            .iter()
                            .any(|event| matches!(&event.kind, EventKind::InputDeleted(_)))
                        {
                            return reply(json!({ "cancelled": true }));
                        }
                        let agent_loop = branch.service::<AgentLoop>()?;
                        if !initial_transitions
                            .iter()
                            .any(|event| matches!(&event.kind, EventKind::InputConsumed(_)))
                            && let Some(applied_seq) =
                                initial_transitions.iter().find_map(|event| match &event.kind {
                                    EventKind::InputApplied(_) => Some(event.sequence),
                                    _ => None,
                                })
                        {
                            agent_loop.wait_dispatched(applied_seq).await?;
                        }
                        if let Some(deleted_seq) =
                            agent_loop.cancel_applied_input(&input_event.id)?
                        {
                            crate::facts::published(&metadata.timeline, deleted_seq).await?;
                            return reply(json!({ "cancelled": true }));
                        }
                        let transitions = crate::facts::events(
                            &metadata.timeline,
                            crate::facts::and(vec![
                                crate::facts::one_of(
                                    "kind",
                                    json!(["input/consumed", "input/deleted"]),
                                ),
                                crate::facts::equal("data.input_id", json!(input_event.id)),
                            ]),
                        )
                        .await?;
                        if transitions
                            .iter()
                            .any(|event| matches!(&event.kind, EventKind::InputDeleted(_)))
                        {
                            return reply(json!({ "cancelled": true }));
                        }
                        let Some(consumed_seq) =
                            transitions.iter().find_map(|event| match &event.kind {
                                EventKind::InputConsumed(_) => Some(event.sequence),
                                _ => None,
                            })
                        else {
                            return reply(json!({ "cancelled": false }));
                        };
                        let active_turns = crate::facts::events(
                            &metadata.timeline,
                            crate::facts::and(vec![
                                crate::facts::equal("kind", json!("turn/start")),
                                json!({"op":"not","condition":{"op":"exists","condition":crate::facts::and(vec![
                                    crate::facts::equal("kind", json!("turn/end")),
                                    json!({"op":"compare","left":crate::facts::field("data.turn_id"),"comparison":"eq","right":{"kind":"outer","path":"data.turn_id"}})
                                ])}}),
                            ]),
                        )
                        .await?;
                        let target_turn_id = active_turns
                            .iter()
                            .filter(|event| event.sequence < consumed_seq)
                            .max_by_key(|event| event.sequence)
                            .and_then(|event| match &event.kind {
                                EventKind::TurnStart(data) => Some(data.turn_id.clone()),
                                _ => None,
                            });
                        let stopped = match target_turn_id {
                            Some(turn_id) => agent_loop.stop_turn(&turn_id, reason)?.is_some(),
                            None => false,
                        };
                        return reply(json!({ "cancelled": stopped }));
                    }
                    if call.method.ends_with(".stop_turn") {
                        let value: StopTurn = params(call.params)?;
                        if value.turn_id.is_empty() {
                            return Err(RpcError::invalid("Turn identity is required"));
                        }
                        let branch = tree.get(&value.branch_id)?;
                        let reason = value
                            .reason
                            .filter(|r| !r.trim().is_empty())
                            .unwrap_or_else(|| "Stopped by turn cancel".to_owned());
                        let sequence = branch
                            .service::<AgentLoop>()?
                            .stop_turn(&value.turn_id, reason)?;
                        return reply(json!({
                            "stopped": sequence.is_some(),
                            "sequence": sequence.map(|seq| seq.to_string())
                        }));
                    }
                    if call.method.ends_with(".retire") {
                        let value:Retire=params(call.params)?;
                        if value.operation_id.is_empty() || value.operation_id.len()>64 || !value.operation_id.bytes().all(|byte|byte.is_ascii_alphanumeric()||byte==b'-') {return Err(RpcError::invalid("Invalid retirement identity"));}
                        let branch=tree.get(&value.branch_id)?;
                        let metadata=branch.service::<DeepChatInputMetadata>()?;
                        let _lane=metadata.lane.lock().await;
                        if let Some(event)=crate::facts::events(&metadata.timeline,crate::facts::extension("session-retired")).await?.first() {
                            let EventKind::Extension(extension)=&event.kind else{unreachable!()};
                            if extension.data()["operationId"]!=value.operation_id {return Err(RpcError::service("session_retired","Native generation was retired by another operation"));}
                            crate::facts::published(&metadata.timeline,event.sequence).await?;
                            return reply(json!({"retired":true,"sequence":event.sequence.to_string()}));
                        }
                        crate::queue::recover(&tree,&value.branch_id,&metadata).await?;
                        if value.require_empty_queue && crate::queue::pending(&metadata).await?.iter().any(|event| {
                            matches!(&event.kind, EventKind::InputMessage(input) if input.effective_mode() != InputMode::Append)
                        }) {
                            return Err(RpcError::service("input_blocked","Finish or remove queued input before changing native generation"));
                        }
                        let event=metadata.timeline.append(EventKind::Extension(ExtensionEvent::new("deepchat","session-retired",json!({"operationId":value.operation_id})).map_err(RpcError::invalid)?).into())?;
                        crate::facts::published(&metadata.timeline,event.sequence).await?;
                        return reply(json!({"retired":true,"sequence":event.sequence.to_string()}));
                    }
                    let value: Submit = params(call.params)?;
                    let submission = value.input.submission_id.as_deref().filter(|id| !id.is_empty())
                        .ok_or_else(|| RpcError::invalid("Submission identity is required"))?.to_owned();
                    if let Some(representation)=&value.representation {validate_representation(representation)?;}
                    if value.max_provider_rounds.is_some() && (value.input.effective_mode() != InputMode::Queue || value.representation.is_none()) {
                        return Err(RpcError::invalid("A provider round limit requires a queued product message"));
                    }
                    if let Some(reuse)=&value.reuse_user_message {
                        if reuse.message_id.is_empty() || reuse.message_id.len()>2048 || reuse.order_seq==0
                            || reuse.order_seq>=9_007_199_254_740_991 || reuse.created_at>9_007_199_254_740_991
                            || value.representation.is_none() || value.input.user.is_none() {
                            return Err(RpcError::invalid("Invalid retried product message identity"));
                        }
                    }
                    value.input.validate().map_err(RpcError::invalid)?;
                    if value.input.handover.is_some() { return Err(RpcError::invalid("Product input cannot address a handover")); }
                    let branch = tree.get(&value.branch_id)?;
                    let metadata = branch.service::<DeepChatInputMetadata>()?;
                    let _lane = metadata.lane.lock().await;
                    if let Some(event) = branch.lookup(&submission).await? {
                        return reply(json!({"inputId": event.id, "sequence": event.sequence}));
                    }
                    ensure_active(&metadata).await?;
                    crate::queue::recover(&tree, &value.branch_id, &metadata).await?;
                    if value.require_idle {
                        let busy = has_busy_timeline_activity(&metadata).await?
                            || branch.service::<AgentLoop>()?.state().phase != LoopPhase::Idle;
                        if busy {
                            return Err(RpcError::service(
                                "session_busy",
                                "Session is currently busy",
                            ));
                        }
                    }
                    crate::migration::check_ready(&metadata).await?;
                    if let Some(draft) = &value.legacy_draft { crate::legacy_queue::check(&metadata, draft).await?; }
                    crate::migration::restore_context(&branch, &metadata, value.reuse_user_message.as_ref().map(|reuse| reuse.message_id.as_str())).await?;
                    if let Some(representation)=value.representation {metadata.timeline.append(EventKind::Extension(ExtensionEvent::new(
                        "deepchat", "input-representation", json!({"submissionId": submission, "content": representation, "reuseUserMessage": value.reuse_user_message, "legacyDraft":value.legacy_draft})
                    ).map_err(RpcError::invalid)?).into())?;}
                    if let Some(limit)=value.max_provider_rounds {
                        crate::facts::append(&metadata.timeline, "provider-round-limit", json!({"submissionId":submission,"limit":limit}))?;
                    }
                    let event = match branch.input(value.input).await {
                        Ok(event) => event,
                        Err(error) => {
                            let _ = metadata.timeline.append(EventKind::Extension(ExtensionEvent::new(
                                "deepchat", "input-rejected", json!({"submissionId": submission})
                            ).map_err(RpcError::invalid)?).into());
                            return Err(error.into());
                        }
                    };
                    if let Some(reuse) = value.reuse_user_message {
                        crate::facts::append(&metadata.timeline, "context-restored", json!({"messageId":reuse.message_id}))?;
                    }
                    reply(json!({"inputId": event.id, "sequence": event.sequence}))
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dim_agent_capabilities::{
        adapters::{DefaultPrepareModelPlugin, EchoModel, MockTools},
        defaults,
        history::HistoryRenderer,
        host::{
            CompactionStrategyHost, ContextModelHost, ContextSource, HostFuture, ModelChunk,
            ModelConnection, ModelDriver, ModelHost, ModelStopReason, ModelStream, PrepareContext,
            PrepareContextHost, ToolHost,
        },
    };
    use dim_agent_runtime::{
        AgentConfig, Session, SessionConfig,
        testing::{MinimalHost, branch_events},
    };
    use dim_agent_types::{AgentEvent, ModelRequest, TurnEndData, TurnOutcome};
    use std::{
        collections::VecDeque,
        sync::Mutex as StdMutex,
        time::Duration,
    };
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    struct NoopPrepare;
    impl PrepareContext for NoopPrepare {
        fn prepare(
            &self,
            request: Arc<ModelRequest>,
            _: ContextSource,
            _: CancellationToken,
        ) -> HostFuture<'_, Arc<ModelRequest>> {
            Box::pin(async move { Ok(request) })
        }
    }

    async fn soon<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::time::timeout(Duration::from_secs(5), future)
            .await
            .expect("test future timed out")
    }

    struct HoldGate {
        started: Notify,
        release: Notify,
    }

    #[derive(Default)]
    struct ScriptedModel {
        gates: StdMutex<VecDeque<Arc<HoldGate>>>,
    }

    impl ScriptedModel {
        fn hold_next(&self) -> Arc<HoldGate> {
            let gate = Arc::new(HoldGate {
                started: Notify::new(),
                release: Notify::new(),
            });
            self.gates.lock().unwrap().push_back(gate.clone());
            gate
        }
    }

    impl ModelDriver for ScriptedModel {
        fn invoke(
            &self,
            request: Arc<ModelRequest>,
            connection: ModelConnection,
            cancel: CancellationToken,
        ) -> HostFuture<'_, ModelStream> {
            let gate = self.gates.lock().unwrap().pop_front();
            Box::pin(async move {
                let Some(gate) = gate else {
                    return EchoModel.invoke(request, connection, cancel).await;
                };
                let stream = futures_util::stream::unfold(
                    (0u8, gate, cancel),
                    |(step, gate, cancel)| async move {
                        match step {
                            0 => Some((
                                Ok(ModelChunk::MessageStart {
                                    message_id: "held-msg".into(),
                                }),
                                (1, gate, cancel),
                            )),
                            1 => {
                                gate.started.notify_one();
                                tokio::select! {
                                    _ = gate.release.notified() => Some((
                                        Ok(ModelChunk::Text("done".into())),
                                        (2, gate, cancel),
                                    )),
                                    _ = cancel.cancelled() => None,
                                }
                            }
                            2 => Some((
                                Ok(ModelChunk::MessageStop {
                                    message_id: "held-msg".into(),
                                    reason: ModelStopReason::EndTurn,
                                }),
                                (3, gate, cancel),
                            )),
                            _ => None,
                        }
                    },
                );
                Ok(Box::pin(stream) as ModelStream)
            })
        }
    }

    async fn setup_session() -> (MinimalHost, Session, Arc<ScriptedModel>) {
        let model = Arc::new(ScriptedModel::default());
        let mut builder = AgentBuilder::new(AgentConfig::default());
        builder
            .session_value(Arc::new(HistoryRenderer::default()))
            .process_value(Arc::new(ModelHost(model.clone())))
            .session_value(Arc::new(ToolHost(Arc::new(MockTools))))
            .session_value(Arc::new(PrepareContextHost(Arc::new(NoopPrepare))))
            .session_value(Arc::new(ContextModelHost(None)))
            .session_value(Arc::new(CompactionStrategyHost(None)))
            .require_feature(
                Feature::new("PrepareModelHost").session("PrepareModelHost", |names| {
                    Ok(Box::new(DefaultPrepareModelPlugin::new(names)?))
                }),
            );
        defaults::install(&mut builder);
        install(&mut builder);
        let agent = MinimalHost::start(&builder).await.unwrap();
        let session = soon(agent.create_session(SessionConfig::default()))
            .await
            .unwrap();
        (agent, session, model)
    }

    async fn call_method(
        session: &Session,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let provider = session
            .session_service::<SessionMethods>()
            .unwrap()
            .provider(method)
            .unwrap();
        let accepted = provider
            .accept(
                method.into(),
                params,
                None,
                CancellationToken::new(),
                |_| {},
            )
            .unwrap();
        soon(accepted.reply).await.unwrap()
    }

    fn submit_params(
        session: &Session,
        submission_id: &str,
        text: &str,
        mode: InputMode,
        require_idle: bool,
    ) -> Value {
        let mut input = InputMessageData::text(text, Some(mode));
        input.submission_id = Some(submission_id.to_owned());
        json!({
            "sessionId": session.id(),
            "branchId": "main",
            "input": input,
            "requireIdle": require_idle
        })
    }

    async fn wait_for_event<F>(session: &Session, predicate: F) -> Arc<AgentEvent>
    where
        F: Fn(&AgentEvent) -> bool,
    {
        for _ in 0..500 {
            let existing = branch_events(session, "main", ..).await.unwrap();
            if let Some(found) = existing.into_iter().find(|event| predicate(event)) {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("expected timeline event was not committed");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_submission_cancels_queued_input_and_is_idempotent() {
        let (_host, session, model) = setup_session().await;
        let gate1 = model.hold_next();

        call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-1", "first", InputMode::Queue, false),
        )
        .await
        .unwrap();
        soon(gate1.started.notified()).await;

        let queued = call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-2", "second", InputMode::Queue, false),
        )
        .await
        .unwrap();
        let queued_input_id = queued["inputId"].as_str().unwrap().to_owned();

        let first_cancel = call_method(
            &session,
            "session.deepchat_inputs.cancel_submission",
            json!({
                "sessionId": session.id(),
                "branchId": "main",
                "submissionId": "sub-2",
                "reason": "timeout"
            }),
        )
        .await
        .unwrap();
        assert_eq!(first_cancel["cancelled"], json!(true));

        let second_cancel = call_method(
            &session,
            "session.deepchat_inputs.cancel_submission",
            json!({
                "sessionId": session.id(),
                "branchId": "main",
                "submissionId": "sub-2"
            }),
        )
        .await
        .unwrap();
        assert_eq!(second_cancel["cancelled"], json!(true));

        gate1.release.notify_one();
        wait_for_event(&session, |event| matches!(event.kind, EventKind::TurnEnd(_))).await;

        let events = branch_events(&session, "main", ..).await.unwrap();
        assert!(events.iter().any(|event| matches!(
            &event.kind,
            EventKind::InputDeleted(data) if data.input_id == queued_input_id
        )));
        assert!(!events.iter().any(|event| matches!(
            &event.kind,
            EventKind::InputConsumed(data) if data.input_id == queued_input_id
        )));
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event.kind, EventKind::TurnStart(_)))
                .count(),
            1
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_submission_cancels_applied_unconsumed_input() {
        let (_host, session, model) = setup_session().await;
        let gate1 = model.hold_next();

        call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-1", "first", InputMode::Queue, false),
        )
        .await
        .unwrap();
        soon(gate1.started.notified()).await;

        let applied = call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-append", "extra", InputMode::Append, false),
        )
        .await
        .unwrap();
        let applied_input_id = applied["inputId"].as_str().unwrap().to_owned();

        wait_for_event(&session, |event| matches!(
            &event.kind,
            EventKind::InputApplied(data) if data.input_id == applied_input_id
        ))
        .await;

        let cancel = call_method(
            &session,
            "session.deepchat_inputs.cancel_submission",
            json!({
                "sessionId": session.id(),
                "branchId": "main",
                "submissionId": "sub-append",
                "reason": "timeout"
            }),
        )
        .await
        .unwrap();
        assert_eq!(cancel["cancelled"], json!(true));

        gate1.release.notify_one();
        wait_for_event(&session, |event| matches!(event.kind, EventKind::TurnEnd(_))).await;

        let events = branch_events(&session, "main", ..).await.unwrap();
        assert!(events.iter().any(|event| matches!(
            &event.kind,
            EventKind::InputDeleted(data) if data.input_id == applied_input_id
        )));
        assert!(!events.iter().any(|event| matches!(
            &event.kind,
            EventKind::InputConsumed(data) if data.input_id == applied_input_id
        )));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancel_submission_stops_consumed_turn_without_affecting_later_turn() {
        let (_host, session, model) = setup_session().await;
        let gate1 = model.hold_next();
        let gate2 = model.hold_next();

        let first = call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-1", "first", InputMode::Queue, false),
        )
        .await
        .unwrap();
        let first_input_id = first["inputId"].as_str().unwrap().to_owned();
        soon(gate1.started.notified()).await;
        wait_for_event(&session, |event| matches!(
            &event.kind,
            EventKind::InputConsumed(data) if data.input_id == first_input_id
        ))
        .await;

        let cancel1 = call_method(
            &session,
            "session.deepchat_inputs.cancel_submission",
            json!({
                "sessionId": session.id(),
                "branchId": "main",
                "submissionId": "sub-1",
                "reason": "cron timeout"
            }),
        )
        .await
        .unwrap();
        assert_eq!(cancel1["cancelled"], json!(true));

        let turn1_end = wait_for_event(&session, |event| matches!(
            &event.kind,
            EventKind::TurnEnd(TurnEndData {
                outcome: TurnOutcome::Cancelled { .. },
                ..
            })
        ))
        .await;
        let turn1_id = match &turn1_end.kind {
            EventKind::TurnEnd(data) => data.turn_id.clone(),
            _ => unreachable!(),
        };

        // Subsequent user turn starts while a stale cancel for sub-1 arrives.
        call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-2", "user follow-up", InputMode::Queue, false),
        )
        .await
        .unwrap();
        soon(gate2.started.notified()).await;

        let stale_cancel = call_method(
            &session,
            "session.deepchat_inputs.cancel_submission",
            json!({
                "sessionId": session.id(),
                "branchId": "main",
                "submissionId": "sub-1"
            }),
        )
        .await
        .unwrap();
        assert_eq!(stale_cancel["cancelled"], json!(false));

        gate2.release.notify_one();
        let turn2_end = wait_for_event(&session, |event| matches!(
            &event.kind,
            EventKind::TurnEnd(data) if data.turn_id != turn1_id
        ))
        .await;
        assert!(matches!(
            turn2_end.kind,
            EventKind::TurnEnd(TurnEndData {
                outcome: TurnOutcome::Completed { .. },
                ..
            })
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn require_idle_rejects_concurrent_and_busy_then_admits_once_idle() {
        let (_host, session, model) = setup_session().await;
        let gate1 = model.hold_next();

        let (res_a, res_b) = tokio::join!(
            call_method(
                &session,
                "session.deepchat_inputs.submit",
                submit_params(&session, "sub-a", "run a", InputMode::Queue, true),
            ),
            call_method(
                &session,
                "session.deepchat_inputs.submit",
                submit_params(&session, "sub-b", "run b", InputMode::Queue, true),
            )
        );
        let results = [res_a, res_b];
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        let rejected = results
            .iter()
            .find_map(|r| r.as_ref().err())
            .expect("second concurrent require_idle submit should fail");
        assert_eq!(
            rejected.data.as_ref().map(|d| d.app_error.as_str()),
            Some("session_busy")
        );

        soon(gate1.started.notified()).await;
        let busy_status = call_method(
            &session,
            "session.deepchat_inputs.is_busy",
            json!({ "sessionId": session.id(), "branchId": "main" }),
        )
        .await
        .unwrap();
        assert_eq!(busy_status["busy"], json!(true));

        let while_running = call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-c", "run c", InputMode::Queue, true),
        )
        .await
        .expect_err("require_idle must reject while turn is running");
        assert_eq!(
            while_running.data.as_ref().map(|d| d.app_error.as_str()),
            Some("session_busy")
        );

        gate1.release.notify_one();
        wait_for_event(&session, |event| matches!(event.kind, EventKind::TurnEnd(_))).await;

        let mut became_idle = false;
        for _ in 0..50 {
            let idle_status = call_method(
                &session,
                "session.deepchat_inputs.is_busy",
                json!({ "sessionId": session.id(), "branchId": "main" }),
            )
            .await
            .unwrap();
            if idle_status["busy"] == json!(false) {
                became_idle = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(became_idle, "branch should report idle after turn ends");

        let admitted = call_method(
            &session,
            "session.deepchat_inputs.submit",
            submit_params(&session, "sub-d", "run d", InputMode::Queue, true),
        )
        .await;
        assert!(admitted.is_ok());
    }
}
