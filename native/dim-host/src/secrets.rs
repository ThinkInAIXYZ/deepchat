//! Only opaque references are durable. The desktop credential owner supplies a
//! value for a single native connection; neither errors nor Timeline contain it.
use dim_agent_capabilities::host::{HostError, HostFuture};
use dim_agent_runtime::AgentBuilder;
use dim_app_server::provider::{ProviderSecret, ProviderSecretHost, ResolveProviderSecret};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key};
use serde_json::json;
use std::{sync::Arc, time::Duration};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| Ok(Box::new(Secrets { key: names.key()? })));
}
struct Secrets {
    key: Key<ProviderSecretHost>,
}
impl DynPlugin for Secrets {
    fn name(&self) -> &str {
        "DeepChatCredentialReferences"
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            ctx.provide_at(
                self.key.clone(),
                Arc::new(ProviderSecretHost(Arc::new(DesktopSecrets))),
            )?;
            Ok(Effect::Done)
        })
    }
}
struct DesktopSecrets;
impl ResolveProviderSecret for DesktopSecrets {
    fn resolve(
        &self,
        provider_id: String,
        reference: String,
        cancel: CancellationToken,
    ) -> HostFuture<'_, ProviderSecret> {
        Box::pin(async move {
            let address = super::GATEWAY
                .get()
                .and_then(Option::as_ref)
                .ok_or_else(|| HostError::failed("Desktop credential owner is unavailable"))?;
            let operation = async {
                #[cfg(unix)]
                let socket = tokio::net::UnixStream::connect(address).await;
                #[cfg(windows)]
                let socket = tokio::net::windows::named_pipe::ClientOptions::new().open(address);
                let mut socket = socket.map_err(|_| unavailable())?;
                let mut frame = serde_json::to_vec(&json!({
                    "kind": "credential", "providerId": provider_id, "reference": reference
                }))
                .map_err(|_| unavailable())?;
                frame.push(b'\n');
                socket.write_all(&frame).await.map_err(|_| unavailable())?;
                let mut reader = BufReader::new(socket);
                let mut bytes = Vec::new();
                // Bound before allocation: credential responses never need large frames.
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
                    if bytes.len() + n > 1024 * 1024 {
                        return Err(unavailable());
                    }
                    let done = available[n - 1] == b'\n';
                    bytes.extend_from_slice(&available[..n]);
                    reader.consume(n);
                    if done {
                        break;
                    }
                }
                let reply: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
                serde_json::from_value(reply.get("result").cloned().ok_or_else(unavailable)?)
                    .map_err(|_| unavailable())
            };
            tokio::select! {
                _ = cancel.cancelled() => Err(HostError::Cancelled("Credential lookup cancelled".into())),
                result = tokio::time::timeout(Duration::from_secs(20), operation) => result.map_err(|_| unavailable())?,
            }
        })
    }
}
fn unavailable() -> HostError {
    HostError::failed("Desktop credential lookup failed")
}
