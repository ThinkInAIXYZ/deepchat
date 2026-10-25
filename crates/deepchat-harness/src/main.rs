use std::{
    collections::HashSet,
    error::Error,
    future::Future,
    io::Read,
    path::PathBuf,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::{stream::FuturesUnordered, StreamExt};
use rutis::{BoxFuture, CordisError, Ctx, Effect, Event, EventKey, Plugin, TypeKey};
use rutis_bridge::{
    runtime::{Launcher, LocalRuntime, RuntimeHandle, RuntimeState, Stdio},
    session::{host_key, settle, Error as BridgeError, HostDispatch, Value},
    transport::local::{kill_processes, processes_ended},
};
use rutis_loader::{
    Chain, Layer, LoaderOptions, LoaderPlugin, Patch, RuntimeResolver, RuntimeRowsPlugin,
    ServiceCatalog,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use tokio::{
    sync::{mpsc, oneshot},
    time::{sleep, timeout},
};

mod memory;
mod transport;
use transport::Output;

type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;
const MAX_FRAME: usize = 64 * 1024;
const MAX_MEMORY_FRAME: usize = 256 * 1024;
const MEMORY_FRAME_FLAG: u32 = 0x8000_0000;
const BINARY_FRAME_FLAG: u32 = 0x4000_0000;
const MAX_MEMORY_CHUNK: usize = 64 * 1024;
const MAX_CALLS: usize = 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Method {
    Acquire,
    Release,
    Snapshot,
    Close,
    FlushObservations,
}
impl Method {
    fn name(&self) -> &str {
        match self {
            Self::Acquire => "acquire",
            Self::Release => "release",
            Self::Snapshot => "snapshot",
            Self::Close => "close",
            Self::FlushObservations => "flushObservations",
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Call {
        id: u64,
        method: Method,
        args: Vec<Json>,
    },
    MemoryStart {
        config: Json,
    },
    MemoryCall {
        id: u64,
        command: Json,
        #[serde(skip)]
        data: Option<Vec<u8>>,
    },
}

#[derive(Serialize, Deserialize)]
struct Observation(u64, Json);
impl Event for Observation {
    const NAME: &'static str = "deepchat/admission/observation";
    type Value = ();
}

struct ObservationForwarder(Output);
impl rutis::Listener<Observation> for ObservationForwarder {
    fn call<'a>(
        &'a self,
        _: &'a Ctx,
        event: &'a Observation,
        _: rutis::Call<'a, ()>,
    ) -> BoxFuture<'a, std::result::Result<Option<()>, CordisError>> {
        Box::pin(async move {
            let value = event.1.clone();
            let _ = self
                .0
                .send(json!({ "type": "observation", "sequence": event.0, "value": value }))
                .await;
            Ok(None)
        })
    }
}

fn error(name: &str, message: impl ToString) -> Json {
    fn bounded(value: &str, max: usize) -> &str {
        let mut end = max.min(value.len());
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        &value[..end]
    }
    json!({ "name": bounded(name, 256), "message": bounded(&message.to_string(), 8192) })
}

fn response(id: u64, result: std::result::Result<Json, Json>) -> Json {
    match result {
        Ok(value) => json!({ "type": "reply", "id": id, "value": value }),
        Err(error) => json!({ "type": "reply", "id": id, "error": error }),
    }
}

fn bridge_error(error: BridgeError) -> Json {
    match error {
        BridgeError::Remote { name, message, .. } => self::error(&name, message),
        other => self::error("HarnessTransportError", other),
    }
}

async fn invoke(value: Value) -> std::result::Result<Json, Json> {
    let value = settle(value).await.map_err(bridge_error)?;
    match value {
        Value::Undefined => Ok(Json::Null),
        value => value.json().map_err(bridge_error),
    }
}

struct AdmissionGateway {
    injects: [TypeKey; 1],
    incoming: Mutex<Option<mpsc::Receiver<Request>>>,
    outgoing: Output,
}

impl Plugin for AdmissionGateway {
    fn name(&self) -> &str {
        "deepchat-admission-gateway"
    }
    fn injects(&self) -> &[TypeKey] {
        &self.injects
    }
    fn apply<'a>(
        &'a self,
        ctx: &'a Ctx,
    ) -> BoxFuture<'a, std::result::Result<Effect, CordisError>> {
        Box::pin(async move {
            let service = ctx.require_as::<dyn HostDispatch>(self.injects[0].clone())?;
            ctx.events().on(
                ctx,
                &EventKey::<Observation>::of(),
                ObservationForwarder(self.outgoing.clone()),
            )?;
            let runtime = invoke(
                service
                    .invoke("snapshot", Value::List(vec![]))
                    .map_err(|e| CordisError::PluginFailed(Box::new(e)))?,
            )
            .await
            .map_err(|e| CordisError::ServiceNotFound(e.to_string()))?;
            let _ = self.outgoing.send(json!({ "type": "ready", "protocol": 1, "hostPid": std::process::id(), "runtime": runtime["runtime"] })).await;
            let mut incoming = self.incoming.lock().unwrap().take().ok_or_else(|| {
                CordisError::ServiceNotFound("Admission generation was replaced".into())
            })?;
            type Call =
                Pin<Box<dyn Future<Output = (u64, std::result::Result<Json, Json>)> + Send>>;
            let mut calls = FuturesUnordered::<Call>::new();
            let mut pending = HashSet::<u64>::new();
            loop {
                tokio::select! {
                    biased;
                    _ = ctx.cancelled() => break,
                    Some((id, result)) = calls.next(), if !calls.is_empty() => {
                        pending.remove(&id);
                        if self.outgoing.send(response(id, result)).await.is_err() { break; }
                    }
                    request = incoming.recv() => {
                        match request {
                            None => break,
                            Some(Request::Call { id, method, args }) => {
                                if id == 0 || id > 9_007_199_254_740_991 || pending.contains(&id) || pending.len() >= MAX_CALLS {
                                    return Err(CordisError::ServiceNotFound("Invalid or excessive harness request".into()));
                                }
                                let mut args: Vec<Value> = args.into_iter().map(Value::from).collect();
                                if matches!(method, Method::Acquire) {
                                    if args.len() != 3 {
                                        return Err(CordisError::ServiceNotFound("Invalid acquire arguments".into()));
                                    }
                                    args.insert(2, Value::Signal);
                                }
                                let value = match service.invoke("dispatch", Value::List(vec![json!(id).into(), json!(method.name()).into(), Value::List(args)])) {
                                    Ok(value) => value,
                                    Err(error) => {
                                        let _ = self.outgoing.send(response(id, Err(bridge_error(error)))).await;
                                        continue;
                                    }
                                };
                                pending.insert(id);
                                calls.push(Box::pin(async move { (id, invoke(value).await) }));
                            }
                            Some(_) => return Err(CordisError::ServiceNotFound("Invalid admission request".into())),
                        }
                    }
                }
            }
            Ok(Effect::Done)
        })
    }
}

fn decode_request(mut bytes: Vec<u8>, vector: bool, binary: bool) -> Result<Request> {
    let data = if binary {
        if !vector || bytes.len() < 4 {
            return Err("Invalid binary memory frame".into());
        }
        let metadata = u32::from_be_bytes(bytes[..4].try_into()?) as usize;
        if metadata == 0 || metadata > bytes.len() - 4 {
            return Err("Invalid memory metadata length".into());
        }
        let data = bytes.split_off(4 + metadata);
        if data.is_empty() || data.len() > MAX_MEMORY_CHUNK {
            return Err("Invalid memory chunk size".into());
        }
        Some(data)
    } else {
        None
    };
    let mut request: Request = serde_json::from_slice(&bytes[if binary { 4 } else { 0 }..])?;
    if vector != matches!(request, Request::MemoryCall { .. }) {
        return Err("Invalid harness frame kind".into());
    }
    if let Some(bytes) = data {
        let Request::MemoryCall { command, data, .. } = &mut request else {
            return Err("Invalid binary memory request".into());
        };
        if !matches!(
            command["method"].as_str(),
            Some("begin" | "chunk" | "commit")
        ) || command.get("data").is_some()
        {
            return Err("Invalid binary memory command".into());
        }
        *data = Some(bytes);
    }
    Ok(request)
}

fn read_requests(sender: mpsc::Sender<Request>, memory: mpsc::Sender<Request>) -> Result<()> {
    let mut input = std::io::stdin().lock();
    loop {
        let mut header = [0_u8; 4];
        let header = match input.read_exact(&mut header) {
            Ok(_) => u32::from_be_bytes(header),
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let vector = header & MEMORY_FRAME_FLAG != 0;
        let binary = header & BINARY_FRAME_FLAG != 0;
        let length = (header & !(MEMORY_FRAME_FLAG | BINARY_FRAME_FLAG)) as usize;
        if (binary && !vector)
            || length == 0
            || length > if vector { MAX_MEMORY_FRAME } else { MAX_FRAME }
        {
            return Err("Invalid harness frame size".into());
        }
        let mut bytes = vec![0; length];
        input.read_exact(&mut bytes)?;
        let request = decode_request(bytes, vector, binary)?;
        match request {
            Request::Call { .. } => {
                if sender.blocking_send(request).is_err() {
                    return Ok(());
                }
            }
            _ => {
                // A dead vector generation cannot stop admission's inherited input channel.
                let _ = memory.blocking_send(request);
            }
        }
    }
}

async fn runtime_loss(runtime: RuntimeHandle) -> String {
    loop {
        if let RuntimeState::Down(reason) = runtime.state() {
            return reason;
        }
        sleep(Duration::from_millis(50)).await;
    }
}

async fn mount(
    root: &Ctx,
    args: &[std::ffi::OsString],
    incoming: mpsc::Receiver<Request>,
    memory_incoming: mpsc::Receiver<Request>,
    outgoing: Output,
) -> Result<RuntimeHandle> {
    let electron = PathBuf::from(&args[0]).canonicalize()?;
    let runtime = PathBuf::from(&args[1]).canonicalize()?;
    let plugin = PathBuf::from(&args[2]).canonicalize()?;
    let capacity: u64 = args[3].to_str().ok_or("Invalid capacity")?.parse()?;
    let max_pending: u64 = args[4].to_str().ok_or("Invalid pending limit")?.parse()?;
    if capacity == 0 || capacity > 9_007_199_254_740_991 || max_pending > 9_007_199_254_740_991 {
        return Err("Invalid admission limits".into());
    }
    let launcher = Launcher::new(electron)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .env("NODE_OPTIONS", "")
        .env("NODE_PATH", "")
        .env("RUTIS_SHUTDOWN_TIMEOUT", "5")
        .cwd(&runtime)
        .stdout(Stdio::Null)
        .stderr(Stdio::Inherit);
    #[cfg(unix)]
    let launcher = launcher.inherit_fd();
    let admission_runtime = LocalRuntime::launcher(
        "harness",
        launcher.clone().arg(runtime.join("src/runner.mjs")),
        runtime.join("package.json"),
    );
    let handle = admission_runtime.handle();
    // Bounded vector uploads do not need a throughput-grown idle nursery.
    let memory_runtime = LocalRuntime::launcher(
        "memory",
        launcher
            .arg("--max-semi-space-size=8")
            .arg(runtime.join("src/runner.mjs")),
        runtime.join("package.json"),
    );
    let catalog = ServiceCatalog::new();
    let memory_rows =
        Arc::new(RuntimeResolver::modules(memory_runtime.handle()).with_catalog(&catalog));
    let rows = Arc::new(RuntimeResolver::node(handle.clone()).with_catalog(&catalog));
    root.plugin(admission_runtime);
    let loader = LoaderPlugin::new(
        Chain::new()
            .with_shared(rows.clone())
            .with_shared(memory_rows.clone()),
        LoaderOptions {
            catalog,
            ..LoaderOptions::default()
        },
    );
    let loader_handle = loader.handle();
    root.plugin(loader).await?;
    root.plugin(RuntimeRowsPlugin::new(rows));
    root.plugin(RuntimeRowsPlugin::new(memory_rows));
    root.plugin(AdmissionGateway {
        injects: [host_key("harnessAdmission")],
        incoming: Mutex::new(Some(incoming)),
        outgoing: outgoing.clone(),
    });
    let plugin_url = url::Url::from_file_path(plugin).map_err(|_| "Invalid plugin path")?;
    let patches: Vec<Patch> = serde_json::from_value(json!([{ "insert": [{
        "id": "admission", "name": plugin_url.as_str(), "config": { "capacity": capacity, "maxPending": max_pending }
    }] }]))?;
    loader_handle
        .reconcile(vec![Layer::new("harness", patches.clone())], None)
        .await?;
    root.plugin(memory::Bootstrap::new(
        memory_runtime,
        memory_incoming,
        outgoing,
        loader_handle,
        patches,
        plugin_url,
    ));
    Ok(handle)
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 5 {
        return Err(
            "Usage: deepchat-harness <electron> <runtime> <plugin> <capacity> <max-pending>".into(),
        );
    }
    let root = Ctx::root()?;
    let (requests, incoming) = mpsc::channel(64);
    let (memory_requests, memory_incoming) = mpsc::channel(32);
    let (outgoing, responses) = Output::channel();
    let (reader_end, mut reader) = oneshot::channel();
    // A detached blocking reader cannot hold Tokio shutdown open after runtime loss.
    std::thread::spawn(move || {
        let _ = reader_end.send(read_requests(requests, memory_requests));
    });
    let mut writer = tokio::spawn(transport::write_responses(responses));
    let result = async {
        let runtime = timeout(Duration::from_secs(15), mount(&root, &args, incoming, memory_incoming, outgoing)).await??;
        tokio::select! {
            result = &mut reader => result?,
            result = &mut writer => { result??; Err("Harness output closed".into()) },
            reason = runtime_loss(runtime) => Err(format!("Harness runtime stopped: {reason}").into()),
            result = tokio::signal::ctrl_c() => { result?; Ok(()) },
        }
    }.await;
    let shutdown = timeout(Duration::from_secs(10), root.shutdown()).await;
    if !matches!(&shutdown, Ok(Ok(()))) {
        kill_processes();
    }
    // Closing runtime channels does not mean their processes have been reaped yet.
    processes_ended().await;
    writer.abort();
    result?;
    shutdown.map_err(|_| "Harness shutdown timed out")??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binary(command: Json, data: &[u8]) -> Vec<u8> {
        let metadata = serde_json::to_vec(&json!({
            "type": "memoryCall", "id": 1, "command": command
        }))
        .unwrap();
        let mut frame = (metadata.len() as u32).to_be_bytes().to_vec();
        frame.extend(metadata);
        frame.extend(data);
        frame
    }

    #[test]
    fn binary_upload_preserves_bytes_and_rejects_ambiguous_frames() {
        for method in ["begin", "chunk", "commit"] {
            let bytes = vec![0, 255, 1, 0];
            let request =
                decode_request(binary(json!({ "method": method }), &bytes), true, true).unwrap();
            assert!(
                matches!(request, Request::MemoryCall { data: Some(data), .. } if data == bytes)
            );
        }
        let max = vec![0; MAX_MEMORY_CHUNK];
        assert!(decode_request(binary(json!({ "method": "chunk" }), &max), true, true).is_ok());
        for frame in [
            Vec::new(),
            vec![0; 4],
            u32::MAX.to_be_bytes().to_vec(),
            binary(json!({ "method": "chunk" }), &[]),
            binary(json!({ "method": "chunk" }), &vec![0; MAX_MEMORY_CHUNK + 1]),
            binary(json!({ "method": "query" }), &[0]),
            binary(json!({ "method": "chunk", "data": "AAAA" }), &[0]),
        ] {
            assert!(decode_request(frame, true, true).is_err());
        }
        assert!(decode_request(binary(json!({ "method": "chunk" }), &[0]), false, true).is_err());
    }
}
