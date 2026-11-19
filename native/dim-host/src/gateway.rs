//! Bounded private product callback. Closing the native future closes its socket,
//! which cancels the corresponding desktop work; no callback is retried.
use dim_agent_capabilities::host::HostError;
use serde_json::Value;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

/// Opens the desktop pipe. Every server instance can be busy while other
/// callbacks are connected; wait briefly for a free one instead of failing.
#[cfg(windows)]
pub(crate) async fn connect(
    address: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    const ERROR_PIPE_BUSY: i32 = 231;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    loop {
        match tokio::net::windows::named_pipe::ClientOptions::new().open(address) {
            Err(error)
                if error.raw_os_error() == Some(ERROR_PIPE_BUSY)
                    && tokio::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(50)).await
            }
            result => return result,
        }
    }
}

pub(crate) fn frame(mut value: Value, max_bytes: usize) -> Option<Vec<u8>> {
    value.as_object_mut()?.insert(
        "auth".into(),
        Value::String(super::GATEWAY_TOKEN.get()?.clone()),
    );
    let mut bytes = serde_json::to_vec(&value).ok()?;
    if bytes.len() >= max_bytes {
        return None;
    }
    bytes.push(b'\n');
    Some(bytes)
}

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
        let mut socket = connect(address).await.map_err(|_| unavailable())?;
        let frame = frame(value, max_bytes).ok_or_else(unavailable)?;
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

#[cfg(unix)]
pub(crate) async fn connect(address: &str) -> std::io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(address).await
}

/// Opens the desktop pipe. Every server instance can be busy while other
/// callbacks are connected; wait briefly for a free one instead of failing.
#[cfg(windows)]
pub(crate) async fn connect(
    address: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    const ERROR_PIPE_BUSY: i32 = 231;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    loop {
        match tokio::net::windows::named_pipe::ClientOptions::new().open(address) {
            Err(error)
                if error.raw_os_error() == Some(ERROR_PIPE_BUSY)
                    && tokio::time::Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(50)).await
            }
            result => return result,
        }
    }
}
