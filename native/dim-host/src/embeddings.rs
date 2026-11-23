//! Embeddings use the catalog's public non-chat connection owner and dim's
//! pinned Aimux implementation. No credentials or provider HTTP cross to Node.
use aimux_core::embedding_model::{EmbeddingCallOptions, embed};
use aimux_core::{AbortSignal, AiMuxError};
use aimux_provider_utils::Resolvable;
use aimux_providers::PresetSettings;
use dim_agent_aimux::MediaTransport;
use dim_agent_capabilities::host::{
    ModalityConnectionHost, ModalityTarget, ModelConnection, ModelProtocol,
};
use dim_agent_capabilities::methods::{Interruption, MethodDecl, RpcError, params, reply};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_agent_types::ModelId;
use dim_app_server::{methods::ManagementMethods, provider::ProviderService};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::json;
use std::{future::pending, sync::Arc};

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(Embeddings::new(names)?)));
}
struct Embeddings {
    methods: Key<ManagementMethods>,
    connection: Key<ModalityConnectionHost>,
    providers: Key<ProviderService>,
}
impl Embeddings {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            methods: names.key()?,
            connection: names.key()?,
            providers: names.key()?,
        })
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    model: ModelId,
    values: Vec<String>,
}
impl DynPlugin for Embeddings {
    fn name(&self) -> &str {
        "DeepChatEmbeddings"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.methods.erase(),
            self.connection.erase(),
            self.providers.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let methods = ctx.require_at(&self.methods)?;
            let connection = ctx.require_at(&self.connection)?;
            let providers = ctx.require_at(&self.providers)?;
            methods.register(
                ctx,
                "deepchat.native_embeddings",
                vec![MethodDecl::new(
                    "deepchat.native_embeddings.embed",
                    false,
                    Interruption::Report,
                )],
                Arc::new(move |call, cancel, _| {
                    let (connection, providers) = (connection.clone(), providers.clone());
                    Box::pin(async move {
                        let input: Input = params(call.params)?;
                        // A transport page, not a provider batch limit. Rust applies each
                        // model's own limit below. This bounds the response frame as well.
                        if input.values.is_empty() || input.values.len() > 32 {
                            return Err(RpcError::invalid(
                                "Embedding page requires 1 to 32 values",
                            ));
                        }
                        let closed = async move {
                            match call.origin.caller {
                                Some(caller) => caller.closed().await,
                                None => pending::<()>().await,
                            }
                        };
                        let run_cancel = cancel.child_token();
                        let operation = run(&connection, &providers, input, &run_cancel);
                        tokio::pin!(operation);
                        tokio::select! {
                            result = &mut operation => result,
                            _ = closed => { run_cancel.cancel(); operation.await }
                        }
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
async fn run(
    connection: &ModalityConnectionHost,
    providers: &Arc<ProviderService>,
    input: Input,
    run_cancel: &tokio_util::sync::CancellationToken,
) -> Result<serde_json::Value, RpcError> {
    let view = providers
        .management(Some(input.model.provider_id.clone()), run_cancel)
        .await
        .map_err(|_| failed())?;
    let candidates = view
        .providers
        .iter()
        .find(|row| row.provider_id == input.model.provider_id)
        .and_then(|row| row.models.as_ref())
        .and_then(|models| {
            models
                .iter()
                .find(|row| row.model.model_id == input.model.model_id)
        })
        .and_then(|row| row.model.metadata.as_ref())
        .and_then(|metadata| metadata.raw.get("deepchatMediaVendors"))
        .and_then(|value| value.as_array());
    let resolved = connection
        .0
        .resolve_for_modality(
            ModalityTarget {
                target: input.model,
                operation: "embedding.embed".into(),
            },
            run_cancel.clone(),
        )
        .await
        .map_err(|_| failed())?;
    let ModelConnection::Http(http) = &resolved.resolved.connection else {
        return Err(RpcError::service(
            "model_unavailable",
            "Embedding connection is unavailable",
        ));
    };
    let names = aimux_providers::provider_names();
    let explicit = candidates.and_then(|values| {
        values
            .iter()
            .filter_map(|value| value.as_str())
            .map(|name| match name {
                "gemini" => "google",
                "jina" => "jina_ai",
                other => other,
            })
            .find(|name| names.contains(name))
    });
    let name = explicit
        .or(http.preset.as_deref())
        .unwrap_or(match http.protocol {
            ModelProtocol::Gemini => "google",
            _ => "openai",
        });
    let (base_url, fetch) = MediaTransport::new().resolve(&http.network, &http.base_url);
    let provider = aimux_providers::create_provider(
        name,
        PresetSettings {
            api_key: Some(Resolvable::Value(
                http.bearer
                    .clone()
                    .or_else(|| http.api_key.clone())
                    .unwrap_or_default(),
            )),
            base_url: Some(base_url),
            headers: Some(
                http.headers
                    .iter()
                    .map(|(name, value)| (name.clone(), Some(value.clone())))
                    .collect(),
            ),
            fetch: Some(fetch),
            ..Default::default()
        },
    )
    .map_err(|_| failed())?;
    let model = provider
        .embedding_model(&resolved.model)
        .map_err(|_| failed())?;
    let mut limit = model
        .max_embeddings_per_call()
        .map(|value| value as usize)
        .unwrap_or(input.values.len())
        .clamp(1, input.values.len());
    let mut vectors = Vec::with_capacity(input.values.len());
    let mut offset = 0;
    while offset < input.values.len() {
        let end = (offset + limit).min(input.values.len());
        let signal = AbortSignal::new();
        let mut options = EmbeddingCallOptions::new("");
        options.values = input.values[offset..end].to_vec();
        options.abort_signal = Some(signal.clone());
        let operation = embed(model.as_ref(), options);
        tokio::pin!(operation);
        let result = tokio::select! {
            result = &mut operation => result,
            _ = run_cancel.cancelled() => { signal.abort(); operation.await }
        };
        match result {
            Ok(result) => {
                if result.embeddings.len() != end - offset
                    || result.embeddings.iter().any(|vector| {
                        vector.is_empty() || vector.iter().any(|value| !value.is_finite())
                    })
                {
                    return Err(RpcError::service(
                        "invalid_embedding",
                        "Provider returned invalid embedding vectors",
                    ));
                }
                vectors.extend(result.embeddings);
                if vectors.iter().map(Vec::len).sum::<usize>() > 1_000_000 {
                    return Err(RpcError::service(
                        "embedding_too_large",
                        "Embedding result exceeds transport page limit",
                    ));
                }
                offset = end;
            }
            Err(error) if limit > 1 && batch_rejected(&error) => {
                limit = (limit / 2).max(1);
            }
            Err(_) => return Err(failed()),
        }
    }
    reply(json!({ "vectors": vectors }))
}

fn failed() -> RpcError {
    // Vendor errors may echo request headers. Never serialize the connection
    // or raw vendor error across the product boundary.
    RpcError::service("embedding_failed", "Native embedding request failed")
}
fn batch_rejected(error: &AiMuxError) -> bool {
    let AiMuxError::ApiCall(error) = error else {
        return false;
    };
    if error.status_code != Some(400) {
        return false;
    }
    let message = format!(
        "{} {}",
        error.message,
        error.response_body.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    ![
        "token",
        "context",
        "too long",
        "per input",
        "characters",
        "bytes",
    ]
    .iter()
    .any(|word| message.contains(word))
        && [
            "batch size",
            "batch_size",
            "too many inputs",
            "too many texts",
            "too many documents",
        ]
        .iter()
        .any(|word| message.contains(word))
}
