//! Product presentation metadata is a namespaced, non-context extension fact.
//! Only dim's Branch facade can admit the associated user input.
use dim_agent_capabilities::{
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, BRANCH_GROUP, Feature, Names, PublicService, Timeline};
use dim_agent_types::{EventKind, ExtensionEvent, InputMessageData};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;

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

struct DeepChatInputMetadata {
    timeline: Arc<Timeline>,
    lane: Mutex<()>,
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
    representation: Value,
}

fn validate_representation(value: &Value) -> Result<(), RpcError> {
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
                MethodDecl::new("session.deepchat_inputs.submit", true, Interruption::Drain)
            ], Arc::new(move |call, _cancel, _| {
                let tree = tree.clone();
                Box::pin(async move {
                    let value: Submit = params(call.params)?;
                    let submission = value.input.submission_id.as_deref().filter(|id| !id.is_empty())
                        .ok_or_else(|| RpcError::invalid("Submission identity is required"))?.to_owned();
                    validate_representation(&value.representation)?;
                    value.input.validate().map_err(RpcError::invalid)?;
                    if value.input.handover.is_some() { return Err(RpcError::invalid("Product input cannot address a handover")); }
                    let branch = tree.get(&value.branch_id)?;
                    let metadata = branch.service::<DeepChatInputMetadata>()?;
                    let _lane = metadata.lane.lock().await;
                    if let Some(event) = branch.lookup(&submission).await? {
                        return reply(json!({"inputId": event.id, "sequence": event.sequence}));
                    }
                    metadata.timeline.append(EventKind::Extension(ExtensionEvent::new(
                        "deepchat", "input-representation", json!({"submissionId": submission, "content": value.representation})
                    ).map_err(RpcError::invalid)?).into())?;
                    let event = match branch.input(value.input).await {
                        Ok(event) => event,
                        Err(error) => {
                            let _ = metadata.timeline.append(EventKind::Extension(ExtensionEvent::new(
                                "deepchat", "input-rejected", json!({"submissionId": submission})
                            ).map_err(RpcError::invalid)?).into());
                            return Err(error.into());
                        }
                    };
                    reply(json!({"inputId": event.id, "sequence": event.sequence}))
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
