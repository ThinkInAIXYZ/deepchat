//! File-backed media admission. Modality owns the task and its complete lifecycle.
use base64::{Engine, engine::general_purpose::STANDARD};
use dim_agent_capabilities::{
    file_storage::FileStorage,
    methods::{Interruption, MethodDecl, RpcError, reply},
};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_app_server::{methods::ManagementMethods, plugin_files::PluginFileTransactions};
use dim_modality::{ModalityTasks, TaskList, TaskSubmit, TaskWait, task::TaskRecord};
use rutis::{
    Ctx,
    host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey},
};
use std::{collections::HashSet, io::Cursor, path::Path, sync::Arc};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

const ROOT: &str = "deepchat-media-inputs";

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(MediaInputs::new(names)?)));
}
struct MediaInputs {
    tasks: Key<ModalityTasks>,
    files: Key<PluginFileTransactions>,
    storage: Key<FileStorage>,
    methods: Key<ManagementMethods>,
}
impl MediaInputs {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tasks: Key::named("modalityTasks"),
            files: names.key()?,
            storage: names.key()?,
            methods: names.key()?,
        })
    }
}
fn failed() -> RpcError {
    RpcError::service(
        "media_input_unavailable",
        "Cannot prepare native media input",
    )
}
fn owned(record: &TaskRecord, root: &Path) -> HashSet<String> {
    record
        .params
        .get("files")
        .and_then(|files| files.as_array())
        .into_iter()
        .flatten()
        .filter_map(|file| file.get("node_path")?.as_str())
        .filter_map(|file| {
            let parent = Path::new(file).parent()?;
            if parent.parent()? != root {
                return None;
            }
            let name = parent.file_name()?.to_str()?;
            (name.len() == 36 && uuid::Uuid::parse_str(name).is_ok())
                .then(|| format!("{ROOT}/{name}"))
        })
        .collect()
}
async fn remove(files: &PluginFileTransactions, names: HashSet<String>) {
    for name in names {
        let _ = files.remove(&name).await;
    }
}
fn observe(
    tasks: Arc<ModalityTasks>,
    files: Arc<PluginFileTransactions>,
    record: TaskRecord,
    root: &Path,
    stop: CancellationToken,
    workers: &TaskTracker,
) {
    let names = owned(&record, root);
    if names.is_empty() {
        return;
    }
    workers.spawn(async move {
        let mut record = record;
        while !record.state.is_terminal() {
            match tasks
                .wait(
                    TaskWait {
                        task_id: record.task_id.clone(),
                        timeout_ms: None,
                    },
                    &stop,
                    None,
                )
                .await
            {
                Ok(reply) => record = reply.task,
                Err(_) => return, // Retain inputs while the native outcome is unknown.
            }
        }
        remove(&files, names).await;
    });
}
impl DynPlugin for MediaInputs {
    fn name(&self) -> &str {
        "DeepChatMediaInputs"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.tasks.erase(),
            self.files.erase(),
            self.storage.erase(),
            self.methods.erase(),
            TypeKey::of::<crate::media::TasksReady>(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tasks = ctx.require_at(&self.tasks)?;
            let files = ctx.require_at(&self.files)?;
            let storage = ctx.require_at(&self.storage)?;
            let methods = ctx.require_at(&self.methods)?;
            let stop = ctx.cancellation_token();
            let root = files.directory(ROOT).await.map_err(|_| {
                rutis::host::ErrorKind::PluginFailed("Cannot open native media inputs".into())
            })?;
            let workers = TaskTracker::new();
            let cleanup = workers.clone();
            ctx.effect(move || async move {
                cleanup.close();
                cleanup.wait().await;
                Ok(())
            })?;
            // TasksReady is published after Modality recovery; its service alone is
            // published earlier. Only that owner decides which inputs survive restart.
            let mut retained = HashSet::new();
            let mut after = None;
            loop {
                let page = tasks
                    .list(TaskList {
                        state: None,
                        category: None,
                        limit: Some(100),
                        after,
                    })
                    .await
                    .map_err(|_| {
                        rutis::host::ErrorKind::PluginFailed(
                            "Cannot recover native media inputs".into(),
                        )
                    })?;
                for record in page.tasks {
                    retained.extend(owned(&record, &root));
                    observe(
                        tasks.clone(),
                        files.clone(),
                        record,
                        &root,
                        stop.clone(),
                        &workers,
                    );
                }
                after = page.next;
                if after.is_none() {
                    break;
                }
            }
            for entry in files.list(ROOT).await.map_err(|_| {
                rutis::host::ErrorKind::PluginFailed("Cannot list native media inputs".into())
            })? {
                let id = entry.name.strip_prefix(&format!("{ROOT}/")).unwrap_or("");
                if id.len() == 36
                    && uuid::Uuid::parse_str(id).is_ok()
                    && !retained.contains(&entry.name)
                {
                    files.remove(&entry.name).await.map_err(|_| {
                        rutis::host::ErrorKind::PluginFailed(
                            "Cannot clean native media inputs".into(),
                        )
                    })?;
                }
            }
            methods.register(
                ctx,
                "deepchat.native_media_inputs",
                vec![MethodDecl::new(
                    "deepchat.native_media_inputs.submit",
                    false,
                    Interruption::Report,
                )],
                Arc::new(move |call, cancel, _| {
                    let (tasks, files, storage, root, stop, workers) = (
                        tasks.clone(),
                        files.clone(),
                        storage.clone(),
                        root.clone(),
                        stop.clone(),
                        workers.clone(),
                    );
                    Box::pin(async move {
                        let mut input: TaskSubmit =
                            super::payload::decode(call.params, &storage, &cancel).await?;
                        let directory = format!("{ROOT}/{}", uuid::Uuid::new_v4());
                        let mut staged = false;
                        let mut total = 0usize;
                        for (index, file) in input.files.iter_mut().enumerate() {
                            if file.node_path.is_some() {
                                continue;
                            }
                            if let Some(data) = file.data_base64.take() {
                                if data.len()
                                    > (dim_modality::MAX_SUBMISSION_BYTES as usize).div_ceil(3) * 4
                                {
                                    return Err(RpcError::invalid(
                                        "Native media input exceeds its file limit",
                                    ));
                                }
                                let bytes = STANDARD.decode(data).map_err(|_| {
                                    RpcError::invalid("Invalid native media base64 input")
                                })?;
                                total += bytes.len();
                                if total > dim_modality::MAX_SUBMISSION_BYTES as usize {
                                    return Err(RpcError::invalid(
                                        "Native media input exceeds its file limit",
                                    ));
                                }
                                let absolute =
                                    files.directory(&directory).await.map_err(|_| failed())?;
                                let name = format!("input-{index}");
                                files
                                    .write_stream(
                                        &format!("{directory}/{name}"),
                                        Cursor::new(bytes),
                                    )
                                    .await
                                    .map_err(|_| failed())?;
                                file.node_path =
                                    Some(absolute.join(name).to_string_lossy().into_owned());
                                staged = true;
                            }
                        }
                        // On an uncertain admission the staging directory survives. Startup
                        // reconciliation can safely remove it after Modality recovery.
                        let result = tasks.submit(input, &cancel).await?;
                        if staged && !owned(&result.task, &root).contains(&directory) {
                            files.remove(&directory).await.map_err(|_| failed())?;
                        }
                        observe(
                            tasks.clone(),
                            files,
                            result.task.clone(),
                            &root,
                            stop,
                            &workers,
                        );
                        reply(result)
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
