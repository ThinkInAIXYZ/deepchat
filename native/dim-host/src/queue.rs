//! Desktop queue controls. InputQueue still owns release/withdrawal and Branch owns admission.
//! The journal only completes an interrupted edit/reorder; it never drives turns.
use crate::inputs::{DeepChatInputMetadata, validate_representation};
use dim_agent_capabilities::{
    input_queue::{InputQueue, Withdrawal},
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, Feature, Names, QueryOutput, Timeline, TimelineQuery};
use dim_agent_types::{
    AgentEvent, EventKind, ExtensionEvent, InputMessageData, InputMode, InputWithdrawData,
};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::Duration,
};

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(
        Feature::new("DeepChatQueue")
            .branch("DeepChatQueueRecovery", |names| {
                Ok(Box::new(Recovery {
                    metadata: names.key()?,
                    queue: names.key()?,
                    tree: names.key()?,
                }))
            })
            .session("DeepChatQueueMethods", |names| {
                Ok(Box::new(Methods::new(names)?))
            }),
    );
}

fn invalid(message: &str) -> RpcError {
    RpcError::invalid(message)
}
fn conflict() -> RpcError {
    RpcError::service(
        "queue_changed",
        "The native queue changed; refresh before editing",
    )
}
fn field(path: &str) -> Value {
    json!({"kind":"field", "path":path})
}
fn equal(path: &str, value: Value) -> Value {
    json!({"op":"compare", "left":field(path), "comparison":"eq", "right":{"kind":"value","value":value}})
}
fn one_of(path: &str, values: Value) -> Value {
    json!({"op":"in","value":field(path),"values":values})
}
fn and(conditions: Vec<Value>) -> Value {
    json!({"op":"and","conditions":conditions})
}
async fn events(timeline: &Timeline, filter: Value) -> Result<Vec<Arc<AgentEvent>>, RpcError> {
    let mut query: TimelineQuery = serde_json::from_value(json!({
        "scope":"branch", "through":timeline.committed(), "include_publishing":true,
        "query":{"filter":filter,"select":{"kind":"events"}}, "page":{"limit":128}
    }))
    .map_err(|_| invalid("Invalid queue query"))?;
    let mut found = Vec::new();
    loop {
        let page = timeline.query(query.clone()).await?;
        let QueryOutput::Events { events } = page.result else {
            return Err(invalid("Queue query did not return events"));
        };
        found.extend(events.into_iter().map(|entry| entry.event));
        if found.len() > 4096 {
            return Err(invalid("Queue control read exceeds its bound"));
        }
        let Some(next) = page.next else {
            break;
        };
        query.page.as_mut().expect("paged queue query").after = Some(next);
    }
    Ok(found)
}
fn extension(name: &str) -> Value {
    equal("kind", json!(format!("deepchat/{name}")))
}
fn append(timeline: &Timeline, name: &str, data: Value) -> Result<(), RpcError> {
    timeline.append(
        EventKind::Extension(
            ExtensionEvent::new("deepchat", name, data).map_err(RpcError::invalid)?,
        )
        .into(),
    )?;
    Ok(())
}

/// A query projection of the native queue, including applied inputs until consumed.
async fn pending(metadata: &DeepChatInputMetadata) -> Result<Vec<Arc<AgentEvent>>, RpcError> {
    events(&metadata.timeline, and(vec![
        equal("kind", json!("input/message")),
        json!({"op":"not","condition":{"op":"present","value":field("data.handover")}}),
        json!({"op":"not","condition":{"op":"exists","condition":and(vec![
            one_of("kind", json!(["input/consumed","input/deleted"])),
            json!({"op":"compare","left":field("data.input_id"),"comparison":"eq","right":{"kind":"outer","path":"id"}})
        ])}})
    ])).await
}
async fn transitions(
    metadata: &DeepChatInputMetadata,
    ids: &[String],
) -> Result<Vec<Arc<AgentEvent>>, RpcError> {
    events(
        &metadata.timeline,
        and(vec![
            one_of(
                "kind",
                json!(["input/applied", "input/deleted", "input/withdraw"]),
            ),
            one_of("data.input_id", json!(ids)),
        ]),
    )
    .await
}
async fn representations(
    metadata: &DeepChatInputMetadata,
    inputs: &[Arc<AgentEvent>],
) -> Result<BTreeMap<String, Value>, RpcError> {
    let submissions: Vec<_> = inputs
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::InputMessage(data) => data.submission_id.clone(),
            _ => None,
        })
        .collect();
    if submissions.is_empty() {
        return Ok(BTreeMap::new());
    }
    let facts = events(
        &metadata.timeline,
        and(vec![
            extension("input-representation"),
            one_of("data.submissionId", json!(submissions)),
        ]),
    )
    .await?;
    Ok(facts
        .into_iter()
        .filter_map(|event| match &event.kind {
            EventKind::Extension(data) => Some((
                data.data().get("submissionId")?.as_str()?.to_owned(),
                data.data().get("content")?.clone(),
            )),
            _ => None,
        })
        .collect())
}
async fn list(metadata: &DeepChatInputMetadata) -> Result<Value, RpcError> {
    let inputs = pending(metadata).await?;
    let ids: Vec<_> = inputs.iter().map(|event| event.id.clone()).collect();
    let applied: BTreeSet<_> = transitions(metadata, &ids)
        .await?
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::InputApplied(data) => Some(data.input_id.clone()),
            _ => None,
        })
        .collect();
    let representations = representations(metadata, &inputs).await?;
    Ok(json!({"inputs":inputs.iter().map(|event| {
        let EventKind::InputMessage(input) = &event.kind else { unreachable!() };
        json!({"inputId":event.id,"sequence":event.sequence.to_string(),"createdAt":event.create_at,
            "input":input,"applied":applied.contains(&event.id),
            "representation":input.submission_id.as_ref().and_then(|id|representations.get(id))})
    }).collect::<Vec<_>>()}))
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Replacement {
    input: InputMessageData,
    representation: Value,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plan {
    operation_id: String,
    sources: Vec<String>,
    order: Vec<String>,
    replacement: Option<Replacement>,
    #[serde(default)]
    steer: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
    plan: Plan,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct List {
    #[serde(rename = "sessionId")]
    _session_id: String,
    branch_id: String,
}

async fn journals(
    metadata: &DeepChatInputMetadata,
    operation: Option<&str>,
) -> Result<BTreeMap<String, (Plan, Option<Value>, Option<Value>)>, RpcError> {
    // Only unfinished operations are needed during recovery. An explicit id also returns its
    // settled result, making retrying this exact command safe after a disconnected response.
    let filter = if let Some(id) = operation {
        and(vec![
            one_of(
                "kind",
                json!([
                    "deepchat/queue-plan",
                    "deepchat/queue-ready",
                    "deepchat/queue-settled"
                ]),
            ),
            equal("data.operationId", json!(id)),
        ])
    } else {
        and(vec![
            one_of(
                "kind",
                json!(["deepchat/queue-plan", "deepchat/queue-ready"]),
            ),
            json!({"op":"not","condition":{"op":"exists","condition":and(vec![extension("queue-settled"),
                json!({"op":"compare","left":field("data.operationId"),"comparison":"eq","right":{"kind":"outer","path":"data.operationId"}})
            ])}}),
        ])
    };
    let mut map = BTreeMap::new();
    for event in events(&metadata.timeline, filter).await? {
        let EventKind::Extension(data) = &event.kind else {
            continue;
        };
        let Some(id) = data.data().get("operationId").and_then(Value::as_str) else {
            continue;
        };
        match data.name() {
            "queue-plan" => {
                let plan = serde_json::from_value(data.data().clone())
                    .map_err(|_| invalid("Invalid queue journal"))?;
                map.insert(id.to_owned(), (plan, None, None));
            }
            "queue-ready" => {
                if let Some(item) = map.get_mut(id) {
                    item.1 = Some(data.data().clone());
                }
            }
            "queue-settled" => {
                if let Some(item) = map.get_mut(id) {
                    item.2 = Some(data.data().clone());
                }
            }
            _ => {}
        }
    }
    Ok(map)
}

async fn finish(
    tree: &TreeCommands,
    branch_id: &str,
    metadata: &DeepChatInputMetadata,
    plan: &Plan,
    ready: Option<Value>,
) -> Result<Value, RpcError> {
    let branch = tree.get(branch_id)?;
    let source_events = events(&metadata.timeline, one_of("id", json!(plan.sources))).await?;
    let originals: BTreeMap<_, _> = source_events
        .iter()
        .map(|event| (event.id.clone(), event.clone()))
        .collect();
    if originals.len() != plan.sources.len() {
        return Err(invalid("Queue journal source is missing"));
    }
    let reason = format!("deepchat-queue:{}", plan.operation_id);
    let ready = if let Some(value) = ready {
        value
    } else {
        let previous = transitions(metadata, &plan.sources).await?;
        let mut withdrawn = Vec::new();
        let mut conflicted = false;
        let queue = branch.service::<InputQueue>()?;
        for id in &plan.sources {
            let already_requested = previous.iter().any(|event| matches!(&event.kind, EventKind::InputWithdraw(data) if data.input_id==*id && data.reason.as_deref()==Some(&reason)));
            let deleted = if already_requested {
                previous.iter().find_map(|event| match &event.kind { EventKind::InputWithdraw(data) if data.input_id==*id => Some(data.reason.as_deref()==Some(&reason)), _ => None }).unwrap_or(false) && previous.iter().any(|event|matches!(&event.kind, EventKind::InputDeleted(data) if data.input_id==*id))
            } else if !conflicted {
                matches!(
                    queue
                        .withdraw(
                            InputWithdrawData {
                                input_id: id.clone(),
                                reason: Some(reason.clone())
                            },
                            None
                        )
                        .await?
                        .0,
                    Withdrawal::Deleted { .. }
                )
            } else {
                false
            };
            if deleted {
                withdrawn.push(id.clone());
            } else {
                conflicted = true;
            }
        }
        let order = if conflicted {
            withdrawn
        } else {
            plan.order.clone()
        };
        let value = json!({"operationId":plan.operation_id,"order":order,"conflicted":conflicted});
        append(&metadata.timeline, "queue-ready", value.clone())?;
        value
    };
    let conflicted = ready
        .get("conflicted")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("Invalid queue recovery stage"))?;
    let order: Vec<String> = serde_json::from_value(ready["order"].clone())
        .map_err(|_| invalid("Invalid queue recovery order"))?;
    let reprs = representations(metadata, &source_events).await?;
    let mut inputs = Vec::new();
    for id in &order {
        let event = originals
            .get(id)
            .ok_or_else(|| invalid("Queue source does not exist"))?;
        let EventKind::InputMessage(original) = &event.kind else {
            return Err(invalid("Queue source is not an input"));
        };
        let replacement = (!conflicted && plan.sources.first() == Some(id))
            .then_some(plan.replacement.as_ref())
            .flatten();
        let mut input = replacement
            .map(|value| value.input.clone())
            .unwrap_or_else(|| original.clone());
        let representation = replacement
            .map(|value| value.representation.clone())
            .or_else(|| {
                original
                    .submission_id
                    .as_ref()
                    .and_then(|id| reprs.get(id))
                    .cloned()
            });
        let submission = format!("qop:{}:{id}", plan.operation_id);
        input.submission_id = Some(submission.clone());
        input.mode = Some(if plan.steer && !conflicted {
            InputMode::Steer
        } else {
            InputMode::Queue
        });
        if let Some(content) = representation {
            append(
                &metadata.timeline,
                "input-representation",
                json!({"submissionId":submission,"content":content}),
            )?;
        }
        inputs.push(input);
    }
    let receipts = if inputs.is_empty() {
        vec![]
    } else {
        branch.inputs(inputs).await?
    };
    let result = json!({"operationId":plan.operation_id,"conflicted":conflicted,
        "receipts":order.iter().zip(receipts.iter()).map(|(old,event)|json!({"previousId":old,"inputId":event.id,"sequence":event.sequence.to_string()})).collect::<Vec<_>>()});
    append(&metadata.timeline, "queue-settled", result.clone())?;
    Ok(result)
}
pub(crate) async fn recover(
    tree: &TreeCommands,
    branch_id: &str,
    metadata: &DeepChatInputMetadata,
) -> Result<(), RpcError> {
    for (_, (plan, ready, _)) in journals(metadata, None).await? {
        finish(tree, branch_id, metadata, &plan, ready).await?;
    }
    Ok(())
}
async fn mutate(
    tree: &TreeCommands,
    branch_id: &str,
    metadata: &DeepChatInputMetadata,
    plan: Plan,
) -> Result<Value, RpcError> {
    if plan.operation_id.is_empty()
        || plan.operation_id.len() > 64
        || !plan
            .operation_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(invalid("Invalid queue operation identity"));
    }
    if let Some((stored, ready, settled)) = journals(metadata, Some(&plan.operation_id))
        .await?
        .remove(&plan.operation_id)
    {
        if serde_json::to_value(&stored).ok() != serde_json::to_value(&plan).ok() {
            return Err(invalid("Queue operation identity was reused"));
        }
        return match settled {
            Some(result) => Ok(result),
            None => finish(tree, branch_id, metadata, &stored, ready).await,
        };
    }
    recover(tree, branch_id, metadata).await?;
    if plan.sources.is_empty()
        || plan.sources.len() > 128
        || plan.order.len() > plan.sources.len()
        || plan.sources.iter().collect::<BTreeSet<_>>().len() != plan.sources.len()
        || plan.order.iter().collect::<BTreeSet<_>>().len() != plan.order.len()
        || plan.order.iter().any(|id| !plan.sources.contains(id))
    {
        return Err(invalid("Invalid queue mutation order"));
    }
    if plan.steer && (plan.sources.len() != 1 || plan.order != plan.sources) {
        return Err(invalid("Steer requires one input"));
    }
    if let Some(replacement) = &plan.replacement {
        replacement.input.validate().map_err(RpcError::invalid)?;
        if replacement.input.handover.is_some() {
            return Err(invalid("Queue edit cannot address a handover"));
        }
        validate_representation(&replacement.representation)?;
    }
    let current = pending(metadata).await?;
    let ids: Vec<_> = current.iter().map(|event| event.id.clone()).collect();
    let applied: BTreeSet<_> = transitions(metadata, &ids)
        .await?
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::InputApplied(data) => Some(data.input_id.clone()),
            _ => None,
        })
        .collect();
    let held: Vec<_> = current
        .iter()
        .filter(|event| !applied.contains(&event.id))
        .map(|event| event.id.clone())
        .collect();
    // Reorder plans cover the queue tail. Edit/delete/steer address exactly one held input.
    let valid = if plan.sources.len() == 1 && plan.replacement.is_none() {
        held.contains(&plan.sources[0])
    } else {
        held.ends_with(&plan.sources)
    };
    if !valid {
        return Err(conflict());
    }
    for event in current
        .iter()
        .filter(|event| plan.sources.contains(&event.id))
    {
        let EventKind::InputMessage(input) = &event.kind else {
            unreachable!()
        };
        if input.effective_mode() != InputMode::Queue || input.handover.is_some() {
            return Err(conflict());
        }
    }
    append(
        &metadata.timeline,
        "queue-plan",
        serde_json::to_value(&plan).map_err(|_| invalid("Invalid queue mutation"))?,
    )?;
    finish(tree, branch_id, metadata, &plan, None).await
}

struct Methods {
    tree: Key<TreeCommands>,
    methods: Key<SessionMethods>,
}
impl Methods {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tree: names.key()?,
            methods: names.key()?,
        })
    }
}
impl DynPlugin for Methods {
    fn name(&self) -> &str {
        "DeepChatQueueMethods"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.tree.erase(), self.methods.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tree = ctx.require_at(&self.tree)?;
            ctx.require_at(&self.methods)?.register(
                ctx,
                "session.deepchat_queue",
                vec![
                    MethodDecl::new("session.deepchat_queue.list", false, Interruption::Report),
                    MethodDecl::new("session.deepchat_queue.mutate", true, Interruption::Drain),
                ],
                Arc::new(move |call, _, _| {
                    let tree = tree.clone();
                    Box::pin(async move {
                        if call.method.ends_with(".list") {
                            let p: List = params(call.params)?;
                            let metadata =
                                tree.get(&p.branch_id)?.service::<DeepChatInputMetadata>()?;
                            let _lane = metadata.lane.lock().await;
                            recover(&tree, &p.branch_id, &metadata).await?;
                            reply(list(&metadata).await?)
                        } else {
                            let p: Request = params(call.params)?;
                            let metadata =
                                tree.get(&p.branch_id)?.service::<DeepChatInputMetadata>()?;
                            let _lane = metadata.lane.lock().await;
                            reply(mutate(&tree, &p.branch_id, &metadata, p.plan).await?)
                        }
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
struct Recovery {
    metadata: Key<DeepChatInputMetadata>,
    queue: Key<InputQueue>,
    tree: Key<TreeCommands>,
}
impl DynPlugin for Recovery {
    fn name(&self) -> &str {
        "DeepChatQueueRecovery"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.metadata.erase(), self.queue.erase(), self.tree.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let metadata = ctx.require_at(&self.metadata)?;
            let tree = ctx.require_at(&self.tree)?;
            let stop = ctx.cancellation_token();
            ctx.effect(move || {
            let task=tokio::spawn(async move {
                let branch_id=metadata.timeline.branch_id();
                loop {
                    if tree.get(&branch_id).is_ok() {break;}
                    tokio::select!{ _=stop.cancelled()=>return, _=tokio::time::sleep(Duration::from_millis(10))=>{} }
                }
                tokio::select!{ _=stop.cancelled()=>{}, _=async {
                    let _lane=metadata.lane.lock().await;
                    if let Err(error)=recover(&tree,&branch_id,&metadata).await {
                        // Preserve the journal on failure. Further submissions must not overtake it.
                        eprintln!("DeepChat queue recovery requires attention: {}",error.message);
                    }
                }=>{} }
            });
            async move {let _=task.await;Ok(())}
        })?;
            Ok(Effect::Done)
        })
    }
}
