//! Bounded private product callback. Closing the native future closes its socket,
//! which cancels the corresponding desktop work; no callback is retried.
use dim_agent_capabilities::host::HostError;
use serde_json::Value;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

pub(crate) async fn request(
    value: Value,
    cancel: CancellationToken,
    max_bytes: usize,
) -> Result<Value, HostError> {
    let address = super::GATEWAY
        .get()
        .and_then(Option::as_ref)
        .ok_or_else(unavailable)?;
    let operation = async {
        #[cfg(unix)]
        let socket = tokio::net::UnixStream::connect(address).await;
        #[cfg(windows)]
        let socket = tokio::net::windows::named_pipe::ClientOptions::new().open(address);
        let mut socket = socket.map_err(|_| unavailable())?;
        let mut frame = serde_json::to_vec(&value).map_err(|_| unavailable())?;
        if frame.len() > max_bytes {
            return Err(unavailable());
        }
        frame.push(b'\n');
        socket.write_all(&frame).await.map_err(|_| unavailable())?;
        let mut reader = BufReader::new(socket);
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
            if bytes.len() + n > max_bytes {
                return Err(unavailable());
            }
            let done = available[n - 1] == b'\n';
            bytes.extend_from_slice(&available[..n]);
            reader.consume(n);
            if done {
                break;
            }
        }
        let reply: Value = serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
        reply.get("result").cloned().ok_or_else(unavailable)
    };
    tokio::select! {
        _ = cancel.cancelled() => Err(HostError::Cancelled("Product context cancelled".into())),
        result = tokio::time::timeout(Duration::from_secs(60), operation) => result.map_err(|_| unavailable())?,
    }
}
fn unavailable() -> HostError {
    HostError::failed("Desktop product context is unavailable")
}
