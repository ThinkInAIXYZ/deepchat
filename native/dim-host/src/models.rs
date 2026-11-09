//! Product configuration is a plugin concern. Selection, connection resolution,
//! retries, cancellation and inference remain dim's native operations.
use dim_agent_capabilities::{
    auxiliary_model::{self, AuxiliaryTarget},
    host::{AuxiliaryRequest, ModelHost, ModelSelectionHost, ProviderConnectionResolver},
    methods::{Interruption, MethodDecl, RpcError, params, reply},
};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_agent_types::{ModelConfig, ModelId};
use dim_app_server::methods::ManagementMethods;
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::json;
use std::{future::pending, sync::Arc, time::Instant};

pub const SOURCE_REVISION: &str = "0423b321abc923900525d79d030fd690110f91c4";

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(Models::new(names)?)));
}

struct Models {
    methods: Key<ManagementMethods>,
    selection: Key<ModelSelectionHost>,
    connection: Key<ProviderConnectionResolver>,
    host: Key<ModelHost>,
}
impl Models {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            methods: names.key()?,
            selection: names.key()?,
            connection: names.key()?,
            host: names.key()?,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Complete {
    model: ModelId,
    request: AuxiliaryRequest,
    #[serde(default)]
    config: ModelConfig,
}

impl DynPlugin for Models {
    fn name(&self) -> &str {
        "DeepChatNativeModels"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.methods.erase(),
            self.selection.erase(),
            self.connection.erase(),
            self.host.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let methods = ctx.require_at(&self.methods)?;
            let selection = ctx.require_at(&self.selection)?;
            let connection = ctx.require_at(&self.connection)?;
            let host = ctx.require_at(&self.host)?;
            methods.register(ctx, "deepchat.native", vec![
                MethodDecl::new("deepchat.native.capabilities", false, Interruption::Report),
                MethodDecl::new("deepchat.native.complete", false, Interruption::Report),
            ], Arc::new(move |call, cancel, _| {
                let (selection, connection, host) = (selection.clone(), connection.clone(), host.clone());
                Box::pin(async move {
                    if call.method.ends_with(".capabilities") {
                        return reply(json!({
                            "apiVersion": 1, "plugin": "deepchat-native",
                            "sourceRevision": SOURCE_REVISION,
                            "bridgeVersion": env!("CARGO_PKG_VERSION"),
                            "features": ["generation-settings", "auxiliary-model", "credential-references", "native-media-providers", "native-product-tools", "product-context", "native-memory-audit", "native-scope"]
                        }));
                    }
                    let input: Complete = params(call.params)?;
                    auxiliary_model::check(&input.request)
                        .map_err(|_| RpcError::invalid("Invalid auxiliary request"))?;
                    super::settings::validate(&input.config)?;
                    let closed = async move {
                        match call.origin.caller {
                            Some(caller) => caller.closed().await,
                            None => pending::<()>().await,
                        }
                    };
                    let run_cancel = cancel.child_token();
                    let operation = async {
                        let selected = selection.0.resolve(Some(input.model.clone()), None, run_cancel.clone()).await
                            .map_err(|_| RpcError::service("model_unavailable", "Native model selection failed"))?;
                        let config = super::settings::merge(selected.config.unwrap_or_default(), input.config)?;
                        let started = Instant::now();
                        let result = auxiliary_model::complete(&host, connection.0.as_ref(), AuxiliaryTarget {
                            model: input.model.clone(), config, capability_snapshot: selected.capability_snapshot,
                        }, input.request, &run_cancel).await;
                        auxiliary_model::record(&input.model, started, result.as_ref());
                        reply(result.map_err(|_| RpcError::service("model_failed", "Native auxiliary model request failed"))?)
                    };
                    tokio::pin!(operation);
                    tokio::select! {
                        result = &mut operation => result,
                        _ = closed => {
                            run_cancel.cancel();
                            // Join native cancellation; do not detach a model request.
                            operation.await
                        }
                    }
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
