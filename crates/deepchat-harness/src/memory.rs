use super::*;
use rutis_loader::Loader;

const MAX_MEMORY_CALLS: usize = 32;

pub struct Bootstrap {
    runtime: Mutex<Option<LocalRuntime>>,
    incoming: Mutex<Option<mpsc::Receiver<Request>>>,
    outgoing: Output,
    loader: Loader,
    admission: Vec<Patch>,
    plugin: url::Url,
}

impl Bootstrap {
    pub fn new(
        runtime: LocalRuntime,
        incoming: mpsc::Receiver<Request>,
        outgoing: Output,
        loader: Loader,
        admission: Vec<Patch>,
        mut plugin: url::Url,
    ) -> Self {
        plugin = plugin.join("memory-vector.mjs").expect("Local plugin URL");
        Self {
            runtime: Mutex::new(Some(runtime)),
            incoming: Mutex::new(Some(incoming)),
            outgoing,
            loader,
            admission,
            plugin,
        }
    }
}

impl Plugin for Bootstrap {
    fn name(&self) -> &str {
        "deepchat-memory-bootstrap"
    }

    fn apply<'a>(
        &'a self,
        ctx: &'a Ctx,
    ) -> BoxFuture<'a, std::result::Result<Effect, CordisError>> {
        Box::pin(async move {
            let mut incoming = self.incoming.lock().unwrap().take().ok_or_else(|| {
                CordisError::ServiceNotFound("Memory generation cannot restart".into())
            })?;
            let config = tokio::select! {
                _ = ctx.cancelled() => return Ok(Effect::Done),
                request = incoming.recv() => match request {
                    Some(Request::MemoryStart { config }) => config,
                    _ => return Err(CordisError::ServiceNotFound("Memory handshake required".into())),
                }
            };
            let runtime = self.runtime.lock().unwrap().take().ok_or_else(|| {
                CordisError::ServiceNotFound("Memory generation cannot restart".into())
            })?;
            let handle = runtime.handle();
            let processes = runtime.processes();
            if !config["memoryDbDir"]
                .as_str()
                .is_some_and(|path| std::path::Path::new(path).is_absolute())
            {
                return Err(CordisError::ServiceNotFound(
                    "Invalid memory directory".into(),
                ));
            }
            ctx.plugin(runtime);
            ctx.plugin(Gateway {
                injects: [host_key("harnessMemoryVector")],
                incoming: Mutex::new(Some(incoming)),
                outgoing: self.outgoing.clone(),
            });
            let memory: Vec<Patch> = serde_json::from_value(json!([{ "insert": [{
                "id": "memory-vector", "name": format!("memory:{}", self.plugin), "config": config
            }] }]))
            .map_err(|e| CordisError::ServiceNotFound(e.to_string()))?;
            let layers = vec![
                Layer::new("harness", self.admission.clone()),
                Layer::new("memory", memory),
            ];
            if let Err(error) = self.loader.reconcile(layers, None).await {
                processes.kill();
                processes.ended().await;
                let _ = self.outgoing.send(json!({ "type": "memoryStopped", "message": "Memory vector plugin failed to load" })).await;
                eprintln!("Memory vector plugin failed: {error}");
                return Ok(Effect::Done);
            }
            tokio::select! {
                _ = ctx.cancelled() => {},
                _ = runtime_loss(handle) => {
                    processes.kill();
                    processes.ended().await;
                    let _ = self.outgoing.send(json!({ "type": "memoryStopped", "message": "Memory vector runtime stopped; restart DeepChat to restore vector recall" })).await;
                }
            }
            Ok(Effect::Done)
        })
    }
}

struct Gateway {
    injects: [TypeKey; 1],
    incoming: Mutex<Option<mpsc::Receiver<Request>>>,
    outgoing: Output,
}

impl Plugin for Gateway {
    fn name(&self) -> &str {
        "deepchat-memory-vector-gateway"
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
                .send(json!({ "type": "memoryReady", "protocol": 1, "runtime": identity }))
                .await;
            let mut incoming = self.incoming.lock().unwrap().take().ok_or_else(|| {
                CordisError::ServiceNotFound("Memory generation cannot restart".into())
            })?;
            type Call =
                Pin<Box<dyn Future<Output = (u64, bool, std::result::Result<Json, Json>)> + Send>>;
            let mut calls = FuturesUnordered::<Call>::new();
            let mut pending = HashSet::new();
            loop {
                tokio::select! {
                    biased;
                    _ = ctx.cancelled() => break,
                    Some((id, control, result)) = calls.next(), if !calls.is_empty() => {
                        pending.remove(&id);
                        let mut reply = response(id, result);
                        reply["type"] = json!("memoryReply");
                        if self.outgoing.send_frame(reply, control).await.is_err() { break; }
                    }
                    request = incoming.recv() => {
                        let Some(Request::MemoryCall { id, command }) = request else { break; };
                        if id == 0 || id > 9_007_199_254_740_991 || pending.contains(&id) || pending.len() >= MAX_MEMORY_CALLS {
                            return Err(CordisError::ServiceNotFound("Invalid or excessive memory request".into()));
                        }
                        let control = matches!(command["method"].as_str(), Some("close" | "abort" | "reset" | "quarantine"));
                        let value = match service.invoke("dispatch", Value::List(vec![json!(id).into(), command.into()])) {
                            Ok(value) => value,
                            Err(error) => {
                                let mut reply = response(id, Err(bridge_error(error)));
                                reply["type"] = json!("memoryReply");
                                let _ = self.outgoing.send_frame(reply, control).await;
                                continue;
                            }
                        };
                        pending.insert(id);
                        calls.push(Box::pin(async move { (id, control, invoke(value).await) }));
                    }
                }
            }
            Ok(Effect::Done)
        })
    }
}
