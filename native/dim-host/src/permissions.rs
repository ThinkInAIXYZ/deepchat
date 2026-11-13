//! Product consent preferences are advice to dim's permission/approval owners.
use dim_agent_capabilities::{
    host::HostFuture,
    permission::{AdviseTool, Permission, PermissionState, ToolAdviceReply, ToolAdviceRequest},
    prompt_state::PromptSnapshot,
};
use dim_agent_runtime::{AgentBuilder, Feature, Names, StateCell};
use dim_agent_types::PermissionPreset;
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(
        Feature::new("DeepChatConsent").branch("DeepChatConsent", |names| {
            Ok(Box::new(Consent::new(names)?))
        }),
    );
}
struct Consent {
    permission: Key<Permission>,
    prompt: Key<StateCell<PromptSnapshot>>,
    policy: Key<StateCell<PermissionState>>,
}
impl Consent {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            permission: names.key()?,
            prompt: names.state_cell()?,
            policy: names.state_cell()?,
        })
    }
}
struct Advice {
    prompt: Arc<StateCell<PromptSnapshot>>,
    policy: Arc<StateCell<PermissionState>>,
}
impl AdviseTool for Advice {
    fn advise(
        &self,
        request: ToolAdviceRequest,
        _: CancellationToken,
    ) -> HostFuture<'_, ToolAdviceReply> {
        let snapshot = self.prompt.get();
        let mode = snapshot
            .configuration
            .as_ref()
            .and_then(|configuration| configuration.metadata.as_ref())
            .and_then(|metadata| metadata.extensions.get("deepchatPermissionMode"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_else(|| {
                // Native delegation copies its leader's current policy. Internal
                // branches may have no desktop model metadata; honor that native
                // FullAccess grant instead of adding a default consent prompt.
                if self.policy.get().policy.preset == PermissionPreset::FullAccess {
                    "full_access"
                } else {
                    "default"
                }
            });
        let result = if mode == "default"
            && !matches!(request.risk.as_deref(), Some("read_filesystem" | "session"))
        {
            ToolAdviceReply::Ask {
                reason: format!("DeepChat requires consent to use {}", request.call.name),
            }
        } else {
            ToolAdviceReply::None
        };
        Box::pin(async move { Ok(result) })
    }
}
impl DynPlugin for Consent {
    fn name(&self) -> &str {
        "DeepChatConsent"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.permission.erase(),
            self.prompt.erase(),
            self.policy.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            ctx.require_at(&self.permission)?.register_advice(
                ctx,
                "deepchat-consent",
                Arc::new(Advice {
                    prompt: ctx.require_at(&self.prompt)?,
                    policy: ctx.require_at(&self.policy)?,
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
