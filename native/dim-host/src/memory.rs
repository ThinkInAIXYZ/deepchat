//! Product memory audit facts have no model-context effect. The same native
//! metadata lane fences these writes against generation retirement.
use dim_agent_capabilities::{
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, Feature, Names};
use dim_agent_types::{EventKind, ExtensionEvent};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(
        Feature::new("DeepChatMemoryAudit").session("DeepChatMemoryAudit", |names| {
            Ok(Box::new(MemoryAudit::new(names)?))
        }),
    );
}
struct MemoryAudit {
    tree: Key<TreeCommands>,
    methods: Key<SessionMethods>,
}
impl MemoryAudit {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tree: names.key()?,
            methods: names.key()?,
        })
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Audit {
    session_id: String,
    branch_id: String,
    name: String,
    state: Value,
    meta: Option<Value>,
}
impl DynPlugin for MemoryAudit {
    fn name(&self) -> &str {
        "DeepChatMemoryAudit"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.tree.erase(), self.methods.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tree = ctx.require_at(&self.tree)?;
            ctx.require_at(&self.methods)?.register(ctx, "session.deepchat_memory", vec![
                MethodDecl::new("session.deepchat_memory.audit", true, Interruption::Report)
            ], Arc::new(move |call, _cancel, _| {
                let tree = tree.clone();
                Box::pin(async move {
                    let p: Audit = params(call.params)?;
                    if !matches!(p.name.as_str(), "memory/view_assembled" | "memory/directive_view_assembled" | "memory/extract") || !p.state.is_object() {
                        return Err(RpcError::invalid("Invalid product memory audit"));
                    }
                    let data = json!({"name":p.name,"state":p.state,"meta":p.meta});
                    if serde_json::to_vec(&data).map_err(|_|RpcError::invalid("Invalid memory audit"))?.len() > 1024 * 1024 {
                        return Err(RpcError::invalid("Memory audit exceeds its size limit"));
                    }
                    let branch = tree.get(&p.branch_id)?;
                    let metadata = branch.service::<crate::inputs::DeepChatInputMetadata>()?;
                    let _lane = metadata.lane.lock().await;
                    crate::inputs::ensure_active(&metadata).await?;
                    let event = metadata.timeline.append(EventKind::Extension(
                        ExtensionEvent::new("deepchat", "memory-audit", data).map_err(RpcError::invalid)?
                    ).into())?;
                    crate::facts::published(&metadata.timeline, event.sequence).await?;
                    reply(json!({"entryId":null,"timeline":{"sessionId":p.session_id,"branchId":p.branch_id,"sequence":event.sequence.to_string(),"eventId":event.id}}))
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
