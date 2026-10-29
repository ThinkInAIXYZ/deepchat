use super::*;
use rutis_bridge::transport::local::Processes;
use std::collections::{BTreeMap, HashSet};

pub type Reply = oneshot::Sender<std::result::Result<Json, Json>>;

#[derive(Default)]
struct State {
    config: Option<Json>,
    core: bool,
    core_requested: bool,
    retired: bool,
    settled: bool,
    identity: Option<Json>,
    failure: Option<Json>,
    processes: Option<Processes>,
    next: u64,
    waiting: BTreeMap<u64, Request>,
    pending: HashSet<u64>,
}

pub struct Link {
    input: mpsc::Sender<Request>,
    state: Mutex<State>,
    changed: tokio::sync::Notify,
}

impl Link {
    pub fn new(input: mpsc::Sender<Request>) -> Self {
        Self {
            input,
            state: Mutex::new(State::default()),
            changed: tokio::sync::Notify::new(),
        }
    }

    pub fn bind(&self, config: Json, core: bool, processes: Processes) -> bool {
        let mut state = self.state.lock().unwrap();
        state.config = Some(config);
        state.core = core;
        state.processes = Some(processes);
        state.next = 1;
        if core && state.retired {
            state.failure = Some(error(
                "MemoryVectorRuntimeUnavailableError",
                "Core Memory startup was retired",
            ));
            state.settled = true;
        }
        self.changed.notify_waiters();
        !core || !state.retired
    }

    pub fn ready(&self, identity: Json) {
        let mut state = self.state.lock().unwrap();
        state.identity = Some(identity);
        state.settled = true;
        self.changed.notify_waiters();
    }

    pub fn failed(&self, failure: Json) {
        let mut state = self.state.lock().unwrap();
        state.failure = Some(failure.clone());
        state.settled = true;
        self.changed.notify_waiters();
        for (_, request) in std::mem::take(&mut state.waiting) {
            if let Request::CoreMemoryCall { reply, .. } = request {
                let _ = reply.send(Err(failure.clone()));
            }
        }
    }

    pub fn start(
        &self,
        config: Json,
    ) -> std::result::Result<oneshot::Receiver<std::result::Result<Json, Json>>, Json> {
        let mut state = self.state.lock().unwrap();
        if state.retired {
            return Err(error(
                "MemoryVectorRuntimeUnavailableError",
                "Core Memory generation retired",
            ));
        }
        if let Some(failure) = &state.failure {
            return Err(failure.clone());
        }
        if let Some(current) = &state.config {
            if !state.core || current != &config {
                return Err(error(
                    "MemoryVectorOwnershipUnavailableError",
                    "Memory generation already has an owner",
                ));
            }
        }
        let (reply, result) = oneshot::channel();
        self.input
            .try_send(Request::CoreMemoryStart { config, reply })
            .map_err(|_| {
                error(
                    "MemoryVectorRuntimeUnavailableError",
                    "Memory startup channel is unavailable",
                )
            })?;
        state.core_requested = true;
        Ok(result)
    }

    pub fn call(
        &self,
        id: u64,
        command: Json,
        data: Option<Vec<u8>>,
    ) -> std::result::Result<oneshot::Receiver<std::result::Result<Json, Json>>, Json> {
        let mut state = self.state.lock().unwrap();
        if let Some(failure) = &state.failure {
            return Err(failure.clone());
        }
        if state.retired || !state.core || state.identity.is_none() {
            return Err(error(
                "MemoryVectorRuntimeUnavailableError",
                "Core does not own a ready Memory generation",
            ));
        }
        let control = matches!(
            command["method"].as_str(),
            Some("close" | "abort" | "reset" | "quarantine")
        );
        if id < state.next
            || id - state.next >= MAX_MEMORY_CALLS as u64
            || state.pending.contains(&id)
            || state.pending.len()
                >= if control {
                    MAX_MEMORY_CALLS
                } else {
                    MAX_MEMORY_CALLS - 8
                }
        {
            return Err(error(
                "MemoryVectorProtocolError",
                "Invalid or excessive Core Memory request",
            ));
        }
        if command["generation"] != state.identity.as_ref().unwrap()["generation"] {
            return Err(error(
                "MemoryVectorProtocolError",
                "Memory generation changed",
            ));
        }
        let (reply, result) = oneshot::channel();
        state.pending.insert(id);
        state.waiting.insert(
            id,
            Request::CoreMemoryCall {
                id,
                command,
                data,
                reply,
            },
        );
        loop {
            let next = state.next;
            let Some(request) = state.waiting.remove(&next) else {
                break;
            };
            if let Err(cause) = self.input.try_send(request) {
                let failure = error(
                    "MemoryVectorRuntimeUnavailableError",
                    "Memory request channel is unavailable",
                );
                if let Request::CoreMemoryCall { reply, .. } = cause.into_inner() {
                    let _ = reply.send(Err(failure.clone()));
                }
                state.failure = Some(failure.clone());
                for (_, request) in std::mem::take(&mut state.waiting) {
                    if let Request::CoreMemoryCall { reply, .. } = request {
                        let _ = reply.send(Err(failure.clone()));
                    }
                }
                break;
            }
            state.next += 1;
        }
        Ok(result)
    }

    pub fn complete(&self, id: u64) {
        self.state.lock().unwrap().pending.remove(&id);
    }

    pub async fn retire_core(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let (processes, waiting) = {
                let mut state = self.state.lock().unwrap();
                if state.config.is_some() && !state.core {
                    return;
                }
                state.retired = true;
                if !state.core_requested && !state.core {
                    return;
                }
                (state.processes.clone(), !state.settled)
            };
            if waiting {
                changed.await;
                continue;
            }
            if let Some(processes) = processes {
                processes.kill();
                processes.ended().await;
            }
            self.failed(error(
                "MemoryVectorRuntimeUnavailableError",
                "Core Memory generation retired",
            ));
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn retirement_fences_late_start_and_waits_for_accepted_startup() {
        let (input, mut incoming) = mpsc::channel(32);
        let unused = Link::new(input.clone());
        unused.retire_core().await;
        assert!(unused.start(json!({})).is_err());
        assert!(incoming.try_recv().is_err());

        let link = Arc::new(Link::new(input));
        let _reply = link.start(json!({})).unwrap();
        let retiring = link.clone();
        let retirement = tokio::spawn(async move { retiring.retire_core().await });
        timeout(Duration::from_secs(1), async {
            while !link.state.lock().unwrap().retired {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!retirement.is_finished());
        link.failed(error(
            "MemoryVectorRuntimeUnavailableError",
            "Startup failed",
        ));
        retirement.await.unwrap();
        assert!(link.start(json!({})).is_err());
    }
}
