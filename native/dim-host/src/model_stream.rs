//! A single auxiliary stream over dim's public model and recovery owners.
//! No session, tool dispatch, history or agent loop is created by this adapter.
use dim_agent_capabilities::{
    auxiliary_model::AuxiliaryTarget,
    host::{
        AuxiliaryError, AuxiliaryReply, AuxiliaryRequest, HostError, ModelChunk, ModelHost,
        ModelStopReason, ModelStream, ResolveModelConnection,
    },
    methods::Progress,
    model_provider::{RetryObserver, invoke_with_recovery},
};
use dim_agent_types::{ModelRequest, SystemPrompt};
use futures_util::{StreamExt, future::BoxFuture};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use tokio_util::sync::CancellationToken;

struct Consumer {
    progress: Progress,
    count: Arc<AtomicU64>,
}
impl RetryObserver for Consumer {}
impl Consumer {
    fn send(&self, value: Value) -> Result<(), HostError> {
        let sequence = self.count.fetch_add(1, Ordering::SeqCst) + 1;
        self.progress
            .send(json!({"sequence":sequence.to_string(), "event":value}));
        Ok(())
    }
}

pub async fn run(
    host: &ModelHost,
    connection: &dyn ResolveModelConnection,
    target: AuxiliaryTarget,
    request: AuxiliaryRequest,
    cancel: &CancellationToken,
    progress: Progress,
    count: Arc<AtomicU64>,
) -> Result<AuxiliaryReply, AuxiliaryError> {
    let mut config = target.config;
    let allowance = config
        .max_tokens
        .ok_or_else(|| HostError::failed("Model output allowance is missing"))?;
    config.max_tokens = Some(
        request
            .max_output_tokens
            .map_or(allowance, |max| f64::from(max).min(allowance)),
    );
    let mut input = ModelRequest::new(
        target.model.provider_id,
        target.model.model_id,
        request.messages,
    );
    input.system = request
        .system
        .map(|text| Arc::new(SystemPrompt::Text(text)));
    input.capability_snapshot = target.capability_snapshot;
    input.config = Some(config);
    let input = Arc::new(input);
    let resolved = connection.resolve(input.clone(), cancel.clone()).await?;
    invoke_with_recovery(
        host,
        &input,
        None,
        resolved,
        cancel,
        &mut Consumer { progress, count },
        consume,
    )
    .await
    .map_err(AuxiliaryError::from)
}

fn consume<'a>(
    mut stream: ModelStream,
    output: &'a mut Consumer,
    cancel: CancellationToken,
    replay_safe: &'a mut bool,
) -> BoxFuture<'a, Result<AuxiliaryReply, HostError>> {
    Box::pin(async move {
        let (mut text, mut usage, mut stop_reason) = (String::new(), None, None);
        loop {
            let chunk = tokio::select! {
                _ = cancel.cancelled() => return Err(HostError::Cancelled("Native stream cancelled".into())),
                chunk = stream.next() => match chunk { Some(chunk) => chunk?, None => break }
            };
            match chunk {
                ModelChunk::Text(delta) => {
                    *replay_safe = false;
                    text.push_str(&delta);
                    output.send(json!({"type":"text", "content":delta}))?;
                }
                ModelChunk::Thinking(delta) => {
                    *replay_safe = false;
                    output.send(json!({"type":"reasoning", "reasoning_content":delta}))?;
                }
                ModelChunk::Usage(value) => usage = Some(value),
                ModelChunk::MessageStop { reason, .. } => stop_reason = Some(reason),
                ModelChunk::ToolStart { .. } | ModelChunk::ToolUse(_) => {
                    return Err(HostError::failed(
                        "Auxiliary model requested an unavailable tool",
                    ));
                }
                _ => {}
            }
        }
        let stop_reason =
            stop_reason.ok_or_else(|| HostError::failed("Native stream ended without a stop"))?;
        if stop_reason == ModelStopReason::ToolUse {
            return Err(HostError::failed(
                "Auxiliary model stopped for an unavailable tool",
            ));
        }
        if let Some(value) = &usage {
            let mut data = json!({
                "prompt_tokens":value.prompt_tokens, "completion_tokens":value.completion_tokens,
                "total_tokens":value.total_tokens
            });
            if let Some(tokens) = value.cache_read_tokens {
                data["cached_tokens"] = json!(tokens);
            }
            if let Some(tokens) = value.cache_write_tokens {
                data["cache_write_tokens"] = json!(tokens);
            }
            output.send(json!({"type":"usage", "usage":data}))?;
        }
        output.send(json!({"type":"stop", "stop_reason": if stop_reason == ModelStopReason::MaxTokens {"max_tokens"} else {"complete"}}))?;
        Ok(AuxiliaryReply {
            text,
            stop_reason,
            usage,
        })
    })
}
