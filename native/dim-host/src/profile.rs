//! Backup admission reads the native owners' activity, never a second task queue.
use dim_agent_capabilities::methods::{Interruption, MethodDecl, RpcError, reply};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_app_server::{AgentIndex, methods::ManagementMethods, provider::ProviderService};
use dim_modality::{ModalityTasks, TaskList};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde_json::json;
use std::sync::Arc;

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(Profile::new(names)?)));
}
struct Profile {
    methods: Key<ManagementMethods>,
}
impl Profile {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            methods: names.key()?,
        })
    }
}
impl DynPlugin for Profile {
    fn name(&self) -> &str {
        "DeepChatProfileReadiness"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.methods.erase(),
            TypeKey::of::<ProviderService>(),
            Key::<ModalityTasks>::named("modalityTasks").erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let providers = ctx.require::<ProviderService>()?;
            let tasks = ctx.require_at(&Key::<ModalityTasks>::named("modalityTasks"))?;
            let lookup = ctx.clone();
            ctx.require_at(&self.methods)?.register(ctx, "deepchat.native_profile", vec![
                MethodDecl::new("deepchat.native_profile.readiness", false, Interruption::Report)
            ], Arc::new(move |_call, cancel, _| {
                let agents = lookup.get::<AgentIndex>();
                let (providers, tasks) = (providers.clone(), tasks.clone());
                Box::pin(async move {
                    let agents = agents.ok_or_else(|| RpcError::service("profile_unavailable", "Native sessions are not ready"))?;
                    let mut media = false;
                    for state in ["queued", "running"] {
                        let page = tokio::select! {
                            _ = cancel.cancelled() => return Err(RpcError::interrupted()),
                            page = tasks.list(TaskList { state: Some(state.into()), category: None,
                                limit: Some(1), after: None }) => page?
                        };
                        media |= !page.tasks.is_empty();
                    }
                    // Includes activity holds and every branch's running/publishing work.
                    let sessions = agents.hosts().iter().flat_map(|host| host.agent.sessions())
                        .any(|session| session.in_use().is_some());
                    let provider = providers.has_active_work();
                    reply(json!({"idle":!sessions && !media && !provider,
                        "sessions":sessions,"media":media,"provider":provider,
                        "storeFormat":dim_app_server::storage::STORE_FORMAT}))
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
