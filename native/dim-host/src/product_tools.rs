//! A Session-scoped tool source over desktop-only capabilities. dim owns binding,
//! permission, dispatch, cancellation and results; this plugin adds no execution loop.
use dim_agent_capabilities::{
    host::{HostError, HostFuture, ToolExecutionContext},
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    prompt_state::PromptSnapshot,
    timeline_tree::TreeCommands,
    tool_registry::{
        ToolContribution, ToolHandler, ToolProvider, ToolProviderChanged, ToolRegistry,
        ToolSourceSet, tool_provider_changes,
    },
};
use dim_agent_runtime::{AgentBuilder, Feature, Names, SESSION_GROUP, SessionIdentity};
use dim_agent_types::{ToolCall, ToolDefinition, ToolResult, ToolSourceVersion};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

const SOURCE: &str = "deepchat_product";
const MAX_FRAME: usize = 16 * 1024 * 1024;

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(
        Feature::new("DeepChatProductTools").session("DeepChatProductTools", |names| {
            Ok(Box::new(ProductTools::new(names)?))
        }),
    );
}
struct ProductTools {
    identity: Key<SessionIdentity>,
    registry: Key<ToolRegistry>,
    methods: Key<SessionMethods>,
    tree: Key<TreeCommands>,
    instance: rutis::host::InstanceId,
}
impl ProductTools {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            identity: names.key()?,
            registry: names.key()?,
            methods: names.key()?,
            tree: names.key()?,
            instance: names.instance(SESSION_GROUP)?,
        })
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    version: String,
    tools: Vec<ToolDefinition>,
}
#[derive(Default)]
struct Source(Mutex<Option<Published>>);
struct Published {
    catalog_version: String,
    set: Arc<ToolSourceSet>,
}
impl ToolProvider for Source {
    fn sets(&self) -> Vec<Arc<ToolSourceSet>> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|published| published.set.clone())
            .collect()
    }
}
impl DynPlugin for ProductTools {
    fn name(&self) -> &str {
        "DeepChatProductTools"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.identity.erase(),
            self.registry.erase(),
            self.methods.erase(),
            self.tree.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let identity = ctx.require_at(&self.identity)?;
            let registry = ctx.require_at(&self.registry)?;
            let methods = ctx.require_at(&self.methods)?;
            let tree = ctx.require_at(&self.tree)?;
            // Empty until the desktop has durably bound this Session and explicitly refreshed.
            let source = Arc::new(Source::default());
            registry.register_source(ctx, SOURCE, source.clone())?;
            let lane = Arc::new(tokio::sync::Mutex::new(()));
            let context = ctx.clone();
            let instance = self.instance;
            methods.register(
                ctx,
                "session.deepchat_tools",
                vec![MethodDecl::new(
                    "session.deepchat_tools.refresh",
                    true,
                    Interruption::Report,
                )],
                Arc::new(move |call, cancel, _| {
                    let (source, registry, identity, ctx, lane, tree) = (
                        source.clone(),
                        registry.clone(),
                        identity.clone(),
                        context.clone(),
                        lane.clone(),
                        tree.clone(),
                    );
                    Box::pin(async move {
                        #[derive(Deserialize)]
                        #[serde(rename_all = "camelCase", deny_unknown_fields)]
                        struct Ref {
                            session_id: String,
                            branch_id: String,
                        }
                        let target: Ref = params(call.params)?;
                        if target.session_id != identity.session_id || target.branch_id.is_empty() {
                            return Err(RpcError::invalid(
                                "Product catalog requires its native Session",
                            ));
                        }
                        let branch = tree.get(&target.branch_id)?;
                        let mut configuration = branch.on::<PromptSnapshot>().ok_or_else(|| RpcError::service("product_catalog_unavailable", "Native prompt state is unavailable"))?;
                        let _guard = tokio::select! {
                            _ = cancel.cancelled() => return Err(RpcError::interrupted()),
                            guard = lane.lock() => guard,
                        };
                        let updated = tokio::time::timeout(
                            Duration::from_secs(20),
                            request(
                                json!({"kind":"catalog", "sessionId":identity.session_id}),
                                cancel.clone(),
                            ),
                        )
                        .await
                        .map_err(|_| unavailable())
                        .and_then(|value| value)
                        .and_then(|value| {
                            serde_json::from_value::<Catalog>(value)
                                .map_err(|_| HostError::failed("Invalid product catalog"))
                        });
                        let catalog = match updated {
                            Ok(catalog) => catalog,
                            Err(_) => {
                                withdraw(&source, &registry, &ctx, instance)?;
                                return Err(RpcError::service("product_catalog_unavailable", "Product catalog is unavailable"));
                            }
                        };
                        if catalog.version.is_empty()
                            || catalog.tools.len() > 1024
                            || catalog.tools.iter().any(|tool| {
                                tool.source != dim_agent_types::ToolSource::Extension
                                    || !matches!(
                                        tool.risk.as_deref(),
                                        Some(
                                            "read_filesystem"
                                                | "write_filesystem"
                                                | "execute_process"
                                                | "network"
                                                | "session"
                                        )
                                    )
                            })
                        {
                            withdraw(&source, &registry, &ctx, instance)?;
                            return Err(RpcError::invalid("Invalid product catalog"));
                        }
                        let count = catalog.tools.len();
                        let unchanged = source.0.lock().unwrap().as_ref().is_some_and(|published| {
                            published.catalog_version == catalog.version && published.set.tools.len() == count &&
                            published.set.tools.iter().zip(&catalog.tools).all(|(old, new)| old.definition == *new)
                        });
                        if !unchanged {
                            let version = uuid::Uuid::new_v4().to_string();
                            let tools = catalog.tools.into_iter().map(|definition| Arc::new(ToolContribution {
                                handler: Arc::new(DesktopTool {
                                    session_id: identity.session_id.clone(), version: catalog.version.clone(),
                                    name: definition.name.clone(), stop: ctx.cancellation_token(),
                                }), definition,
                            })).collect();
                            *source.0.lock().unwrap() = Some(Published {
                                catalog_version: catalog.version.clone(),
                                set: Arc::new(ToolSourceSet { key: SOURCE.into(), version: version.clone(), tools }),
                            });
                            registry.definitions();
                            let status = registry.sources_state().borrow().0.get(SOURCE).cloned();
                            if !status.is_some_and(|status| status.adopted.as_deref() == Some(&version) && status.rejected.is_none()) {
                                withdraw(&source, &registry, &ctx, instance)?;
                                return Err(RpcError::service("product_catalog_rejected", "Native tool registry rejected the product catalog"));
                            }
                            changed(&ctx, instance)?;
                        }
                        // Registry acceptance precedes ToolBinding's asynchronous adoption.
                        // Observe its public native state before desktop admits an input, including
                        // MCP sources changed by the same preparation. No private owner call or poll.
                        let adopted = async {
                            let mut sources = registry.sources_state();
                            loop {
                                sources.borrow_and_update();
                                let (tools, sets) = registry.snapshot();
                                let versions: Vec<_> = sets.iter().map(|set| ToolSourceVersion { key: set.key.clone(), version: set.version.clone() }).collect();
                                let state = configuration.borrow_and_update().clone();
                                if state.configuration.is_some_and(|current| current.tools.as_ref() == Some(&tools) && current.tool_sources == versions) {
                                    return Ok(());
                                }
                                tokio::select! {
                                    _ = cancel.cancelled() => return Err(RpcError::interrupted()),
                                    changed = configuration.changed() => if changed.is_err() { return Err(RpcError::service("product_catalog_unavailable", "Native prompt owner ended")); },
                                    changed = sources.changed() => if changed.is_err() { return Err(RpcError::service("product_catalog_unavailable", "Native tool registry ended")); },
                                }
                            }
                        };
                        tokio::time::timeout(Duration::from_secs(10), adopted).await
                            .map_err(|_| RpcError::service("product_catalog_unavailable", "Native tool adoption did not complete"))??;
                        reply(json!({"version":catalog.version,"count":count}))
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
// A failed replacement withdraws future availability. Retained prefixes may still hold an old
// handler; the desktop independently reauthorizes its version on every invocation.
fn withdraw(
    source: &Source,
    registry: &ToolRegistry,
    ctx: &Ctx,
    instance: rutis::host::InstanceId,
) -> Result<(), RpcError> {
    *source.0.lock().unwrap() = None;
    registry.definitions();
    changed(ctx, instance)
}
fn changed(ctx: &Ctx, instance: rutis::host::InstanceId) -> Result<(), RpcError> {
    ctx.emit(ToolProviderChanged {
        name: tool_provider_changes(instance),
    })
    .map_err(|_| RpcError::service("product_catalog_unavailable", "Product catalog owner ended"))
}
struct DesktopTool {
    session_id: String,
    version: String,
    name: String,
    stop: CancellationToken,
}
impl ToolHandler for DesktopTool {
    fn execute(
        &self,
        call: ToolCall,
        context: ToolExecutionContext,
        cancel: CancellationToken,
    ) -> HostFuture<'_, ToolResult> {
        Box::pin(async move {
            let operation = request(
                json!({
                    "kind":"execute", "version":self.version, "name":self.name,
                    "sessionId":self.session_id, "branchId":context.branch_id,
                    "turnId":context.turn_id, "callId":call.id, "arguments":call.input,
                }),
                cancel.clone(),
            );
            let value = tokio::select! {
                _ = self.stop.cancelled() => { cancel.cancel(); return Err(HostError::Cancelled("Product Session closed".into())); },
                value = operation => value,
            }?;
            serde_json::from_value(value)
                .map_err(|_| HostError::failed("Invalid product tool result"))
        })
    }
}

async fn request(value: Value, cancel: CancellationToken) -> Result<Value, HostError> {
    let address = super::GATEWAY
        .get()
        .and_then(Option::as_ref)
        .ok_or_else(|| HostError::failed("Product capability owner is unavailable"))?;
    let mut frame = serde_json::to_vec(&value).map_err(|_| unavailable())?;
    if frame.len() >= MAX_FRAME {
        return Err(unavailable());
    }
    frame.push(b'\n');
    let connect = async {
        #[cfg(unix)]
        let socket = tokio::net::UnixStream::connect(address).await;
        #[cfg(windows)]
        let socket = tokio::net::windows::named_pipe::ClientOptions::new().open(address);
        socket.map_err(|_| unavailable())
    };
    let mut socket = tokio::select! {
        _ = cancel.cancelled() => return Err(HostError::Cancelled("Product capability cancelled".into())),
        result = tokio::time::timeout(Duration::from_secs(5), connect) => result.map_err(|_| unavailable())??,
    };
    let (read, mut write) = tokio::io::split(&mut socket);
    let mut reader = BufReader::new(read);
    let operation = async {
        write.write_all(&frame).await.map_err(|_| unavailable())?;
        read_frame(&mut reader).await
    };
    let value = tokio::select! {
        result = operation => result?,
        _ = cancel.cancelled() => {
            // One invocation, never replayed. Closing also aborts the desktop gateway's signal.
            let _ = tokio::time::timeout(Duration::from_secs(1), write.write_all(b"{\"kind\":\"cancel\"}\n")).await;
            return Err(HostError::Cancelled("Product capability cancelled".into()));
        }
    };
    value
        .get("result")
        .cloned()
        .ok_or_else(|| HostError::failed("Product capability was refused"))
}
async fn read_frame(reader: &mut (impl AsyncBufRead + Unpin)) -> Result<Value, HostError> {
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().await.map_err(|_| unavailable())?;
        if available.is_empty() {
            return Err(unavailable());
        }
        let n = available
            .iter()
            .position(|b| *b == b'\n')
            .map(|n| n + 1)
            .unwrap_or(available.len());
        if bytes.len() + n > MAX_FRAME {
            return Err(unavailable());
        }
        let done = available[n - 1] == b'\n';
        bytes.extend_from_slice(&available[..n]);
        reader.consume(n);
        if done {
            break;
        }
    }
    serde_json::from_slice(&bytes).map_err(|_| unavailable())
}
fn unavailable() -> HostError {
    HostError::failed("Product capability connection failed; outcome is unknown")
}
