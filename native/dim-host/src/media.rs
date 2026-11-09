//! Custom desktop providers retain their UUID identity. Only their media vendor
//! name is adapted; execution, connections, files and task recovery belong to dim.
use dim_agent_capabilities::host::ModalityConnection;
use dim_agent_capabilities::methods::{Interruption, MethodDecl, RpcError, params, reply};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_agent_types::ModelId;
use dim_app_server::{methods::ManagementMethods, provider::ProviderService};
use dim_modality::{
    AdapterError, AdapterFuture, AdapterOperation, AdapterOutput, Job, ModalityAdapter,
    ModalityAdapterService, ProgressSink, RealtimeEvent, RealtimeFrame, RealtimeOpened,
    RemoteCancel, Submitted,
};
use dim_modality_aimux::{MediaAdapter, vendor};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};
use tokio_util::sync::CancellationToken;

type Aliases = HashMap<(String, String), String>;
pub fn install(builder: &mut AgentBuilder) {
    dim_agent_runtime::names::register::<ModalityAdapterService>(builder.catalog_mut(), None);
    builder.plugin(|names| Ok(Box::new(Media::new(names)?)));
}
struct Media {
    providers: Key<ProviderService>,
    methods: Key<ManagementMethods>,
}
impl Media {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            providers: names.key()?,
            methods: names.key()?,
        })
    }
}
impl DynPlugin for Media {
    fn name(&self) -> &str {
        "DeepChatMediaProviders"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.providers.erase(), self.methods.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let providers = ctx.require_at(&self.providers)?;
            let methods = ctx.require_at(&self.methods)?;
            let adapter = Arc::new(DesktopMedia {
                native: MediaAdapter::new(),
                aliases: RwLock::default(),
            });
            let cancel = ctx.cancellation_token();
            let ids = providers.list(&cancel).await.map_err(|_| {
                rutis::host::ErrorKind::PluginFailed(
                    "Cannot read native media provider identities".into(),
                )
            })?;
            for provider in ids.providers {
                // Bundled vendors already use dim's own identity and need no mapping.
                if provider.source == "custom" && vendor::vendor(&provider.provider_id).is_none() {
                    // A broken provider stays unavailable without preventing other native
                    // providers or history readers from starting. Explicit admission reports it.
                    let _ = refresh(&providers, &adapter, &provider.provider_id, &cancel).await;
                }
            }
            ctx.provide(ModalityAdapterService(adapter.clone()))?;
            let lane = Arc::new(tokio::sync::Mutex::new(()));
            methods.register(
                ctx,
                "deepchat.native_media",
                vec![MethodDecl::new(
                    "deepchat.native_media.refresh",
                    false,
                    Interruption::Report,
                )],
                Arc::new(move |call, cancel, _| {
                    let (providers, adapter, lane) =
                        (providers.clone(), adapter.clone(), lane.clone());
                    Box::pin(async move {
                        #[derive(Deserialize)]
                        #[serde(rename_all = "camelCase", deny_unknown_fields)]
                        struct Target {
                            provider_id: String,
                        }
                        let target: Target = params(call.params)?;
                        let _guard = lane.lock().await;
                        let count =
                            refresh(&providers, &adapter, &target.provider_id, &cancel).await?;
                        reply(json!({"models":count}))
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
async fn refresh(
    providers: &Arc<ProviderService>,
    adapter: &DesktopMedia,
    id: &str,
    cancel: &CancellationToken,
) -> Result<usize, RpcError> {
    // Public safe management view: no credential, private store or model request is read here.
    let view = providers
        .management(Some(id.into()), cancel)
        .await
        .map_err(|_| {
            RpcError::service(
                "media_provider_unavailable",
                "Native media provider is unavailable",
            )
        })?;
    if !view.errors.is_empty() {
        return Err(RpcError::service(
            "media_provider_unavailable",
            "Native media provider cannot be read",
        ));
    }
    let mut aliases = Aliases::new();
    for provider in view.providers {
        if provider.provider_id != id {
            continue;
        }
        for model in provider.models.unwrap_or_default() {
            let explicit = model
                .model
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.raw.get("deepchatMediaVendors"))
                .and_then(Value::as_array)
                .and_then(|names| {
                    names
                        .iter()
                        .filter_map(Value::as_str)
                        .find(|name| vendor::vendor(name).is_some())
                });
            let inferred = provider.connection.as_ref().and_then(|connection| {
                match connection.driver_kind.as_str() {
                    "openai-compatible" | "openai-responses" => Some("openai"),
                    "gemini" => Some("google"),
                    "xai" | "xai-responses" => Some("xai"),
                    _ => None,
                }
            });
            if let Some(vendor) = explicit
                .or(inferred)
                .filter(|name| vendor::vendor(name).is_some())
            {
                aliases.insert((id.into(), model.model.model_id), vendor.into());
            }
        }
    }
    let count = aliases.len();
    let mut current = adapter.aliases.write().unwrap();
    current.retain(|(provider, _), _| provider != id);
    current.extend(aliases);
    Ok(count)
}
struct DesktopMedia {
    native: MediaAdapter,
    aliases: RwLock<Aliases>,
}
impl DesktopMedia {
    fn model(&self, model: &ModelId) -> Option<ModelId> {
        if vendor::vendor(&model.provider_id).is_some() {
            return Some(model.clone());
        }
        self.aliases
            .read()
            .unwrap()
            .get(&(model.provider_id.clone(), model.model_id.clone()))
            .map(|vendor| ModelId {
                provider_id: vendor.clone(),
                model_id: model.model_id.clone(),
            })
    }
}
impl ModalityAdapter for DesktopMedia {
    fn available(&self) -> bool {
        self.native.available()
    }
    fn operations(&self, model: &ModelId) -> Vec<AdapterOperation> {
        self.model(model)
            .map(|model| self.native.operations(&model))
            .unwrap_or_else(|| self.native.operations(model))
    }
    fn submit(
        &self,
        mut job: Job,
        connection: ModalityConnection,
        cancel: CancellationToken,
    ) -> AdapterFuture<'_, Submitted> {
        Box::pin(async move {
            job.model = self
                .model(&job.model)
                .ok_or_else(|| AdapterError::unavailable("Native media vendor is unavailable"))?;
            self.native.submit(job, connection, cancel).await
        })
    }
    fn wait(
        &self,
        task_id: &str,
        handle: Option<&str>,
        connection: ModalityConnection,
        progress: ProgressSink,
        cancel: CancellationToken,
    ) -> AdapterFuture<'_, AdapterOutput> {
        self.native
            .wait(task_id, handle, connection, progress, cancel)
    }
    fn cancel_remote(
        &self,
        handle: &str,
        connection: ModalityConnection,
    ) -> AdapterFuture<'_, RemoteCancel> {
        self.native.cancel_remote(handle, connection)
    }
    fn realtime_open(
        &self,
        connection: ModalityConnection,
        params: Value,
        events: tokio::sync::mpsc::Sender<RealtimeEvent>,
        cancel: CancellationToken,
    ) -> AdapterFuture<'_, RealtimeOpened> {
        self.native
            .realtime_open(connection, params, events, cancel)
    }
    fn realtime_send(
        &self,
        channel_id: &str,
        frame: RealtimeFrame,
        cancel: CancellationToken,
    ) -> AdapterFuture<'_, ()> {
        self.native.realtime_send(channel_id, frame, cancel)
    }
    fn realtime_close(&self, channel_id: &str) -> AdapterFuture<'_, ()> {
        self.native.realtime_close(channel_id)
    }
}
