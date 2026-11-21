//! Desktop task views omit request parameters; Modality keeps the complete task.
use dim_agent_capabilities::methods::{Interruption, MethodDecl, RpcError, params, reply};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_app_server::methods::ManagementMethods;
use dim_modality::{ModalityTasks, task::TaskRecord};
use rutis::{
    Ctx,
    host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey},
};
use serde_json::{Value, json};
use std::sync::Arc;

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(TaskViews::new(names)?)));
}
struct TaskViews {
    tasks: Key<ModalityTasks>,
    methods: Key<ManagementMethods>,
}
impl TaskViews {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tasks: Key::named("modalityTasks"),
            methods: names.key()?,
        })
    }
}
pub(crate) fn view(task: TaskRecord) -> Value {
    json!({
        "task_id":task.task_id,
        "client_task_id":task.client_task_id,
        "has_remote_handle":task.remote_handle.is_some(),
        "state":task.state,
        "result":task.result,
        "error":task.error
    })
}
impl DynPlugin for TaskViews {
    fn name(&self) -> &str {
        "DeepChatMediaTaskViews"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.tasks.erase(),
            self.methods.erase(),
            TypeKey::of::<crate::media::TasksReady>(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tasks = ctx.require_at(&self.tasks)?;
            ctx.require_at(&self.methods)?.register(
                ctx,
                "deepchat.native_media_tasks",
                ["status", "list", "wait", "cancel"].map(|name| {
                    let mut declaration = MethodDecl::new(
                        &format!("deepchat.native_media_tasks.{name}"),
                        name == "cancel",
                        Interruption::Report,
                    );
                    declaration.progress = name == "wait";
                    declaration
                }).to_vec(),
                Arc::new(move |call, cancel, progress| {
                    let tasks = tasks.clone();
                    Box::pin(async move {
                        let task = match call.method.rsplit('.').next() {
                            Some("status") => tasks.status(params(call.params)?).await?.task,
                            Some("wait") => tasks.wait(params(call.params)?, &cancel, Some(&progress)).await?.task,
                            Some("cancel") => tasks.cancel(params(call.params)?, &cancel).await?.task,
                            Some("list") => {
                                let page = tasks.list(params(call.params)?).await?;
                                return reply(json!({"tasks":page.tasks.into_iter().map(view).collect::<Vec<_>>(), "next":page.next}));
                            }
                            _ => return Err(RpcError::invalid("Unknown native media task operation")),
                        };
                        reply(json!({"task":view(task)}))
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
