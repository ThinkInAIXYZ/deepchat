//! Compatibility for declared desktop context hooks. Native Timeline owns the
//! admission receipt; HostPlatform owns every process tree, including cleanup.
use dim_agent_capabilities::{
    host_platform::{HostPlatform, Os, ProcessSpec},
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, Feature, SessionIdentity, SessionLifecycle};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, ffi::OsString, path::PathBuf, sync::Arc, time::Duration};
use tokio::{io::AsyncReadExt, sync::Mutex};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(Feature::new("DeepChatPluginHooks").session(
        "DeepChatPluginHooks",
        |names| {
            Ok(Box::new(PluginHooks {
                methods: names.key()?,
                tree: names.key()?,
                platform: names.key()?,
                identity: names.key()?,
                lifecycle: names.key()?,
            }))
        },
    ));
}
struct PluginHooks {
    methods: Key<SessionMethods>,
    tree: Key<TreeCommands>,
    platform: Key<HostPlatform>,
    identity: Key<SessionIdentity>,
    lifecycle: Key<SessionLifecycle>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Run {
    session_id: String,
    branch_id: String,
    invocation_id: String,
    plugin_id: String,
    digest: String,
    hook_id: String,
    boundary_id: String,
    message_id: String,
    launch_id: String,
    retry_of: Option<String>,
    context_budget: usize,
    #[serde(default)]
    input_too_large: bool,
    event: String,
    matcher: String,
    payload: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cancel {
    session_id: String,
    branch_id: String,
    invocation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observe {
    session_id: String,
    branch_id: String,
    plugin_id: String,
    digest: String,
    launch_id: String,
    compaction_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Import {
    session_id: String,
    branch_id: String,
    configuration_event: String,
    invocation: LegacyInvocation,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyProvenance {
    entry_id: u64,
    product_session_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyInvocation {
    invocation_id: String,
    plugin_id: String,
    digest: String,
    hook_id: String,
    boundary_id: String,
    message_id: String,
    session_id: String,
    launch_id: String,
    event: String,
    status: String,
    at: u64,
    matcher: String,
    content: Option<String>,
    message: Option<String>,
    payload: Option<Value>,
    legacy: LegacyProvenance,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    plugin_id: String,
    digest: String,
    root: PathBuf,
    data: PathBuf,
    hooks: Vec<Hook>,
    #[serde(default)]
    environment: HashMap<String, String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hook {
    id: String,
    event: String,
    command: String,
    command_windows: Option<String>,
    timeout: f64,
}
type Running = Arc<Mutex<HashMap<(String, String), CancellationToken>>>;
impl DynPlugin for PluginHooks {
    fn name(&self) -> &str {
        "DeepChatPluginHooks"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.methods.erase(),
            self.tree.erase(),
            self.platform.erase(),
            self.identity.erase(),
            self.lifecycle.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let (tree, platform, identity, lifecycle) = (
                ctx.require_at(&self.tree)?,
                ctx.require_at(&self.platform)?,
                ctx.require_at(&self.identity)?,
                ctx.require_at(&self.lifecycle)?,
            );
            let running: Running = Default::default();
            let workers = TaskTracker::new();
            let stop = ctx.cancellation_token();
            let (draining, cancel) = (workers.clone(), stop.clone());
            ctx.effect(move || async move {
                cancel.cancel();
                draining.close();
                draining.wait().await;
                Ok(())
            })?;
            ctx.require_at(&self.methods)?.register(
                ctx,
                "session.deepchat_hooks",
                vec![
                    MethodDecl::new("session.deepchat_hooks.run", true, Interruption::Report),
                    MethodDecl::new("session.deepchat_hooks.cancel", true, Interruption::Report),
                    MethodDecl::new("session.deepchat_hooks.observe", true, Interruption::Report),
                    MethodDecl::new("session.deepchat_hooks.import", true, Interruption::Report),
                ],
                Arc::new(move |call, caller, _| {
                    let (tree, platform, identity, lifecycle, running, workers, stop) = (
                        tree.clone(),
                        platform.clone(),
                        identity.clone(),
                        lifecycle.clone(),
                        running.clone(),
                        workers.clone(),
                        stop.clone(),
                    );
                    Box::pin(async move {
                        if call.method.ends_with(".import") {
                            let p: Import = params(call.params)?;
                            if p.session_id != identity.session_id { return Err(invalid()); }
                            return reply(import_legacy(&tree, p, &caller, &stop).await?);
                        }
                        if call.method.ends_with(".observe") {
                            let p:Observe=params(call.params)?;
                            if p.session_id!=identity.session_id || [&p.plugin_id,&p.digest,&p.launch_id].iter().any(|value|value.is_empty()||value.len()>4096) || p.compaction_id.as_ref().is_some_and(|value|value.len()>4096) { return Err(invalid()); }
                            let catalog=crate::gateway::request(json!({"kind":"plugin_hooks","sessionId":p.session_id,"event":"SessionStart","matcher":"","includeUnmatched":true}),caller.clone(),4*1024*1024).await.map_err(|_|invalid())?;
                            let sources:Vec<Source>=serde_json::from_value(catalog["sources"].clone()).map_err(|_|invalid())?;
                            if !sources.iter().any(|source|source.plugin_id==p.plugin_id&&source.digest==p.digest&&source.hooks.iter().any(|hook|hook.event=="SessionStart")) { return Err(invalid()); }
                            let branch=tree.get(&p.branch_id)?;
                            let metadata=branch.service::<crate::inputs::DeepChatInputMetadata>()?;
                            let _lane=metadata.lane.lock().await;
                            crate::inputs::ensure_active(&metadata).await?;
                            if caller.is_cancelled() || stop.is_cancelled() { return Err(invalid()); }
                            let id=format!("{:x}",Sha256::digest(serde_json::to_vec(&json!([p.plugin_id,p.digest,p.launch_id,p.compaction_id])).map_err(|_|invalid())?));
                            let old=crate::facts::events(&metadata.timeline,crate::facts::and(vec![crate::facts::extension("plugin-hook-session"),crate::facts::equal("data.observationId",json!(id))])).await?;
                            if old.is_empty() {
                                let data=json!({"observationId":id,"pluginId":p.plugin_id,"digest":p.digest,"launchId":p.launch_id,"compactionId":p.compaction_id});
                                let event=metadata.timeline.append(dim_agent_types::EventKind::Extension(dim_agent_types::ExtensionEvent::new("deepchat","plugin-hook-session",data).map_err(RpcError::invalid)?).into())?;
                                crate::facts::published(&metadata.timeline,event.sequence).await?;
                            }
                            return reply(json!({"observed":true}));
                        }
                        if call.method.ends_with(".cancel") {
                            let p: Cancel = params(call.params)?;
                            if p.session_id != identity.session_id {
                                return Err(invalid());
                            }
                            let branch = tree.get(&p.branch_id)?;
                            let metadata =
                                branch.service::<crate::inputs::DeepChatInputMetadata>()?;
                            let _lane = metadata.lane.lock().await;
                            if let Some(token) = running
                                .lock()
                                .await
                                .get(&(p.branch_id, p.invocation_id.clone()))
                            {
                                token.cancel();
                            }
                            // A cancellation that races admission still prevents a later start.
                            if history(&metadata, &p.invocation_id).await?.is_none() {
                                record(
                                    &metadata,
                                    json!({"invocationId":p.invocation_id,"status":"cancelled"}),
                                )
                                .await?;
                            }
                            return reply(json!({"cancelled":true}));
                        }
                        let p: Run = params(call.params)?;
                        if p.context_budget > 8192
                            || p.session_id != identity.session_id
                            || p.invocation_id.len() != 64
                            || !p.invocation_id.bytes().all(|c| c.is_ascii_hexdigit())
                            || !matches!(
                                p.event.as_str(),
                                "SessionStart" | "UserPromptSubmit" | "SubagentStart"
                            )
                            || p.payload.get("hook_event_name").and_then(Value::as_str)
                                != Some(p.event.as_str())
                            || serde_json::to_vec(&p.payload).map_err(|_| invalid())?.len()
                                > 1024 * 1024
                        {
                            return Err(invalid());
                        }
                        let expected = format!(
                            "{:x}",
                            Sha256::digest(
                                serde_json::to_vec(&json!([
                                    p.plugin_id,
                                    p.digest,
                                    p.session_id,
                                    p.branch_id,
                                    p.hook_id,
                                    p.boundary_id
                                ]))
                                .map_err(|_| invalid())?
                            )
                        );
                        if p.invocation_id != expected {
                            return Err(invalid());
                        }
                        let hold = lifecycle.take_hold().ok_or_else(|| {
                            RpcError::service("session_closing", "Plugin hook owner is closing")
                        })?;
                        let (send, receive) = tokio::sync::oneshot::channel();
                        workers.spawn(async move {
                            let _hold = hold;
                            let result =
                                run(tree, platform, lifecycle, running, stop, caller, p).await;
                            let _ = send.send(result);
                        });
                        reply(receive.await.map_err(|_| {
                            RpcError::service(
                                "hook_interrupted",
                                "Plugin hook outcome is uncertain",
                            )
                        })??)
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
fn invalid() -> RpcError {
    RpcError::invalid("Invalid declared plugin hook invocation")
}
/// Frozen history conversion carries audit and observation facts, never a process admission.
/// Clearing/forking supplies an explicit empty state; a started command stays uncertain.
pub(crate) async fn restore_state(
    metadata: &crate::inputs::DeepChatInputMetadata,
    state: &[Value],
) -> Result<(), RpcError> {
    for item in state {
        let name = item["name"].as_str().ok_or_else(invalid)?;
        let mut data = item["data"].clone();
        let field = match name {
            "plugin-hook" => "invocationId",
            "plugin-hook-session" => "observationId",
            _ => return Err(invalid()),
        };
        if !data.is_object()
            || [field, "pluginId", "digest", "launchId"].iter().any(|key| {
                data[*key]
                    .as_str()
                    .is_none_or(|value| value.is_empty() || value.len() > 4096)
            })
        {
            return Err(invalid());
        }
        if data["status"] == "started" {
            data["status"] = json!("uncertain");
        }
        let previous = crate::facts::events(
            &metadata.timeline,
            crate::facts::and(vec![
                crate::facts::extension(name),
                crate::facts::equal(&format!("data.{field}"), data[field].clone()),
            ]),
        )
        .await?;
        if let Some(previous) = previous.last() {
            let previous = serde_json::to_value(previous.as_ref()).map_err(|_| invalid())?;
            if previous["data"] != data {
                return Err(invalid());
            }
            continue;
        }
        let event = metadata.timeline.append(
            dim_agent_types::EventKind::Extension(
                dim_agent_types::ExtensionEvent::new("deepchat", name, data)
                    .map_err(RpcError::invalid)?,
            )
            .into(),
        )?;
        crate::facts::published(&metadata.timeline, event.sequence).await?;
    }
    Ok(())
}
async fn import_legacy(
    tree: &TreeCommands,
    p: Import,
    caller: &CancellationToken,
    stop: &CancellationToken,
) -> Result<Value, RpcError> {
    let old = &p.invocation;
    let observed = old.hook_id == "$session";
    if [
        &old.plugin_id,
        &old.digest,
        &old.hook_id,
        &old.boundary_id,
        &old.message_id,
        &old.session_id,
        &old.launch_id,
    ]
    .iter()
    .any(|value| value.is_empty() || value.len() > 4096)
        || old.session_id != old.legacy.product_session_id
        || old.legacy.entry_id == 0
        || old.legacy.entry_id > 9_007_199_254_740_991
        || old.at > 9_007_199_254_740_991
        || !old.launch_id.starts_with("legacy:")
        || !matches!(
            old.event.as_str(),
            "SessionStart" | "SubagentStart" | "UserPromptSubmit"
        )
        || !matches!(old.status.as_str(), "completed" | "failed" | "uncertain")
        || old
            .content
            .as_ref()
            .is_some_and(|value| value.len() > 8192 || old.status != "completed")
        || old
            .message
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1024)
        || old.matcher.len() > 4096
        || old.payload.as_ref().is_some_and(|value| {
            old.status == "completed"
                || value.get("hook_event_name").and_then(Value::as_str) != Some(old.event.as_str())
                || serde_json::to_vec(value).map_or(true, |bytes| bytes.len() > 1024 * 1024)
        })
        || (observed
            && (old.event != "SessionStart"
                || old.status != "completed"
                || old.payload.is_some()
                || old.content.is_some()))
    {
        return Err(invalid());
    }
    let identity = if observed {
        json!([old.plugin_id, old.digest, old.session_id, old.hook_id])
    } else {
        json!([
            old.plugin_id,
            old.digest,
            old.session_id,
            old.hook_id,
            old.boundary_id
        ])
    };
    let expected = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&identity).map_err(|_| invalid())?)
    );
    if expected != old.invocation_id {
        return Err(invalid());
    }
    let catalog = crate::gateway::request(json!({"kind":"plugin_hooks","sessionId":p.session_id,"event":p.configuration_event,"matcher":"","includeUnmatched":true}), caller.clone(), 4*1024*1024).await.map_err(|_|invalid())?;
    let sources: Vec<Source> =
        serde_json::from_value(catalog["sources"].clone()).map_err(|_| invalid())?;
    if !sources.iter().any(|source| {
        source.plugin_id == old.plugin_id
            && source.digest == old.digest
            && source
                .hooks
                .iter()
                .any(|hook| observed || (hook.id == old.hook_id && hook.event == old.event))
    }) {
        return Err(invalid());
    }
    let branch = tree.get(&p.branch_id)?;
    let metadata = branch.service::<crate::inputs::DeepChatInputMetadata>()?;
    let _lane = metadata.lane.lock().await;
    crate::inputs::ensure_active(&metadata).await?;
    if caller.is_cancelled() || stop.is_cancelled() {
        return Err(invalid());
    }
    let owner = crate::facts::and(vec![
        json!({"op":"or","conditions":[crate::facts::extension("plugin-hook"),crate::facts::extension("plugin-hook-session")]}),
        crate::facts::equal("data.pluginId", json!(old.plugin_id)),
        crate::facts::equal("data.digest", json!(old.digest)),
    ]);
    // A partially imported archive may resume, but it cannot supersede a live native fact.
    let query: dim_agent_runtime::TimelineQuery = serde_json::from_value(json!({
        "scope":"branch", "through":metadata.timeline.committed(), "include_publishing":true,
        "query":{"filter":crate::facts::and(vec![owner.clone(), json!({"op":"not","condition":{"op":"present","value":crate::facts::field("data.legacy")}})]),"select":{"kind":"exists"}}
    })).map_err(|_|invalid())?;
    if let dim_agent_runtime::QueryOutput::Exists { exists: true } =
        metadata.timeline.query(query).await?.result
    {
        return Ok(json!({"imported":false}));
    }
    let field = if observed {
        "observationId"
    } else {
        "invocationId"
    };
    let existing = crate::facts::events(
        &metadata.timeline,
        crate::facts::and(vec![
            owner,
            crate::facts::equal(&format!("data.{field}"), json!(old.invocation_id)),
        ]),
    )
    .await?;
    let data = if observed {
        json!({"observationId":old.invocation_id,"pluginId":old.plugin_id,"digest":old.digest,"launchId":old.launch_id,"legacy":old.legacy})
    } else {
        serde_json::to_value(old).map_err(|_| invalid())?
    };
    for event in existing {
        let previous = serde_json::to_value(event.as_ref()).map_err(|_| invalid())?;
        if previous["data"][field] == old.invocation_id {
            if previous["data"] != data {
                return Err(invalid());
            }
            return Ok(json!({"imported":true}));
        }
    }
    if observed {
        let event = metadata.timeline.append(
            dim_agent_types::EventKind::Extension(
                dim_agent_types::ExtensionEvent::new("deepchat", "plugin-hook-session", data)
                    .map_err(RpcError::invalid)?,
            )
            .into(),
        )?;
        crate::facts::published(&metadata.timeline, event.sequence).await?;
    } else {
        record(&metadata, data).await?;
    }
    Ok(json!({"imported":true}))
}
async fn selected(p: &Run, cancel: &CancellationToken) -> Result<(Source, Hook), String> {
    let reply = crate::gateway::request(
        json!({"kind":"plugin_hooks","sessionId":p.session_id,"event":p.event,"matcher":p.matcher}),
        cancel.clone(),
        4 * 1024 * 1024,
    )
    .await
    .map_err(|_| "Plugin hook owner is unavailable")?;
    let sources: Vec<Source> =
        serde_json::from_value(reply.get("sources").cloned().unwrap_or(Value::Null))
            .map_err(|_| "Invalid plugin hook configuration")?;
    let source = sources
        .into_iter()
        .find(|s| s.plugin_id == p.plugin_id && s.digest == p.digest)
        .ok_or("Plugin hook revision was revoked")?;
    let hook = source
        .hooks
        .iter()
        .find(|h| h.id == p.hook_id && h.event == p.event)
        .cloned()
        .ok_or("Declared plugin hook was revoked")?;
    if !hook.timeout.is_finite()
        || hook.timeout <= 0.0
        || hook.timeout > 30.0
        || hook.command.len() > 65536
    {
        return Err("Invalid plugin hook command".into());
    }
    Ok((source, hook))
}
async fn history(
    metadata: &crate::inputs::DeepChatInputMetadata,
    id: &str,
) -> Result<Option<Value>, RpcError> {
    let events = crate::facts::events(
        &metadata.timeline,
        crate::facts::and(vec![
            crate::facts::extension("plugin-hook"),
            crate::facts::equal("data.invocationId", json!(id)),
        ]),
    )
    .await?;
    Ok(events
        .last()
        .and_then(|e| serde_json::to_value(e.as_ref()).ok())
        .and_then(|e| e.get("data").cloned()))
}
async fn record(
    metadata: &crate::inputs::DeepChatInputMetadata,
    data: Value,
) -> Result<(), RpcError> {
    let event = metadata.timeline.append(
        dim_agent_types::EventKind::Extension(
            dim_agent_types::ExtensionEvent::new("deepchat", "plugin-hook", data)
                .map_err(RpcError::invalid)?,
        )
        .into(),
    )?;
    crate::facts::published(&metadata.timeline, event.sequence).await
}
async fn run(
    tree: Arc<TreeCommands>,
    platform: Arc<HostPlatform>,
    lifecycle: Arc<SessionLifecycle>,
    running: Running,
    stop: CancellationToken,
    caller: CancellationToken,
    p: Run,
) -> Result<Value, RpcError> {
    let branch = tree.get(&p.branch_id)?;
    let metadata = branch.service::<crate::inputs::DeepChatInputMetadata>()?;
    let cancelled = CancellationToken::new();
    let selection = selected(&p, &cancelled);
    let (source, hook) = tokio::select! {
        result = selection => result.map_err(RpcError::invalid)?,
        _ = stop.cancelled() => return Err(RpcError::invalid("Plugin hook owner stopped before admission")),
        _ = caller.cancelled() => return Err(RpcError::invalid("Plugin hook caller disconnected before admission")),
        _ = lifecycle.closing() => return Err(RpcError::invalid("Plugin hook session closed before admission")),
    };
    let mut state = json!({"invocationId":p.invocation_id,"pluginId":p.plugin_id,"digest":p.digest,"hookId":p.hook_id,"boundaryId":p.boundary_id,"messageId":p.message_id,"launchId":p.launch_id,"event":p.event,"sessionId":p.payload.get("session_id"),"payload":p.payload,"matcher":p.matcher,"inputTooLarge":p.input_too_large,"status":"started","at":now()});
    {
        let _lane = metadata.lane.lock().await;
        crate::inputs::ensure_active(&metadata).await?;
        if let Some(id) = &p.retry_of {
            if branch.state()?.running || !running.lock().await.is_empty() {
                return Err(RpcError::invalid(
                    "Finish active turns before retrying a hook",
                ));
            }
            let previous = history(&metadata, id).await?.ok_or_else(invalid)?;
            if !matches!(
                previous["status"].as_str(),
                Some("failed" | "started" | "uncertain")
            ) || previous["pluginId"] != p.plugin_id
                || previous["digest"] != p.digest
                || previous["hookId"] != p.hook_id
                || previous["event"] != p.event
                || previous["payload"] != p.payload
                || previous["inputTooLarge"].as_bool().unwrap_or(false) != p.input_too_large
            {
                return Err(RpcError::invalid(
                    "Hook retry does not match its native audit",
                ));
            }
        }
        if let Some(mut previous) = history(&metadata, &p.invocation_id).await? {
            if previous["status"] == "started" {
                previous["status"] = json!("uncertain");
            }
            return Ok(previous);
        }
        if stop.is_cancelled() || caller.is_cancelled() {
            return Err(RpcError::invalid("Plugin hook cancelled before admission"));
        }
        record(&metadata, state.clone()).await?;
        running.lock().await.insert(
            (p.branch_id.clone(), p.invocation_id.clone()),
            cancelled.clone(),
        );
    }
    let execute = execute(&platform, &source, &hook, &p, &cancelled);
    tokio::pin!(execute);
    let result = tokio::select! {
        result = &mut execute => result,
        _ = stop.cancelled() => { cancelled.cancel(); execute.await },
        _ = caller.cancelled() => { cancelled.cancel(); execute.await },
        _ = lifecycle.closing() => { cancelled.cancel(); execute.await },
    };
    // execute owns cleanup even if the RPC or Session owner disappears.
    // Its future must not be dropped while a native process is alive.
    running
        .lock()
        .await
        .remove(&(p.branch_id.clone(), p.invocation_id.clone()));
    state["at"] = json!(now());
    match result {
        Ok(output) => {
            state["status"] = json!("completed");
            state["content"] = output.get("content").cloned().unwrap_or(Value::Null);
            state["message"] = output.get("message").cloned().unwrap_or(Value::Null);
            state.as_object_mut().unwrap().remove("payload");
        }
        Err(error) => {
            if error.uncertain {
                return Err(RpcError::service("hook_uncertain", error.message));
            }
            state["status"] = json!("failed");
            state["message"] = json!(error.message);
        }
    }
    let _lane = metadata.lane.lock().await;
    record(&metadata, state.clone()).await?;
    Ok(state)
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
struct HookError {
    message: String,
    uncertain: bool,
}
impl From<String> for HookError {
    fn from(message: String) -> Self {
        Self {
            message,
            uncertain: false,
        }
    }
}
impl From<&str> for HookError {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}
async fn execute(
    platform: &HostPlatform,
    source: &Source,
    hook: &Hook,
    p: &Run,
    cancel: &CancellationToken,
) -> Result<Value, HookError> {
    if p.input_too_large {
        return Err("Hook input exceeds 1 MiB".into());
    }
    let command = if platform.os == Os::Windows {
        hook.command_windows.as_ref().unwrap_or(&hook.command)
    } else {
        &hook.command
    };
    if platform.os == Os::Windows
        && hook.command_windows.is_none()
        && command.as_bytes().windows(2).any(|pair| {
            pair[0] == b'$' && (pair[1] == b'{' || pair[1] == b'_' || pair[1].is_ascii_alphabetic())
        })
    {
        return Err("This hook requires a commandWindows override".into());
    }
    let cwd = p
        .payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| source.data.clone());
    let supplied: Vec<(OsString, OsString)> = if source.environment.is_empty() {
        platform.env.clone()
    } else {
        source
            .environment
            .iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect()
    };
    let mut environment: Vec<(OsString, OsString)> = supplied
        .iter()
        .filter(|(key, _)| {
            let key = key.to_string_lossy().to_ascii_uppercase();
            matches!(
                key.as_str(),
                "PATH"
                    | "HOME"
                    | "USER"
                    | "LOGNAME"
                    | "SHELL"
                    | "TMPDIR"
                    | "TMP"
                    | "TEMP"
                    | "LANG"
                    | "SYSTEMROOT"
                    | "WINDIR"
                    | "COMSPEC"
                    | "PATHEXT"
                    | "USERPROFILE"
                    | "USERNAME"
                    | "APPDATA"
                    | "LOCALAPPDATA"
                    | "PROGRAMDATA"
                    | "PROCESSOR_ARCHITECTURE"
                    | "DISPLAY"
                    | "WAYLAND_DISPLAY"
                    | "XAUTHORITY"
                    | "XDG_RUNTIME_DIR"
                    | "DBUS_SESSION_BUS_ADDRESS"
                    | "XDG_SESSION_TYPE"
                    | "AT_SPI_BUS"
                    | "SWAYSOCK"
                    | "XDG_CURRENT_DESKTOP"
                    | "XDG_SESSION_DESKTOP"
                    | "DESKTOP_SESSION"
                    | "XDG_DATA_HOME"
                    | "XDG_DATA_DIRS"
            ) || key.starts_with("LC_")
        })
        .cloned()
        .collect();
    for (key, value) in [
        ("PLUGIN_ROOT", source.root.as_os_str()),
        ("PLUGIN_DATA", source.data.as_os_str()),
        ("CLAUDE_PLUGIN_ROOT", source.root.as_os_str()),
        ("CLAUDE_PLUGIN_DATA", source.data.as_os_str()),
        (
            "DEEPCHAT_PLUGIN_ID",
            std::ffi::OsStr::new(&source.plugin_id),
        ),
    ] {
        environment.push((key.into(), value.to_owned()));
    }
    let spec = if platform.os == Os::Windows {
        let executable = platform
            .env
            .iter()
            .find(|(key, _)| key.to_string_lossy().eq_ignore_ascii_case("COMSPEC"))
            .map(|(_, v)| PathBuf::from(v))
            .unwrap_or_else(|| PathBuf::from("cmd.exe"));
        ProcessSpec {
            executable,
            args: vec!["/d".into(), "/s".into(), "/c".into(), command.into()],
            cwd,
            env: environment,
        }
    } else {
        ProcessSpec {
            executable: "/bin/sh".into(),
            args: vec!["-c".into(), command.into()],
            cwd,
            env: environment,
        }
    };
    let stdin = serde_json::to_vec(&p.payload).map_err(|_| "Invalid hook input")?;
    if cancel.is_cancelled() {
        return Err("Plugin hook cancelled before process start".into());
    }
    let mut process = platform
        .spawn_with_stdin(spec, stdin)
        .map_err(|_| "Cannot start declared plugin hook")?;
    let stdout = process.stdout();
    let stderr = process.stderr();
    let out = tokio::spawn(read_output(stdout));
    let err = tokio::spawn(read_output(stderr));
    let revoked = async {
        loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            selected(p, cancel).await?;
        }
        #[allow(unreachable_code)]
        Ok::<(), String>(())
    };
    let result = tokio::select! {
        _ = cancel.cancelled() => Err("Plugin hook cancelled".into()),
        _ = tokio::time::sleep(Duration::from_secs_f64(hook.timeout.min(10.0))) => Err("Plugin hook exceeded its time budget".into()),
        result = revoked => result.and(Err("Plugin hook owner was revoked".into())),
        status = process.wait() => status.map_err(|_|"Cannot wait for plugin hook".into()).and_then(|s| if s.success() { Ok(()) } else { Err(format!("Hook exited with status {s}")) }),
    };
    process.terminate().await.map_err(|_| HookError {
        message: "Cannot confirm plugin hook process-tree termination".into(),
        uncertain: true,
    })?;
    let stdout = out.await.map_err(|_| "Hook stdout reader stopped")??;
    err.await.map_err(|_| "Hook stderr reader stopped")??;
    result?;
    selected(p, cancel).await?;
    let output = parse_output(&stdout, &p.event)?;
    if output
        .get("content")
        .and_then(Value::as_str)
        .is_some_and(|s| s.len() > p.context_budget)
    {
        return Err("Hook context exceeded its 8 KiB boundary budget".into());
    }
    Ok(output)
}
async fn read_output(reader: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(65537)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "Cannot read plugin hook output")?;
    if bytes.len() > 65536 {
        Err("Plugin hook output exceeds 64 KiB".into())
    } else {
        Ok(bytes)
    }
}
fn parse_output(bytes: &[u8], event: &str) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "Hook output is not UTF-8")?
        .trim_start_matches('\u{feff}')
        .trim();
    if text.is_empty() {
        return Ok(json!({}));
    }
    let value: Value =
        serde_json::from_str(text).map_err(|_| "Hook output must be a JSON object")?;
    let object = value
        .as_object()
        .ok_or("Hook output must be a JSON object")?;
    if object.keys().any(|k| {
        !matches!(
            k.as_str(),
            "hookSpecificOutput" | "systemMessage" | "suppressOutput"
        )
    }) {
        return Err("Hook returned unsupported decision or control fields".into());
    }
    let specific = value.get("hookSpecificOutput").filter(|v| !v.is_null());
    if let Some(specific) = specific {
        let fields = specific.as_object().ok_or("Invalid hook-specific output")?;
        if specific.get("hookEventName").and_then(Value::as_str) != Some(event)
            || fields
                .keys()
                .any(|k| !matches!(k.as_str(), "hookEventName" | "additionalContext"))
        {
            return Err("Hook output has a mismatched event or unsupported control fields".into());
        }
        if specific
            .get("additionalContext")
            .is_some_and(|v| !v.is_string())
        {
            return Err("Hook additionalContext must be text".into());
        }
    }
    let content = specific
        .and_then(|v| v.get("additionalContext"))
        .cloned()
        .unwrap_or(Value::Null);
    if content.as_str().is_some_and(|s| s.len() > 8192) {
        return Err("Hook context exceeded its 8 KiB boundary budget".into());
    }
    Ok(
        json!({"content":content,"message":value.get("systemMessage").and_then(Value::as_str).map(|s|s.chars().take(1024).collect::<String>())}),
    )
}
