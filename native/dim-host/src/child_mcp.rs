//! Desktop authorization selects MCP configuration; the native MCP owner owns its resources.
use dim_agent_capabilities::tool_registry::ToolRegistry;
use dim_agent_runtime::{
    AgentBuilder, Feature, Names, SESSION_GROUP, SessionConfig, SessionIdentity, SessionLifecycle,
};
use dim_app_server::{
    mcp::{config::McpServerSettings, mount_initial_binding},
    protocol::SessionOrigin,
    storage::SessionStore,
};
use rutis::{
    Ctx,
    host::{BoxFuture, CtxHost, DynPlugin, Effect, FiberView, InstanceId, Key, TypeKey},
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

pub(crate) fn install(builder: &mut AgentBuilder) {
    builder.require_feature(
        Feature::new("DeepChatChildMcp").session("DeepChatChildMcp", |names| {
            Ok(Box::new(ChildMcp::new(names)?))
        }),
    );
}
struct ChildMcp {
    identity: Key<SessionIdentity>,
    config: Key<SessionConfig>,
    tools: Key<ToolRegistry>,
    lifecycle: Key<SessionLifecycle>,
    session: InstanceId,
}
impl ChildMcp {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            identity: names.key()?,
            config: names.key()?,
            tools: names.key()?,
            lifecycle: names.key()?,
            session: names.instance(SESSION_GROUP)?,
        })
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    servers: BTreeMap<String, McpServerSettings>,
}
async fn selection(id: &str, stop: &CancellationToken) -> rutis::Result<Selection> {
    let value = tokio::time::timeout(
        Duration::from_secs(20),
        super::gateway::request(
            json!({"kind":"mcp","sessionId":id}),
            stop.child_token(),
            8 * 1024 * 1024,
        ),
    )
    .await
    .map_err(|_| failure())?
    .map_err(|_| failure())?;
    serde_json::from_value(value).map_err(|_| failure())
}
fn failure() -> rutis::Error {
    rutis::host::ErrorKind::PluginFailed("Desktop MCP authorization is unavailable".into()).into()
}
fn fingerprint(value: &Selection) -> rutis::Result<String> {
    let bytes = serde_json::to_vec(&value.servers).map_err(|_| failure())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
impl DynPlugin for ChildMcp {
    fn name(&self) -> &str {
        "DeepChatChildMcp"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.identity.erase(),
            self.config.erase(),
            self.tools.erase(),
            self.lifecycle.erase(),
            TypeKey::of::<SessionStore>(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let identity = ctx.require_at(&self.identity)?;
            let config = ctx.require_at(&self.config)?;
            let lifecycle = ctx.require_at(&self.lifecycle)?;
            let (origin, parent) = ctx
                .require::<SessionStore>()?
                .creation_record(&identity.session_id)
                .await
                .map_err(|_| failure())?;
            if origin != SessionOrigin::Internal
                || parent.is_none()
                || super::GATEWAY.get().and_then(Option::as_ref).is_none()
            {
                return Ok(Effect::Done);
            }
            let stop = ctx.cancellation_token();
            let initial = selection(&identity.session_id, &stop).await?;
            let mut version = Some(fingerprint(&initial)?);
            let mut mounted: Option<FiberView> = if initial.servers.is_empty() {
                None
            } else {
                Some(
                    mount_initial_binding(
                        ctx,
                        self.session,
                        self.tools.clone(),
                        self.lifecycle.clone(),
                        &config.cwd,
                        initial.servers,
                    )
                    .await
                    .map_err(|_| failure())?,
                )
            };
            let tasks = TaskTracker::new();
            let draining = tasks.clone();
            let cancel = stop.clone();
            ctx.effect(move || async move {
                cancel.cancel();
                draining.close();
                draining.wait().await;
                Ok(())
            })?;
            let (context, tools, phase, session) = (
                ctx.clone(),
                self.tools.clone(),
                self.lifecycle.clone(),
                self.session,
            );
            tasks.spawn(async move {
                if !lifecycle.activated().await {
                    return;
                }
                loop {
                    tokio::select! {
                        _ = stop.cancelled() => break,
                        _ = lifecycle.closing() => break,
                        _ = tokio::time::sleep(Duration::from_secs(10)) => {}
                    }
                    let updated = selection(&identity.session_id, &stop).await;
                    let next = updated
                        .as_ref()
                        .ok()
                        .and_then(|value| fingerprint(value).ok());
                    if next.is_some()
                        && next == version
                        && mounted
                            .as_ref()
                            .is_none_or(|view| view.state().error.is_none())
                    {
                        continue;
                    }
                    if let Some(view) = mounted.take() {
                        let _ = view.shutdown().await;
                    }
                    version = None;
                    if let Ok(updated) = updated {
                        if updated.servers.is_empty() {
                            version = next;
                            continue;
                        }
                        if let Ok(view) = mount_initial_binding(
                            &context,
                            session,
                            tools.clone(),
                            phase.clone(),
                            &config.cwd,
                            updated.servers,
                        )
                        .await
                        {
                            mounted = Some(view);
                            version = next;
                        }
                    }
                }
                if let Some(view) = mounted {
                    let _ = view.shutdown().await;
                }
            });
            Ok(Effect::Done)
        })
    }
}
