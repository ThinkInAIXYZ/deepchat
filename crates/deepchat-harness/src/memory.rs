use super::*;
use rutis_loader::Loader;
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_MEMORY_CALLS: usize = 32;

const MAX_UPLOAD_BYTES: usize = 16 * 1024 * 1024;
const MAX_NATIVE_PART: usize = 8 * 1024 * 1024;

struct Upload {
    id: String,
    resource: String,
    memory_ids: Json,
    expected: usize,
    bytes: Vec<u8>,
    commit: Option<u64>,
}

enum Staged {
    Reply(Json),
    Call(Vec<Value>),
}

fn stage(
    upload: &mut Option<Upload>,
    id: u64,
    command: Json,
    data: Option<Vec<u8>>,
    generation: &str,
) -> std::result::Result<Staged, Json> {
    let invalid = || {
        error(
            "MemoryVectorUploadError",
            "Invalid memory upload or sequence",
        )
    };
    let method = command["method"].as_str().unwrap_or("");
    if !matches!(method, "begin" | "chunk" | "commit" | "abort") {
        if data.is_some() {
            return Err(invalid());
        }
        return Ok(Staged::Call(vec![command.into()]));
    }
    let fields = command.as_object().ok_or_else(invalid)?;
    for key in fields.keys() {
        if !(matches!(
            key.as_str(),
            "method" | "generation" | "operation" | "resource" | "upload"
        ) || method == "begin" && matches!(key.as_str(), "memoryIds" | "bytes")
            || matches!(method, "chunk" | "commit") && key == "offset")
        {
            return Err(invalid());
        }
    }
    for key in ["generation", "operation", "resource", "upload"] {
        command[key]
            .as_str()
            .ok_or_else(invalid)?
            .parse::<rutis_bridge::session::Uuid>()
            .map_err(|_| invalid())?;
    }
    if command["generation"] != generation {
        return Err(invalid());
    }
    if method == "begin" {
        if upload.is_some() {
            return Err(error(
                "MemoryVectorUploadError",
                "Memory vector upload is busy",
            ));
        }
        let expected = command["bytes"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= MAX_UPLOAD_BYTES as u64 && *n % 4 == 0)
            .ok_or_else(invalid)? as usize;
        let ids = command["memoryIds"]
            .as_array()
            .filter(|ids| !ids.is_empty() && ids.len() <= 50)
            .ok_or_else(invalid)?;
        let mut unique = HashSet::new();
        for value in ids {
            let value = value
                .as_str()
                .filter(|v| !v.is_empty() && v.encode_utf16().count() <= 1024)
                .ok_or_else(invalid)?;
            if !unique.insert(value) {
                return Err(invalid());
            }
        }
        let initial = data.unwrap_or_default();
        if initial.len() > MAX_MEMORY_INITIAL_CHUNK || initial.len() > expected {
            return Err(invalid());
        }
        let mut bytes = Vec::with_capacity(expected);
        bytes.extend(initial);
        *upload = Some(Upload {
            id: command["upload"].as_str().unwrap().into(),
            resource: command["resource"].as_str().unwrap().into(),
            memory_ids: command["memoryIds"].clone(),
            expected,
            bytes,
            commit: None,
        });
        return Ok(Staged::Reply(Json::Null));
    }
    let matches = upload
        .as_ref()
        .is_some_and(|u| command["upload"] == u.id && command["resource"] == u.resource);
    if method == "abort" {
        if matches && upload.as_ref().unwrap().commit.is_none() {
            *upload = None;
        }
        return Ok(Staged::Reply(Json::Null));
    }
    if !matches {
        return Err(invalid());
    }
    let current = upload.as_mut().unwrap();
    if current.commit.is_some() {
        return Err(invalid());
    }
    if let Some(bytes) = data {
        if command["offset"].as_u64() != Some(current.bytes.len() as u64)
            || bytes.is_empty()
            || bytes.len() > MAX_MEMORY_CHUNK
            || bytes.len() > current.expected - current.bytes.len()
        {
            return Err(invalid());
        }
        current.bytes.extend(bytes);
    } else if method == "chunk" || command.get("offset").is_some() {
        return Err(invalid());
    }
    if method == "chunk" {
        return Ok(Staged::Reply(json!(current.bytes.len())));
    }
    if current.bytes.len() != current.expected {
        return Err(error(
            "MemoryVectorUploadError",
            "Memory vector upload is incomplete",
        ));
    }
    current.commit = Some(id);
    let bytes = std::mem::take(&mut current.bytes);
    let calls = bytes
        .chunks(MAX_NATIVE_PART)
        .enumerate()
        .map(|(part, bytes)| {
            let mut fields: std::collections::BTreeMap<String, Value> =
                ["generation", "operation", "resource", "upload"]
                    .into_iter()
                    .map(|key| (key.into(), command[key].clone().into()))
                    .collect();
            fields.insert("method".into(), json!("upsert").into());
            fields.insert("memoryIds".into(), current.memory_ids.clone().into());
            fields.insert("bytes".into(), json!(current.expected).into());
            fields.insert("offset".into(), json!(part * MAX_NATIVE_PART).into());
            fields.insert("data".into(), Value::Bytes(bytes.to_vec()));
            Value::Record(fields)
        })
        .collect();
    Ok(Staged::Call(calls))
}

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
            type Call = Pin<
                Box<
                    dyn Future<
                            Output = (u64, bool, Option<String>, std::result::Result<Json, Json>),
                        > + Send,
                >,
            >;
            let mut calls = FuturesUnordered::<Call>::new();
            let mut pending = HashSet::new();
            let mut upload = None;
            let generation = identity["generation"]
                .as_str()
                .ok_or_else(|| CordisError::ServiceNotFound("Missing memory generation".into()))?;
            let mut next_request = 1;
            let next_native = Arc::new(AtomicU64::new(1));
            loop {
                tokio::select! {
                    biased;
                    _ = ctx.cancelled() => break,
                    Some((id, control, closed, result)) = calls.next(), if !calls.is_empty() => {
                        pending.remove(&id);
                        if result.is_ok() && upload.as_ref().is_some_and(|u: &Upload| u.commit.is_none() && closed.as_ref() == Some(&u.resource)) { upload = None; }
                        if upload.as_ref().is_some_and(|u: &Upload| u.commit == Some(id)) { upload = None; }
                        let mut reply = response(id, result);
                        reply["type"] = json!("memoryReply");
                        if self.outgoing.send_frame(reply, control).await.is_err() { break; }
                    }
                    request = incoming.recv() => {
                        let Some(Request::MemoryCall { id, command, data }) = request else { break; };
                        if id != next_request || id > 9_007_199_254_740_991 || pending.len() >= MAX_MEMORY_CALLS {
                            return Err(CordisError::ServiceNotFound("Invalid or excessive memory request".into()));
                        }
                        let control = matches!(command["method"].as_str(), Some("close" | "abort" | "reset" | "quarantine"));
                        let closed = if command["method"] == "close" { command["resource"].as_str().map(str::to_owned) } else { None };
                        let abort = (command["method"] == "commit").then(|| {
                            let mut abort = command.clone();
                            abort["method"] = json!("abort");
                            if let Some(fields) = abort.as_object_mut() { fields.remove("offset"); }
                            abort
                        });
                        next_request += 1;
                        let command = match stage(&mut upload, id, command, data, generation) {
                            Ok(Staged::Call(command)) => command,
                            result => {
                                let mut reply = response(id, match result { Ok(Staged::Reply(value)) => Ok(value), Err(error) => Err(error), _ => unreachable!() });
                                reply["type"] = json!("memoryReply");
                                if self.outgoing.send_frame(reply, control).await.is_err() { break; }
                                continue;
                            }
                        };
                        let service = service.clone();
                        let next_native = next_native.clone();
                        pending.insert(id);
                        calls.push(Box::pin(async move {
                            let mut result = Ok(Json::Null);
                            for command in command {
                                let sequence = next_native.fetch_add(1, Ordering::Relaxed);
                                result = match service.invoke("dispatch", Value::List(vec![json!(sequence).into(), command])) {
                                    Ok(value) => invoke(value).await,
                                    Err(error) => Err(bridge_error(error)),
                                };
                                if result.is_err() { break; }
                            }
                            if let Some(abort) = abort.filter(|_| result.is_err()) {
                                let sequence = next_native.fetch_add(1, Ordering::Relaxed);
                                if let Ok(value) = service.invoke("dispatch", Value::List(vec![json!(sequence).into(), abort.into()])) {
                                    let _ = invoke(value).await;
                                }
                            }
                            (id, control, closed, result)
                        }));
                    }
                }
            }
            Ok(Effect::Done)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "00000000-0000-4000-8000-000000000001";

    fn command(method: &str) -> Json {
        json!({ "method": method, "generation": ID, "operation": ID, "resource": ID, "upload": ID })
    }
    fn begin(bytes: usize) -> Json {
        let mut value = command("begin");
        value["bytes"] = json!(bytes);
        value["memoryIds"] = json!(["memory"]);
        value
    }
    #[test]
    fn upload_receipts_never_publish_an_incomplete_batch() {
        let mut upload = None;
        assert!(matches!(
            stage(&mut upload, 1, begin(8), Some(vec![0; 4]), ID),
            Ok(Staged::Reply(Json::Null))
        ));
        assert!(stage(&mut upload, 2, command("commit"), None, ID).is_err());
        let mut chunk = command("chunk");
        chunk["offset"] = json!(0);
        assert!(stage(&mut upload, 3, chunk.clone(), Some(vec![1; 4]), ID).is_err());
        chunk["offset"] = json!(4);
        assert!(
            matches!(stage(&mut upload, 4, chunk.clone(), Some(vec![1; 4]), ID), Ok(Staged::Reply(value)) if value == 8)
        );
        assert!(stage(&mut upload, 5, chunk, Some(vec![1; 4]), ID).is_err());
        let Ok(Staged::Call(calls)) = stage(&mut upload, 6, command("commit"), None, ID) else {
            panic!("Expected one native upsert")
        };
        let Value::Record(fields) = &calls[0] else {
            panic!("Expected native fields")
        };
        assert_eq!(fields["method"], Value::from(json!("upsert")));
        assert_eq!(fields["data"], Value::Bytes(vec![0, 0, 0, 0, 1, 1, 1, 1]));
        assert_eq!(upload.as_ref().unwrap().commit, Some(6));
        assert!(stage(&mut upload, 7, begin(8), None, ID).is_err());
        assert!(stage(&mut upload, 8, command("abort"), None, ID).is_ok());
        assert!(upload.is_some(), "An abort cannot disown a native write");
    }
    #[test]
    fn first_and_continuation_chunks_share_one_bounded_batch() {
        let mut upload = None;
        let expected = MAX_MEMORY_INITIAL_CHUNK + MAX_MEMORY_CHUNK;
        assert!(stage(
            &mut upload,
            1,
            begin(expected),
            Some(vec![0; MAX_MEMORY_INITIAL_CHUNK + 1]),
            ID
        )
        .is_err());
        assert!(upload.is_none());
        assert!(stage(
            &mut upload,
            2,
            begin(expected),
            Some(vec![0; MAX_MEMORY_INITIAL_CHUNK]),
            ID
        )
        .is_ok());
        let mut commit = command("commit");
        commit["offset"] = json!(MAX_MEMORY_INITIAL_CHUNK);
        assert!(stage(
            &mut upload,
            3,
            commit.clone(),
            Some(vec![1; MAX_MEMORY_CHUNK + 1]),
            ID
        )
        .is_err());
        let Ok(Staged::Call(calls)) =
            stage(&mut upload, 4, commit, Some(vec![1; MAX_MEMORY_CHUNK]), ID)
        else {
            panic!("Expected one complete native batch")
        };
        assert_eq!(calls.len(), 1);
        let Value::Record(fields) = &calls[0] else {
            panic!("Expected native fields")
        };
        let Value::Bytes(bytes) = &fields["data"] else {
            panic!("Expected packed bytes")
        };
        assert_eq!(bytes.len(), expected);
        assert_eq!(bytes[MAX_MEMORY_INITIAL_CHUNK - 1], 0);
        assert_eq!(bytes[MAX_MEMORY_INITIAL_CHUNK], 1);
    }
    #[test]
    fn upload_bounds_and_identity_are_checked_before_staging() {
        let mut upload = None;
        for bytes in [0, 3, MAX_UPLOAD_BYTES + 4] {
            assert!(stage(&mut upload, 1, begin(bytes), None, ID).is_err());
            assert!(upload.is_none());
        }
        let mut invalid = begin(8);
        invalid["memoryIds"] = json!(["memory", "memory"]);
        assert!(stage(&mut upload, 1, invalid, None, ID).is_err());
        assert!(stage(&mut upload, 1, begin(8), None, "stale").is_err());
        assert!(stage(&mut upload, 1, begin(8), Some(vec![0; 9]), ID).is_err());
        assert!(stage(&mut upload, 1, begin(8), None, ID).is_ok());
        let mut wrong = command("abort");
        wrong["upload"] = json!("00000000-0000-4000-8000-000000000002");
        assert!(stage(&mut upload, 2, wrong, None, ID).is_ok());
        assert!(upload.is_some());
        assert!(stage(&mut upload, 3, command("abort"), None, ID).is_ok());
        assert!(upload.is_none());
        let mut final_chunk = command("commit");
        final_chunk["offset"] = json!(4);
        assert!(stage(&mut upload, 4, begin(8), Some(vec![0; 4]), ID).is_ok());
        assert!(matches!(
            stage(&mut upload, 5, final_chunk, Some(vec![1; 4]), ID),
            Ok(Staged::Call(_))
        ));
    }
    #[test]
    fn maximum_upload_uses_bounded_native_parts() {
        let mut upload = None;
        assert!(stage(&mut upload, 1, begin(MAX_UPLOAD_BYTES), None, ID).is_ok());
        for offset in (0..MAX_UPLOAD_BYTES).step_by(MAX_MEMORY_CHUNK) {
            let mut chunk = command("chunk");
            chunk["offset"] = json!(offset);
            let length = MAX_MEMORY_CHUNK.min(MAX_UPLOAD_BYTES - offset);
            assert!(stage(&mut upload, 2, chunk, Some(vec![0; length]), ID).is_ok());
        }
        let Ok(Staged::Call(calls)) = stage(&mut upload, 3, command("commit"), None, ID) else {
            panic!("Expected native parts")
        };
        assert_eq!(calls.len(), 2);
        for (index, call) in calls.iter().enumerate() {
            let Value::Record(fields) = call else {
                panic!("Expected native fields")
            };
            assert_eq!(
                fields["offset"],
                Value::from(json!(index * MAX_NATIVE_PART))
            );
            assert!(
                matches!(&fields["data"], Value::Bytes(bytes) if bytes.len() == MAX_NATIVE_PART)
            );
        }
    }
}
