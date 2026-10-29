use super::*;
use rutis_bridge::session::caller_row;
use std::collections::HashMap;

const MAX_NATIVE: usize = 16;

#[derive(Default)]
struct NativeState {
    generation: String,
    caller: Option<String>,
    next: u64,
    active: bool,
    pending: HashMap<u64, oneshot::Sender<std::result::Result<Json, Json>>>,
}

pub struct Native {
    state: Arc<Mutex<NativeState>>,
    outgoing: Output,
}

impl Native {
    pub fn new(outgoing: Output) -> Self {
        Self {
            state: Arc::default(),
            outgoing,
        }
    }

    pub fn complete(&self, id: u64, generation: &str, value: Option<Json>, failure: Option<Json>) {
        let mut state = self.state.lock().unwrap();
        if generation != state.generation || value.is_some() == failure.is_some() {
            return;
        }
        if let Some(reply) = state.pending.remove(&id) {
            let _ = reply.send(match failure {
                Some(error) => Err(error),
                None => Ok(value.unwrap()),
            });
        }
    }

    fn retire(&self) {
        let mut state = self.state.lock().unwrap();
        state.active = false;
        for (_, reply) in state.pending.drain() {
            let _ = reply.send(Err(error("CoreUnavailableError", "Core generation ended")));
        }
    }
}

impl HostDispatch for Native {
    fn methods(&self) -> Option<Json> {
        Some(json!({ "invoke": "async" }))
    }

    fn invoke(&self, method: &str, args: Value) -> rutis_bridge::session::Reply {
        if method != "invoke" {
            return Err(BridgeError::Value("Unknown Core Native method".into()));
        }
        let row = caller_row()
            .filter(|row| row.id() == "core")
            .ok_or_else(|| BridgeError::Value("Core Native caller is not authorized".into()))?;
        let args = args.json()?;
        let args = args
            .as_array()
            .filter(|args| args.len() == 3)
            .ok_or_else(|| BridgeError::Value("Invalid Core Native arguments".into()))?;
        let generation = args[0].as_str().unwrap_or("");
        let method = args[1].as_str().unwrap_or("");
        if !matches!(
            method,
            "crypto.available"
                | "crypto.encrypt"
                | "crypto.decrypt"
                | "crypto.backend"
                | "profile.logging"
                | "profile.progress"
                | "profile.unlock"
                | "profile.recovery"
                | "profile.quit"
        ) {
            return Err(BridgeError::Value("Unknown Core Native capability".into()));
        }
        let (id, receiver) = {
            let mut state = self.state.lock().unwrap();
            if !state.active
                || generation != state.generation
                || state.pending.len() >= MAX_NATIVE
                || state.caller.as_ref().is_some_and(|key| key != row.key())
            {
                return Err(BridgeError::Value(
                    "Core Native generation is unavailable".into(),
                ));
            }
            state.caller = Some(row.key().to_owned());
            state.next += 1;
            let id = state.next;
            let (sender, receiver) = oneshot::channel();
            state.pending.insert(id, sender);
            (id, receiver)
        };
        let outgoing = self.outgoing.clone();
        let state = self.state.clone();
        let frame = json!({ "type": "coreNativeCall", "id": id, "generation": generation, "method": method, "args": args[2] });
        Ok(Value::future(async move {
            if outgoing.send(frame).await.is_err() {
                state.lock().unwrap().pending.remove(&id);
                return Err(BridgeError::Value("Core Native channel closed".into()));
            }
            match receiver.await {
                Ok(Ok(value)) => Ok(value.into()),
                Ok(Err(value)) => Err(BridgeError::Value(format!(
                    "Core Native request failed: {}",
                    value["message"].as_str().unwrap_or("unavailable")
                ))),
                Err(_) => Err(BridgeError::Value("Core Native channel closed".into())),
            }
        }))
    }
}

pub struct Bootstrap {
    runtime: Mutex<Option<LocalRuntime>>,
    incoming: Mutex<Option<mpsc::Receiver<Request>>>,
    outgoing: Output,
    layers: Arc<layers::Layers>,
    plugin: url::Url,
    native: Arc<Native>,
}

impl Bootstrap {
    pub fn new(
        runtime: LocalRuntime,
        incoming: mpsc::Receiver<Request>,
        outgoing: Output,
        layers: Arc<layers::Layers>,
        plugin: url::Url,
        native: Arc<Native>,
    ) -> Self {
        Self {
            runtime: Mutex::new(Some(runtime)),
            incoming: Mutex::new(Some(incoming)),
            outgoing,
            layers,
            plugin: plugin.join("core.mjs").expect("Core plugin URL"),
            native,
        }
    }
}

impl Plugin for Bootstrap {
    fn name(&self) -> &str {
        "deepchat-core-bootstrap"
    }

    fn apply<'a>(
        &'a self,
        ctx: &'a Ctx,
    ) -> BoxFuture<'a, std::result::Result<Effect, CordisError>> {
        Box::pin(async move {
            let mut incoming = self.incoming.lock().unwrap().take().ok_or_else(|| {
                CordisError::ServiceNotFound("Core generation cannot restart".into())
            })?;
            let config = tokio::select! {
                _ = ctx.cancelled() => return Ok(Effect::Done),
                request = incoming.recv() => match request {
                    Some(Request::CoreStart { config }) => config,
                    _ => return Err(CordisError::ServiceNotFound("Core handshake required".into()))
                }
            };
            let generation = config["generation"]
                .as_str()
                .ok_or_else(|| CordisError::ServiceNotFound("Invalid Core generation".into()))?;
            generation
                .parse::<rutis_bridge::session::Uuid>()
                .map_err(|e| CordisError::ServiceNotFound(e.to_string()))?;
            {
                let mut native = self.native.state.lock().unwrap();
                native.generation = generation.to_owned();
                native.active = true;
            }
            let runtime = self.runtime.lock().unwrap().take().ok_or_else(|| {
                CordisError::ServiceNotFound("Core generation cannot restart".into())
            })?;
            let handle = runtime.handle();
            let processes = runtime.processes();
            ctx.plugin(runtime);
            ctx.plugin(Gateway {
                incoming: Mutex::new(Some(incoming)),
                outgoing: self.outgoing.clone(),
                injects: [host_key("deepchatCore")],
                native: self.native.clone(),
            });
            let patches: Vec<Patch> = serde_json::from_value(json!([{ "insert": [{ "id": "core", "name": format!("core:{}", self.plugin), "config": config }] }]))
                .map_err(|e| CordisError::ServiceNotFound(e.to_string()))?;
            if self.layers.set("core", patches).await.is_err() {
                self.native.retire();
                processes.kill();
                processes.ended().await;
                let _ = self
                    .outgoing
                    .send(json!({ "type": "coreStopped", "message": "Core plugin failed to load" }))
                    .await;
                return Ok(Effect::Done);
            }
            tokio::select! { _ = ctx.cancelled() => {}, _ = runtime_loss(handle) => {} }
            self.native.retire();
            processes.kill();
            processes.ended().await;
            let _ = self
                .outgoing
                .send(json!({ "type": "coreStopped", "message": "Core runtime stopped" }))
                .await;
            Ok(Effect::Done)
        })
    }
}

struct Gateway {
    incoming: Mutex<Option<mpsc::Receiver<Request>>>,
    outgoing: Output,
    injects: [TypeKey; 1],
    native: Arc<Native>,
}

impl Plugin for Gateway {
    fn name(&self) -> &str {
        "deepchat-core-gateway"
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
            let identity = invoke(
                service
                    .invoke("identity", Value::List(vec![]))
                    .map_err(|e| CordisError::PluginFailed(Box::new(e)))?,
            )
            .await
            .map_err(|e| CordisError::ServiceNotFound(e.to_string()))?;
            let _ = self
                .outgoing
                .send(json!({ "type": "coreReady", "runtime": identity }))
                .await;
            let mut incoming = self
                .incoming
                .lock()
                .unwrap()
                .take()
                .ok_or_else(|| CordisError::ServiceNotFound("Core generation ended".into()))?;
            type Call = Pin<
                Box<dyn Future<Output = (u64, bool, bool, std::result::Result<Json, Json>)> + Send>,
            >;
            let mut calls = FuturesUnordered::<Call>::new();
            let (mut ordinary, mut control, mut last_id) = (0, 0, 0);
            loop {
                tokio::select! {
                    biased;
                    _ = ctx.cancelled() => break,
                    Some((id, is_control, stopping, result)) = calls.next(), if !calls.is_empty() => {
                        if is_control { control -= 1; } else { ordinary -= 1; }
                        if stopping && result.is_ok() { self.native.retire(); }
                        let frame = match result { Ok(value) => json!({"type":"coreReply","id":id,"value":value}), Err(error) => json!({"type":"coreReply","id":id,"error":error}) };
                        if self.outgoing.send(frame).await.is_err() { break; }
                    },
                    request = incoming.recv() => match request {
                        Some(Request::CoreCall { id, method, args }) => {
                            let is_control = matches!(method.as_str(), "status" | "stop");
                            if id == 0 || id > 9_007_199_254_740_991 || id <= last_id || !matches!(method.as_str(), "openProfile" | "status" | "stop") || if is_control { control >= 2 } else { ordinary >= 4 } {
                                return Err(CordisError::ServiceNotFound("Invalid Core operation or quota".into()));
                            }
                            last_id = id;
                            let stopping = method == "stop";
                            let value = service.invoke(&method, Value::List(if method == "openProfile" { vec![args.into()] } else { vec![] }));
                            if is_control { control += 1; } else { ordinary += 1; }
                            calls.push(Box::pin(async move { (id, is_control, stopping, match value { Ok(value) => invoke(value).await, Err(error) => Err(bridge_error(error)) }) }));
                        },
                        None => break,
                        _ => return Err(CordisError::ServiceNotFound("Invalid Core request".into())),
                    }
                }
            }
            Ok(Effect::Done)
        })
    }
}
