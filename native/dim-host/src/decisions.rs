//! Product decision vocabulary and Workers AI envelope adaptation; Aimux owns decisions.
use aimux_core::decision_model::{DecideOptions, decide};
use aimux_core::{AbortSignal, Provider};
use aimux_provider_utils::fetch::{Fetch, FetchError, FetchFunction, FetchRequest, FetchResponse};
use aimux_providers::{JevConfig, JevProvider};
use dim_agent_aimux::MediaTransport;
use dim_agent_capabilities::host::{ModalityConnectionHost, ModalityTarget, ModelConnection};
use dim_agent_capabilities::methods::{Interruption, MethodDecl, RpcError, params, reply};
use dim_agent_runtime::{AgentBuilder, Names};
use dim_agent_types::ModelId;
use dim_app_server::{methods::ManagementMethods, provider::ProviderService};
use futures_util::StreamExt;
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{future::pending, sync::Arc};
use tokio_util::sync::CancellationToken;

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(Decisions::new(names)?)));
}
struct Decisions {
    methods: Key<ManagementMethods>,
    connection: Key<ModalityConnectionHost>,
    providers: Key<ProviderService>,
}
impl Decisions {
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
    state: Value,
    questions: serde_json::Map<String, Value>,
}
impl DynPlugin for Decisions {
    fn name(&self) -> &str {
        "DeepChatDecisions"
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
            let connection = ctx.require_at(&self.connection)?;
            let providers = ctx.require_at(&self.providers)?;
            ctx.require_at(&self.methods)?.register(
                ctx,
                "deepchat.native_decisions",
                vec![MethodDecl::new(
                    "deepchat.native_decisions.decide",
                    false,
                    Interruption::Report,
                )],
                Arc::new(move |call, cancel, _| {
                    let (connection, providers) = (connection.clone(), providers.clone());
                    Box::pin(async move {
                        let input: Input = params(call.params)?;
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
    mut input: Input,
    cancel: &CancellationToken,
) -> Result<Value, RpcError> {
    for question in input.questions.values_mut() {
        if question.get("type").and_then(Value::as_str) == Some("noul") {
            question["type"] = json!("boolean");
        }
    }
    let mut options: DecideOptions = serde_json::from_value(json!({
        "state":input.state,"questions":input.questions,"timeout":{"totalMs":30_000}
    }))
    .map_err(|_| RpcError::invalid("Invalid native decision questions or state"))?;
    let view = providers
        .management(Some(input.model.provider_id.clone()), cancel)
        .await
        .map_err(|_| failed())?;
    let vendors = view
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
        .and_then(Value::as_array)
        .ok_or_else(failed)?;
    let has_vendor = |name: &str| vendors.iter().any(|value| value.as_str() == Some(name));
    let workers = has_vendor("workers-ai");
    if !workers && !has_vendor("jev") {
        return Err(failed());
    }
    let resolved = connection
        .0
        .resolve_for_modality(
            ModalityTarget {
                target: input.model,
                operation: "decision.decide".into(),
            },
            cancel.clone(),
        )
        .await
        .map_err(|_| failed())?;
    let ModelConnection::Http(http) = &resolved.resolved.connection else {
        return Err(failed());
    };
    let (mut endpoint, fetch) = MediaTransport::new().resolve(&http.network, &http.base_url);
    if workers {
        let root = endpoint
            .trim_end_matches('/')
            .strip_suffix("/v1")
            .ok_or_else(failed)?;
        if !root.contains("/accounts/") || !root.ends_with("/ai") {
            return Err(failed());
        }
        endpoint = format!("{root}/run");
    }
    let token = http
        .bearer
        .clone()
        .or_else(|| http.api_key.clone())
        .filter(|value| !value.is_empty())
        .ok_or_else(failed)?;
    let mut config = JevConfig::new(token).with_endpoint(endpoint);
    config.headers = http.headers.clone();
    config.fetch = Some(Arc::new(ProductTransport {
        inner: fetch,
        workers,
    }));
    let provider = JevProvider::new(config);
    let model = provider
        .decision_model(&resolved.model)
        .ok_or_else(failed)?
        .map_err(|_| failed())?;
    let signal = AbortSignal::new();
    options.abort_signal = Some(signal.clone());
    let operation = decide(model.as_ref(), options);
    tokio::pin!(operation);
    let result = tokio::select! {
        result = &mut operation => result,
        _ = cancel.cancelled() => { signal.abort(); operation.await }
    }
    .map_err(|_| failed())?;
    let raw = result.response.body.ok_or_else(failed)?;
    reply(
        json!({"model": result.response.model_id, "answers":raw["answers"], "usage":raw["usage"]}),
    )
}
struct ProductTransport {
    inner: FetchFunction,
    workers: bool,
}
#[async_trait::async_trait]
impl Fetch for ProductTransport {
    async fn fetch(&self, mut request: FetchRequest) -> Result<FetchResponse, FetchError> {
        let invalid = || FetchError::Other("Invalid decision provider envelope".into());
        if self.workers && !request.body.is_empty() {
            let value: Value = serde_json::from_slice(&request.body).map_err(|_| invalid())?;
            request.body = serde_json::to_vec(&json!({"model":value["model"],
                "input":{"state":value["state"],"questions":value["questions"]}}))
            .map_err(|_| invalid())?
            .into();
        }
        let response = self.inner.fetch(request).await?;
        if !response.status.is_success() {
            return Ok(response);
        }
        let (status, headers, url) = (response.status, response.headers, response.url);
        let mut stream = response.body;
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if bytes.len() + chunk.len() > 14 * 1024 * 1024 {
                return Err(invalid());
            }
            bytes.extend_from_slice(&chunk);
        }
        let mut value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if self.workers {
            if value.get("success") == Some(&json!(false)) {
                return Err(invalid());
            }
            value = value.get("result").cloned().unwrap_or(value);
        }
        let object = value.as_object_mut().ok_or_else(invalid)?;
        if object.get("usage").is_none_or(Value::is_null) {
            object.insert("usage".into(), json!({}));
        }
        let body = serde_json::to_vec(&value).map_err(|_| invalid())?;
        Ok(FetchResponse::from_bytes(status, headers, url, body.into()))
    }
}
fn failed() -> RpcError {
    RpcError::service("decision_failed", "Native decision request failed")
}
