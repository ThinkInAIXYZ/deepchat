//! Product consent preferences are advice to dim's permission/approval owners.
use dim_agent_capabilities::{
    host::HostFuture,
    permission::{
        AdmissionDecision, AdviseTool, Permission, PermissionState, ToolAdviceReply,
        ToolAdviceRequest,
    },
    prompt_state::PromptSnapshot,
};
use dim_agent_runtime::{AgentBuilder, Feature, Names, SessionIdentity, StateCell};
use dim_agent_types::{BranchSource, PermissionPreset};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde_json::json;
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

/// The desktop reviewer has its own 30 s budget; this bounds a stalled gateway.
const REVIEW_TIMEOUT: Duration = Duration::from_secs(35);
/// A review verdict is a few hundred bytes.
const REVIEW_REPLY_BYTES: usize = 64 * 1024;

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
    identity: Key<SessionIdentity>,
}
impl Consent {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            permission: names.key()?,
            prompt: names.state_cell()?,
            policy: names.state_cell()?,
            identity: names.key()?,
        })
    }
}
struct Advice {
    prompt: Arc<StateCell<PromptSnapshot>>,
    policy: Arc<StateCell<PermissionState>>,
    session_id: String,
}
impl AdviseTool for Advice {
    fn advise(
        &self,
        request: ToolAdviceRequest,
        cancel: CancellationToken,
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
        if request.risk.as_deref() == Some("product_approval") {
            return Box::pin(async move {
                Ok(ToolAdviceReply::Ask {
                    reason: format!("DeepChat requires consent to use {}", request.call.name),
                })
            });
        }
        // `auto_approve` reviews every call that changes state, as the desktop reviewer did:
        // Allow answers dim's own question, Ask overrides dim's own allow, and dim's deny
        // still wins over any advice.
        if mode == "auto_approve"
            && !matches!(request.risk.as_deref(), Some("read_filesystem" | "session"))
        {
            return Box::pin(review(self.session_id.clone(), request, cancel));
        }
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

/// Every failure asks the user, never leaving a call admitted without a verdict.
async fn review(
    session_id: String,
    request: ToolAdviceRequest,
    cancel: CancellationToken,
) -> Result<ToolAdviceReply, dim_agent_capabilities::host::HostError> {
    let ask = || ToolAdviceReply::Ask {
        reason: format!(
            "DeepChat auto-review needs consent for {}",
            request.call.name
        ),
    };
    let call_id = match &request.source {
        BranchSource::Tool { call_id, .. } => call_id.clone(),
        // Host operations are not model calls, so their own decision stands.
        _ => return Ok(ToolAdviceReply::None),
    };
    let reply = tokio::time::timeout(
        REVIEW_TIMEOUT,
        super::gateway::request(
            json!({
                "kind": "tool_review",
                "sessionId": session_id,
                "callId": call_id,
                "toolName": request.call.name,
                "arguments": request.call.input,
                "risk": request.risk,
            }),
            cancel.clone(),
            REVIEW_REPLY_BYTES,
        ),
    )
    .await;
    if cancel.is_cancelled() {
        return Err(dim_agent_capabilities::host::HostError::Cancelled(
            "Tool review cancelled.".into(),
        ));
    }
    let decision = match reply {
        Ok(Ok(value)) => value
            .get("decision")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        _ => None,
    };
    Ok(match decision.as_deref() {
        Some("auto_allow") if request.decision == AdmissionDecision::Ask => ToolAdviceReply::Allow,
        Some("auto_allow") => ToolAdviceReply::None,
        Some("block") => ToolAdviceReply::Deny {
            reason: format!("DeepChat auto-review blocked {}", request.call.name),
        },
        _ => ask(),
    })
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
            self.identity.erase(),
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
                    session_id: ctx.require_at(&self.identity)?.session_id.clone(),
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
