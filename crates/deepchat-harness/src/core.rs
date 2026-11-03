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
    admission_used: bool,
    admission_pending: usize,
    pending: HashMap<u64, oneshot::Sender<std::result::Result<Json, Json>>>,
}

pub struct Native {
    state: Arc<Mutex<NativeState>>,
    outgoing: Output,
    admission: Mutex<Option<(Arc<dyn HostDispatch>, Json)>>,
    control: control::Control,
    pub(super) memory: Arc<memory::Link>,
}

impl Native {
    pub fn new(outgoing: Output, memory: Arc<memory::Link>) -> Self {
        Self {
            state: Arc::default(),
            outgoing,
            admission: Mutex::new(None),
            control: control::Control::default(),
            memory,
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

    pub fn bind_admission(&self, service: Arc<dyn HostDispatch>, capacity: u64, max_pending: u64) {
        *self.admission.lock().unwrap() = Some((
            service,
            json!({ "capacity": capacity, "maxPending": max_pending }),
        ));
    }

    async fn retire(&self) {
        let used = {
            let mut state = self.state.lock().unwrap();
            state.active = false;
            for (_, reply) in state.pending.drain() {
                let _ = reply.send(Err(error("CoreUnavailableError", "Core generation ended")));
            }
            std::mem::take(&mut state.admission_used)
        };
        if used {
            let admission = self
                .admission
                .lock()
                .unwrap()
                .as_ref()
                .map(|(service, _)| service.clone());
            if let Some(service) = admission {
                if let Ok(value) = service.invoke(
                    "close",
                    Value::List(vec![json!("Core admission owner retired").into()]),
                ) {
                    let _ = settle(value).await;
                }
            }
        }
        self.memory.retire_core().await;
    }

    fn memory(&self, args: Value) -> rutis_bridge::session::Reply {
        let row = caller_row()
            .filter(|row| row.id() == "core")
            .ok_or_else(|| BridgeError::Value("Core Memory caller is not authorized".into()))?;
        let Value::List(mut fields) = args else {
            return Err(BridgeError::Value("Invalid Core Memory arguments".into()));
        };
        if fields.len() != 5 {
            return Err(BridgeError::Value("Invalid Core Memory arguments".into()));
        }
        let data = match fields.pop().unwrap() {
            Value::Undefined | Value::Data(Json::Null) => None,
            Value::Bytes(bytes) if bytes.len() <= MAX_MEMORY_CHUNK => Some(bytes),
            _ => return Err(BridgeError::Value("Invalid Core Memory bytes".into())),
        };
        let metadata = Value::List(fields).json()?;
        let fields = metadata.as_array().unwrap();
        let generation = fields[0].as_str().unwrap_or("");
        let id = fields[1]
            .as_u64()
            .filter(|id| *id <= 9_007_199_254_740_991)
            .ok_or_else(|| BridgeError::Value("Invalid Core Memory sequence".into()))?;
        let method = fields[2].as_str().unwrap_or("");
        let input = fields[3].clone();
        let control = method != "call"
            || matches!(
                input["method"].as_str(),
                Some("close" | "abort" | "reset" | "quarantine")
            );
        let limit = if control { MAX_FRAME } else { MAX_MEMORY_FRAME };
        if serde_json::to_vec(&metadata)
            .map_err(|e| BridgeError::Value(e.to_string()))?
            .len()
            + data.as_ref().map_or(0, Vec::len)
            > limit
        {
            return Err(BridgeError::Value(
                "Core Memory frame limit exceeded".into(),
            ));
        }
        {
            let mut state = self.state.lock().unwrap();
            if !state.active
                || generation != state.generation
                || state.caller.as_ref().is_some_and(|key| key != row.key())
            {
                return Err(BridgeError::Value(
                    "Core Memory generation is unavailable".into(),
                ));
            }
            state.caller = Some(row.key().to_owned());
        }
        let link = self.memory.clone();
        if method == "retire" && id == 0 && input.is_null() && data.is_none() {
            return Ok(Value::future(async move {
                link.retire_core().await;
                Ok(Json::Null.into())
            }));
        }
        let result = match method {
            "start" if id == 0 && data.is_none() => link.start(input),
            "call" if id > 0 => link.call(id, input, data),
            _ => {
                return Err(BridgeError::Value(
                    "Unsupported Core Memory operation".into(),
                ))
            }
        };
        Ok(Value::future(async move {
            let outcome = match result {
                Ok(receiver) => receiver.await.unwrap_or_else(|_| {
                    Err(error(
                        "MemoryVectorRuntimeUnavailableError",
                        "Memory generation ended before its reply",
                    ))
                }),
                Err(error) => Err(error),
            };
            let outcome = outcome.and_then(|value| {
                let frame = json!({ "type": "memoryReply", "id": id, "value": value });
                if serde_json::to_vec(&frame).map_or(true, |bytes| bytes.len() > limit) {
                    let failure = error("MemoryVectorProtocolError", "Memory reply limit exceeded");
                    link.failed(failure.clone());
                    Err(failure)
                } else {
                    Ok(value)
                }
            });
            if id > 0 {
                link.complete(id);
            }
            outcome
                .map(Value::from)
                .map_err(|error| BridgeError::Remote {
                    name: error["name"]
                        .as_str()
                        .unwrap_or("MemoryVectorTransportError")
                        .to_owned(),
                    message: error["message"]
                        .as_str()
                        .unwrap_or("Memory request failed")
                        .to_owned(),
                    graph: None,
                })
        }))
    }

    fn admission(&self, args: Value) -> rutis_bridge::session::Reply {
        let row = caller_row()
            .filter(|row| row.id() == "core")
            .ok_or_else(|| BridgeError::Value("Core admission caller is not authorized".into()))?;
        let args = args.json()?;
        let args = args
            .as_array()
            .filter(|args| args.len() == 4)
            .ok_or_else(|| BridgeError::Value("Invalid Core admission arguments".into()))?;
        if serde_json::to_vec(args)
            .map_err(|e| BridgeError::Value(e.to_string()))?
            .len()
            > MAX_FRAME
        {
            return Err(BridgeError::Value(
                "Core admission request is oversized".into(),
            ));
        }
        let generation = args[0].as_str().unwrap_or("");
        let sequence = args[1]
            .as_u64()
            .filter(|id| *id <= 9_007_199_254_740_991)
            .ok_or_else(|| BridgeError::Value("Invalid Core admission sequence".into()))?;
        let method = args[2].as_str().unwrap_or("");
        let input = args[3]
            .as_array()
            .ok_or_else(|| BridgeError::Value("Invalid Core admission input".into()))?;
        let (service, limits) = self
            .admission
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| BridgeError::Value("Admission service is unavailable".into()))?;
        let parsed = if method == "limits" {
            if sequence != 0 || !input.is_empty() {
                return Err(BridgeError::Value(
                    "Invalid Core admission handshake".into(),
                ));
            }
            None
        } else {
            if sequence == 0 {
                return Err(BridgeError::Value("Invalid Core admission sequence".into()));
            }
            Some(
                serde_json::from_value::<Method>(json!(method))
                    .map_err(|_| BridgeError::Value("Unsupported Core admission method".into()))?,
            )
        };
        let acquire = matches!(parsed, Some(Method::Acquire));
        {
            let mut state = self.state.lock().unwrap();
            if !state.active
                || generation != state.generation
                || state.caller.as_ref().is_some_and(|key| key != row.key())
            {
                return Err(BridgeError::Value(
                    "Core admission generation is unavailable".into(),
                ));
            }
            state.caller = Some(row.key().to_owned());
            state.admission_used = true;
            if parsed.is_none() {
                return Ok(limits.into());
            }
            if state.admission_pending >= if acquire { MAX_CALLS - 16 } else { MAX_CALLS } {
                state.active = false;
                return Ok(Value::future(async move {
                    if let Ok(value) = service.invoke(
                        "close",
                        Value::List(vec![json!("Core admission transport overflow").into()]),
                    ) {
                        let _ = settle(value).await;
                    }
                    Err(BridgeError::Value(
                        "Core admission request limit exceeded; retire the generation".into(),
                    ))
                }));
            }
            state.admission_pending += 1;
        }
        let input: Vec<Value> = input.iter().cloned().map(Value::from).collect();
        let value = if acquire && input.len() != 3 {
            Err(BridgeError::Value(
                "Invalid Core acquisition arguments".into(),
            ))
        } else {
            service.invoke(
                "dispatchCore",
                Value::List(vec![
                    json!(generation).into(),
                    json!(sequence).into(),
                    json!(method).into(),
                    Value::List(input),
                ]),
            )
        };
        let state = self.state.clone();
        Ok(Value::future(async move {
            let result = match value {
                Ok(value) => settle(value).await,
                Err(error) => Err(error),
            };
            let mut state = state.lock().unwrap();
            state.admission_pending = state.admission_pending.saturating_sub(1);
            result
        }))
    }
}

impl HostDispatch for Native {
    fn methods(&self) -> Option<Json> {
        Some(
            json!({ "invoke": "async", "admission": "async", "memory": "async", "control": "async" }),
        )
    }

    fn invoke(&self, method: &str, args: Value) -> rutis_bridge::session::Reply {
        if method == "control" {
            let row = caller_row()
                .filter(|row| row.id() == "core")
                .ok_or_else(|| {
                    BridgeError::Value("Core control caller is not authorized".into())
                })?;
            let args = args.json()?;
            let args = args
                .as_array()
                .filter(|args| args.len() == 3)
                .ok_or_else(|| BridgeError::Value("Invalid Core control arguments".into()))?;
            {
                let mut state = self.state.lock().unwrap();
                if !state.active
                    || args[0].as_str() != Some(&state.generation)
                    || state.caller.as_ref().is_some_and(|key| key != row.key())
                {
                    return Err(BridgeError::Value(
                        "Core control generation is unavailable".into(),
                    ));
                }
                state.caller = Some(row.key().to_owned());
            }
            let sequence = args[1]
                .as_u64()
                .ok_or_else(|| BridgeError::Value("Invalid Core control sequence".into()))?;
            return self
                .control
                .dispatch(sequence, args[2].clone())
                .map(Value::from);
        }
        if method == "admission" {
            return self.admission(args);
        }
        if method == "memory" {
            return self.memory(args);
        }
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
                | "profile.observation"
                | "core.failure"
                | "configuration"
                | "helpers"
                | "browser"
                | "desktop"
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
            let memory_plugin = self
                .plugin
                .join("memory.mjs")
                .map_err(|e| CordisError::ServiceNotFound(e.to_string()))?;
            let patches: Vec<Patch> = serde_json::from_value(json!([{ "insert": [
                { "id": "core-memory", "name": format!("core:{memory_plugin}") },
                { "id": "core", "name": format!("core:{}", self.plugin), "config": config }
            ] }]))
            .map_err(|e| CordisError::ServiceNotFound(e.to_string()))?;
            if self.layers.set("core", patches).await.is_err() {
                self.native.retire().await;
                processes.kill();
                processes.ended().await;
                let _ = self
                    .outgoing
                    .send(json!({ "type": "coreStopped", "message": "Core plugin failed to load" }))
                    .await;
                return Ok(Effect::Done);
            }
            tokio::select! { _ = ctx.cancelled() => {}, _ = runtime_loss(handle) => {} }
            self.native.retire().await;
            processes.kill();
            processes.ended().await;
            self.native.control.retire();
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
            #[derive(Clone, Copy)]
            enum Lane {
                Ordinary,
                RouteControl,
                Control,
                Observation,
                NativeEvents,
            }
            type Call = Pin<
                Box<dyn Future<Output = (u64, Lane, bool, std::result::Result<Json, Json>)> + Send>,
            >;
            let mut calls = FuturesUnordered::<Call>::new();
            let mut active = [0usize; 5];
            let mut last_id = 0;
            loop {
                tokio::select! {
                    biased;
                    _ = ctx.cancelled() => break,
                    Some((id, lane, stopping, result)) = calls.next(), if !calls.is_empty() => {
                        active[lane as usize] -= 1;
                        if stopping && result.is_ok() { self.native.retire().await; }
                        let frame = match result { Ok(value) => json!({"type":"coreReply","id":id,"value":value}), Err(error) => json!({"type":"coreReply","id":id,"error":error}) };
                        if self.outgoing.send(frame).await.is_err() { break; }
                    },
                    request = incoming.recv() => match request {
                        Some(Request::CoreCall { id, method, args }) => {
                            let lane = match method.as_str() {
                                "status" | "stop" | "beginShutdown" => Lane::Control,
                                "observeSystemTheme" => Lane::Observation,
                                "nativeEvents" => Lane::NativeEvents,
                                "invokeControlRoute" => Lane::RouteControl,
                                "openProfile" | "configure" | "assembleKernel" | "startKernel" | "invokeRoute" | "mcpAppProtocol" | "hostQuery" => Lane::Ordinary,
                                _ => return Err(CordisError::ServiceNotFound("Invalid Core operation".into())),
                            };
                            if id == 0 || id > 9_007_199_254_740_991 || id <= last_id || active[lane as usize] >= [3, 1, 2, 1, 1][lane as usize] {
                                return Err(CordisError::ServiceNotFound("Invalid Core operation or quota".into()));
                            }
                            last_id = id;
                            let stopping = method == "stop";
                            let value = service.invoke(&method, Value::List(if matches!(lane, Lane::Control | Lane::Observation) || method == "startKernel" { vec![] } else { vec![args.into()] }));
                            active[lane as usize] += 1;
                            calls.push(Box::pin(async move { (id, lane, stopping, match value { Ok(value) => invoke(value).await, Err(error) => Err(bridge_error(error)) }) }));
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
