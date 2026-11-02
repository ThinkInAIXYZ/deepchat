use super::{error, Json, Output, MAX_CALLS};
use rutis::{BoxFuture, CordisError, Ctx, Effect, Plugin};
use rutis_bridge::session::{host_key, Error as BridgeError, HostDispatch, Reply, Value};
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::sync::{oneshot, Notify};

type Outcome = std::result::Result<Json, Json>;
type ReplySender = oneshot::Sender<Outcome>;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const OBSERVATIONS: usize = 512;
const SAMPLES: usize = 256;

struct Acquisition {
    owner: String,
    limit: u64,
    sequence: u64,
    correlation: Option<Json>,
    started: Instant,
    granted: Option<Instant>,
    reply: Option<ReplySender>,
}

struct Command {
    method: String,
    args: Vec<Json>,
    reply: ReplySender,
}

struct Lane {
    next: u64,
    pending: BTreeMap<u64, Command>,
}

impl Default for Lane {
    fn default() -> Self {
        Self {
            next: 1,
            pending: BTreeMap::new(),
        }
    }
}

struct State {
    capacity: u64,
    max_pending: u64,
    closed: Option<String>,
    retired: bool,
    acquisitions: HashMap<String, Acquisition>,
    owners: HashMap<String, VecDeque<String>>,
    owner_order: VecDeque<String>,
    ring: VecDeque<String>,
    active_by_owner: HashMap<String, u64>,
    active: u64,
    pending: u64,
    acquisition_sequence: u64,
    active_high_water: u64,
    pending_high_water: u64,
    granted: u64,
    rejected: u64,
    waits: VecDeque<f64>,
    holds: VecDeque<f64>,
    observations_enabled: bool,
    observations: VecDeque<Json>,
    observation_sequence: u64,
    observations_dropped: u64,
    observation_in_flight: bool,
    flush_waiters: Vec<ReplySender>,
    main: Lane,
    core: Lane,
    core_generation: Option<String>,
}

fn invalid(message: &str) -> Json {
    error("Error", message)
}

fn closed(message: &str) -> Json {
    error("AgentInvocationAdmissionClosedError", message)
}

fn cancelled() -> Json {
    error(
        "AgentInvocationAdmissionAbortedError",
        "Agent invocation admission was cancelled while queued.",
    )
}

fn identifier(value: &Json) -> Option<&str> {
    value
        .as_str()
        .filter(|value| !value.is_empty() && value.encode_utf16().count() <= 256)
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c) || c == b'-')
}

fn normalize_owner(value: &Json) -> Option<String> {
    let value = value.as_str()?.trim_matches(|c| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
    });
    identifier(&json!(value)).map(str::to_owned)
}

fn sample(values: &mut VecDeque<f64>, value: f64) {
    if values.len() == SAMPLES {
        values.pop_front();
    }
    values.push_back(value);
}

fn distribution(values: &VecDeque<f64>) -> Json {
    let mut values: Vec<_> = values.iter().copied().collect();
    values.sort_by(f64::total_cmp);
    let rank = |p: f64| {
        values
            .get((p * values.len() as f64).ceil().max(1.0) as usize - 1)
            .copied()
    };
    json!({ "samples": values.len(), "p50": rank(0.5), "p95": rank(0.95), "max": values.last() })
}

impl State {
    fn new(capacity: u64, max_pending: u64) -> Self {
        Self {
            capacity,
            max_pending,
            closed: None,
            retired: false,
            acquisitions: HashMap::new(),
            owners: HashMap::new(),
            owner_order: VecDeque::new(),
            ring: VecDeque::new(),
            active_by_owner: HashMap::new(),
            active: 0,
            pending: 0,
            acquisition_sequence: 0,
            active_high_water: 0,
            pending_high_water: 0,
            granted: 0,
            rejected: 0,
            waits: VecDeque::new(),
            holds: VecDeque::new(),
            observations_enabled: false,
            observations: VecDeque::new(),
            observation_sequence: 0,
            observations_dropped: 0,
            observation_in_flight: false,
            flush_waiters: Vec::new(),
            main: Lane::default(),
            core: Lane::default(),
            core_generation: None,
        }
    }

    fn snapshot(&self) -> Json {
        json!({
            "capacity": self.capacity, "active": self.active, "pending": self.pending,
            "pendingOwners": self.owners.len(), "closed": self.closed.is_some(),
            "activeHighWater": self.active_high_water, "pendingHighWater": self.pending_high_water,
            "granted": self.granted, "rejected": self.rejected,
            "observationsDropped": self.observations_dropped,
            "waitMs": distribution(&self.waits), "holdMs": distribution(&self.holds),
        })
    }

    fn emit(&mut self, mut observation: Json) {
        if !self.observations_enabled {
            return;
        }
        if self.observations.len() == OBSERVATIONS {
            self.observations.pop_front();
            self.observations_dropped += 1;
        }
        if observation["type"] == "closed" {
            observation["observationsDropped"] = self.observations_dropped.into();
        }
        self.observations.push_back(observation);
    }

    fn observe(&mut self, acquisition: &Acquisition, kind: &str, fields: Json) {
        let Some(mut observation) = acquisition.correlation.clone() else {
            return;
        };
        observation["type"] = kind.into();
        observation["acquisitionSeq"] = acquisition.sequence.into();
        observation["active"] = self.active.into();
        observation["pending"] = self.pending.into();
        if kind != "released" {
            observation["capacity"] = self.capacity.into();
        }
        observation
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        self.emit(observation);
    }

    fn active_for(&self, owner: &str) -> u64 {
        self.active_by_owner.get(owner).copied().unwrap_or(0)
    }

    fn grant(&mut self, id: &str) {
        let mut record = self.acquisitions.remove(id).unwrap();
        self.active += 1;
        *self
            .active_by_owner
            .entry(record.owner.clone())
            .or_default() += 1;
        self.active_high_water = self.active_high_water.max(self.active);
        self.granted += 1;
        let granted = Instant::now();
        let wait = granted.duration_since(record.started).as_secs_f64() * 1000.0;
        sample(&mut self.waits, wait);
        self.observe(&record, "granted", json!({ "waitMs": wait }));
        record.granted = Some(granted);
        let reply = record.reply.take().unwrap();
        self.acquisitions.insert(id.to_owned(), record);
        if reply.send(Ok(id.into())).is_err() {
            // A dropped reply cannot leave an unreachable permit holding capacity.
            self.release_record(id, "permit_released");
        }
    }

    fn reject(&mut self, mut record: Acquisition, reason: &str, failure: Json, queued: bool) {
        self.rejected += 1;
        let wait = if queued {
            record.started.elapsed().as_secs_f64() * 1000.0
        } else {
            0.0
        };
        if queued {
            sample(&mut self.waits, wait);
        }
        self.observe(
            &record,
            "rejected",
            json!({ "reason": reason, "waitMs": wait }),
        );
        let _ = record.reply.take().unwrap().send(Err(failure));
    }

    fn dispatch(&mut self) {
        while self.active < self.capacity && self.pending > 0 && !self.ring.is_empty() {
            let mut granted = false;
            for _ in 0..self.ring.len() {
                if self.active >= self.capacity {
                    break;
                }
                let owner = self.ring.pop_front().unwrap();
                let id = self.owners[&owner].front().unwrap().clone();
                if self.active_for(&owner) >= self.acquisitions[&id].limit {
                    self.ring.push_back(owner);
                    continue;
                }
                let queue = self.owners.get_mut(&owner).unwrap();
                queue.pop_front();
                if queue.is_empty() {
                    self.owners.remove(&owner);
                    self.owner_order.retain(|candidate| candidate != &owner);
                } else {
                    self.ring.push_back(owner);
                }
                self.pending -= 1;
                granted = true;
                self.grant(&id);
            }
            if !granted {
                break;
            }
        }
    }

    fn acquire(
        &mut self,
        args: &[Json],
        reply: &mut Option<ReplySender>,
    ) -> std::result::Result<Option<Json>, Json> {
        if args.len() != 3 {
            return Err(invalid("Invalid acquire arguments"));
        }
        self.observations_enabled = args[2] == true;
        let id = args[0]
            .as_str()
            .filter(|id| uuid(id) && !self.acquisitions.contains_key(*id))
            .ok_or_else(|| invalid("Invalid admission acquisition identity"))?
            .to_owned();
        let options = args[1]
            .as_object()
            .ok_or_else(|| invalid("Invalid admission options"))?;
        let owner = normalize_owner(&args[1]["ownerId"])
            .ok_or_else(|| invalid("Agent invocation ownerId must contain 1 to 256 characters."))?;
        let limit = match options.get("maxActiveForOwner") {
            None => self.capacity,
            Some(value) => value
                .as_u64()
                .filter(|value| *value > 0 && *value <= MAX_SAFE_INTEGER)
                .ok_or_else(|| {
                    invalid("Agent invocation owner limit must be a positive safe integer.")
                })?
                .min(self.capacity),
        };
        let correlation = options.get("correlation").filter(|value| {
            value["kind"] == "live_delegation" && ["parentSessionId", "delegationId", "turnId"].iter().all(|key| identifier(&value[*key]).is_some())
        }).map(|value| json!({ "kind": "live_delegation", "parentSessionId": value["parentSessionId"], "delegationId": value["delegationId"], "turnId": value["turnId"] }));
        self.acquisition_sequence = if self.acquisition_sequence >= MAX_SAFE_INTEGER {
            1
        } else {
            self.acquisition_sequence + 1
        };
        let record = Acquisition {
            owner: owner.clone(),
            limit,
            sequence: self.acquisition_sequence,
            correlation,
            started: Instant::now(),
            granted: None,
            reply: reply.take(),
        };
        if let Some(reason) = &self.closed {
            self.reject(record, "closed", closed(reason), false);
        } else if options.get("aborted") == Some(&Json::Bool(true)) {
            self.reject(record, "aborted", cancelled(), false);
        } else if self.active < self.capacity
            && self.pending == 0
            && self.active_for(&owner) < limit
        {
            self.acquisitions.insert(id.clone(), record);
            self.grant(&id);
        } else if self.pending >= self.max_pending {
            self.reject(
                record,
                "queue_full",
                error(
                    "AgentInvocationAdmissionQueueFullError",
                    format!(
                        "Agent invocation admission queue is full ({} pending).",
                        self.max_pending
                    ),
                ),
                false,
            );
        } else {
            if !self.owners.contains_key(&owner) {
                self.ring.push_back(owner.clone());
                self.owner_order.push_back(owner.clone());
            }
            self.owners.entry(owner).or_default().push_back(id.clone());
            self.pending += 1;
            self.pending_high_water = self.pending_high_water.max(self.pending);
            self.observe(&record, "queued", json!({}));
            self.acquisitions.insert(id, record);
            self.dispatch();
        }
        Ok(None)
    }

    fn release(&mut self, id: &str, reason: &str) -> bool {
        let released = self.release_record(id, reason);
        self.dispatch();
        released
    }

    fn release_record(&mut self, id: &str, reason: &str) -> bool {
        let Some(record) = self.acquisitions.remove(id) else {
            return false;
        };
        if let Some(granted) = record.granted {
            self.active -= 1;
            let active = self.active_by_owner.get_mut(&record.owner).unwrap();
            *active -= 1;
            if *active == 0 {
                self.active_by_owner.remove(&record.owner);
            }
            let hold = granted.elapsed().as_secs_f64() * 1000.0;
            sample(&mut self.holds, hold);
            self.observe(
                &record,
                "released",
                json!({ "reason": reason, "holdMs": hold }),
            );
        } else {
            let queue = self.owners.get_mut(&record.owner).unwrap();
            queue.retain(|pending| pending != id);
            if queue.is_empty() {
                self.owners.remove(&record.owner);
                self.owner_order.retain(|owner| owner != &record.owner);
                self.ring.retain(|owner| owner != &record.owner);
            }
            self.pending -= 1;
            self.reject(record, "aborted", cancelled(), true);
        }
        true
    }

    fn close(&mut self, reason: String) {
        if self.closed.is_some() {
            return;
        }
        self.closed = Some(reason.clone());
        let mut owners = std::mem::take(&mut self.owners);
        self.ring.clear();
        for owner in std::mem::take(&mut self.owner_order) {
            for id in owners.remove(&owner).unwrap() {
                let record = self.acquisitions.remove(&id).unwrap();
                self.pending -= 1;
                self.reject(record, "closed", closed(&reason), true);
            }
        }
        let mut observation = self.snapshot();
        observation.as_object_mut().unwrap().remove("pendingOwners");
        observation.as_object_mut().unwrap().remove("closed");
        observation["type"] = "closed".into();
        self.emit(observation);
    }

    fn flush(&mut self, reply: ReplySender) {
        if self.observations.is_empty() && !self.observation_in_flight {
            let _ = reply.send(Ok(Json::Null));
        } else {
            self.flush_waiters.push(reply);
        }
    }

    fn command(&mut self, command: Command) {
        let mut reply = Some(command.reply);
        let result = match command.method.as_str() {
            "acquire" => self.acquire(&command.args, &mut reply),
            "release" => {
                let args = &command.args;
                if args.len() != 3
                    || !matches!(
                        args[1].as_str(),
                        Some("permit_released" | "lease_suspended" | "lease_released")
                    )
                {
                    Err(invalid("Invalid admission release reason"))
                } else {
                    self.observations_enabled = args[2] == true;
                    Ok(Some(
                        self.release(args[0].as_str().unwrap_or(""), args[1].as_str().unwrap())
                            .into(),
                    ))
                }
            }
            "snapshot" if command.args.is_empty() => {
                Ok(Some(json!({ "admission": self.snapshot() })))
            }
            "close" if command.args.len() <= 2 => {
                if let Some(enabled) = command.args.get(1) {
                    self.observations_enabled = enabled == true;
                }
                self.close(
                    command
                        .args
                        .first()
                        .and_then(Json::as_str)
                        .unwrap_or("Agent invocation admission is closed.")
                        .to_owned(),
                );
                self.flush(reply.take().unwrap());
                Ok(None)
            }
            "flushObservations" if command.args.is_empty() => {
                self.flush(reply.take().unwrap());
                Ok(None)
            }
            _ => Err(invalid("Invalid admission command")),
        };
        if let Some(reply) = reply {
            let _ = reply.send(result.map(|value| value.unwrap_or(Json::Null)));
        }
    }

    fn ordered(
        &mut self,
        core: bool,
        sequence: u64,
        command: Command,
    ) -> std::result::Result<(), BridgeError> {
        let lane = if core { &mut self.core } else { &mut self.main };
        if sequence < lane.next
            || sequence > MAX_SAFE_INTEGER
            || sequence - lane.next > MAX_CALLS as u64
            || lane.pending.contains_key(&sequence)
        {
            return Err(BridgeError::Value(
                "Invalid admission command sequence".into(),
            ));
        }
        lane.pending.insert(sequence, command);
        loop {
            let lane = if core { &mut self.core } else { &mut self.main };
            let Some(command) = lane.pending.remove(&lane.next) else {
                break;
            };
            lane.next += 1;
            self.command(command);
        }
        Ok(())
    }

    fn retire(&mut self) {
        self.close("Admission generation ended".into());
        self.retired = true;
        for (_, command) in std::mem::take(&mut self.main.pending)
            .into_iter()
            .chain(std::mem::take(&mut self.core.pending))
        {
            let _ = command
                .reply
                .send(Err(closed("Admission generation ended")));
        }
        let mut active: Vec<_> = self
            .acquisitions
            .iter()
            .map(|(id, record)| (record.sequence, id.clone()))
            .collect();
        active.sort_by_key(|(sequence, _)| *sequence);
        for (_, id) in active {
            self.release_record(&id, "permit_released");
        }
    }
}

pub struct Admission {
    state: Arc<Mutex<State>>,
    changed: Arc<Notify>,
}

impl Admission {
    pub fn new(capacity: u64, max_pending: u64) -> Self {
        Self {
            state: Arc::new(Mutex::new(State::new(capacity, max_pending))),
            changed: Arc::new(Notify::new()),
        }
    }

    async fn observations(&self, output: Output) {
        loop {
            self.changed.notified().await;
            loop {
                let next = {
                    let mut state = self.state.lock().unwrap();
                    match state.observations.pop_front() {
                        Some(value) => {
                            state.observation_sequence += 1;
                            state.observation_in_flight = true;
                            Some(
                                json!({ "type": "observation", "sequence": state.observation_sequence, "value": value }),
                            )
                        }
                        None => {
                            for reply in state.flush_waiters.drain(..) {
                                let _ = reply.send(Ok(Json::Null));
                            }
                            if state.retired {
                                return;
                            }
                            None
                        }
                    }
                };
                let Some(frame) = next else {
                    break;
                };
                let _ = output.send(frame).await;
                self.state.lock().unwrap().observation_in_flight = false;
            }
        }
    }
}

impl HostDispatch for Admission {
    fn invoke(&self, method: &str, args: Value) -> Reply {
        let args = args.json()?;
        let args = args
            .as_array()
            .ok_or_else(|| BridgeError::Value("Invalid admission arguments".into()))?;
        let (reply, receiver) = oneshot::channel();
        let mut state = self.state.lock().unwrap();
        if state.retired && method != "snapshot" {
            return Err(BridgeError::Value("Admission generation ended".into()));
        }
        if matches!(method, "dispatch" | "dispatchCore") {
            let core = method == "dispatchCore";
            let offset = usize::from(core);
            if args.len() != 3 + offset {
                return Err(BridgeError::Value("Invalid admission dispatch".into()));
            }
            if core {
                let generation = args[0]
                    .as_str()
                    .filter(|value| uuid(value))
                    .ok_or_else(|| {
                        BridgeError::Value("Invalid Core admission generation".into())
                    })?;
                if state
                    .core_generation
                    .as_deref()
                    .is_some_and(|current| current != generation)
                {
                    return Err(BridgeError::Value(
                        "Admission Core generation cannot change".into(),
                    ));
                }
                state.core_generation = Some(generation.to_owned());
            }
            let sequence = args[offset]
                .as_u64()
                .filter(|value| *value > 0)
                .ok_or_else(|| BridgeError::Value("Invalid admission sequence".into()))?;
            let method = args[offset + 1]
                .as_str()
                .ok_or_else(|| BridgeError::Value("Invalid admission method".into()))?;
            let input = args[offset + 2]
                .as_array()
                .ok_or_else(|| BridgeError::Value("Invalid admission input".into()))?;
            state.ordered(
                core,
                sequence,
                Command {
                    method: method.into(),
                    args: input.clone(),
                    reply,
                },
            )?;
        } else {
            state.command(Command {
                method: method.into(),
                args: args.clone(),
                reply,
            });
        }
        drop(state);
        self.changed.notify_one();
        Ok(Value::future(async move {
            match receiver
                .await
                .map_err(|_| BridgeError::Transport("Admission reply closed".into()))?
            {
                Ok(value) => Ok(value.into()),
                Err(failure) => Err(BridgeError::Remote {
                    name: failure["name"].as_str().unwrap_or("Error").into(),
                    message: failure["message"]
                        .as_str()
                        .unwrap_or("Admission failed")
                        .into(),
                    graph: None,
                }),
            }
        }))
    }
}

pub struct Owner {
    pub admission: Arc<Admission>,
    pub output: Output,
}

impl Plugin for Owner {
    fn name(&self) -> &str {
        "deepchat-admission"
    }
    fn apply<'a>(
        &'a self,
        ctx: &'a Ctx,
    ) -> BoxFuture<'a, std::result::Result<Effect, CordisError>> {
        Box::pin(async move {
            let admission = self.admission.clone();
            let output = self.output.clone();
            let worker_owner = admission.clone();
            let worker = tokio::spawn(async move {
                worker_owner.observations(output).await;
            });
            ctx.effect(|| {
                Effect::AsyncDisposer(Box::new(move || {
                    Box::pin(async move {
                        admission.state.lock().unwrap().retire();
                        admission.changed.notify_one();
                        worker
                            .await
                            .map_err(|error| CordisError::PluginFailed(Box::new(error)))?;
                        Ok(())
                    })
                }))
            })?;
            ctx.provide_as::<dyn HostDispatch>(
                host_key("harnessAdmission"),
                self.admission.clone(),
            )?;
            Ok(Effect::Done)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rutis_bridge::session::settle;

    fn id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }

    fn acquire(owner: &Admission, n: usize, name: &str, limit: u64) -> Value {
        owner
            .invoke(
                "acquire",
                json!([id(n), { "ownerId": name, "maxActiveForOwner": limit }, false]).into(),
            )
            .unwrap()
    }

    async fn result(value: Value) -> Json {
        settle(value).await.unwrap().json().unwrap()
    }

    async fn snapshot(owner: &Admission) -> Json {
        result(owner.invoke("snapshot", json!([]).into()).unwrap()).await["admission"].clone()
    }

    async fn release(owner: &Admission, n: usize) -> Json {
        result(
            owner
                .invoke("release", json!([id(n), "permit_released", false]).into())
                .unwrap(),
        )
        .await
    }

    #[tokio::test]
    async fn owner_headroom_fifo_fairness_and_cancelled_waiters_preserve_capacity() {
        let owner = Admission::new(2, 4);
        assert_eq!(result(acquire(&owner, 1, "a", 1)).await, id(1));
        let a1 = acquire(&owner, 2, "a", 1);
        let a2 = acquire(&owner, 3, "a", 1);
        assert_eq!(result(acquire(&owner, 4, "b", 1)).await, id(4));
        let c = acquire(&owner, 5, "c", 1);
        assert_eq!(snapshot(&owner).await["pending"], 3);
        assert_eq!(release(&owner, 3).await, true);
        assert!(
            matches!(settle(a2).await, Err(BridgeError::Remote { name, .. }) if name == "AgentInvocationAdmissionAbortedError")
        );
        assert_eq!(release(&owner, 4).await, true);
        assert_eq!(result(c).await, id(5));
        assert_eq!(snapshot(&owner).await["pending"], 1);
        assert_eq!(release(&owner, 1).await, true);
        assert_eq!(result(a1).await, id(2));
        assert_eq!(release(&owner, 1).await, false);
        release(&owner, 2).await;
        release(&owner, 5).await;
        assert_eq!(snapshot(&owner).await["active"], 0);
        assert_eq!(snapshot(&owner).await["pending"], 0);
        result(acquire(&owner, 6, "a", 1)).await;
        let abandoned = acquire(&owner, 7, "a", 1);
        result(acquire(&owner, 8, "b", 1)).await;
        let next = acquire(&owner, 9, "c", 1);
        drop(abandoned);
        release(&owner, 6).await;
        assert_eq!(result(next).await, id(9));
        release(&owner, 8).await;
        release(&owner, 9).await;
        assert_eq!(snapshot(&owner).await["active"], 0);
        assert!(normalize_owner(&json!("😀".repeat(129))).is_none());
        assert_eq!(
            normalize_owner(&json!("\u{feff} a \u{feff}")),
            Some("a".into())
        );
    }

    #[tokio::test]
    async fn plugin_retirement_fences_old_permits_and_pending_replies_before_replacement() {
        let ctx = Ctx::root().unwrap();
        let (output, _responses) = Output::channel();
        let old = Arc::new(Admission::new(1, 1));
        let plugin = ctx.plugin(Owner {
            admission: old.clone(),
            output: output.clone(),
        });
        (&plugin).await.unwrap();
        result(acquire(&old, 1, "a", 1)).await;
        let waiting = acquire(&old, 2, "b", 1);
        assert!(
            matches!(settle(acquire(&old, 3, "c", 1)).await, Err(BridgeError::Remote { name, .. }) if name == "AgentInvocationAdmissionQueueFullError")
        );
        plugin.dispose().await.unwrap();
        assert!(
            matches!(settle(waiting).await, Err(BridgeError::Remote { name, .. }) if name == "AgentInvocationAdmissionClosedError")
        );
        assert_eq!(snapshot(&old).await["active"], 0);
        assert_eq!(snapshot(&old).await["pending"], 0);
        assert_eq!(snapshot(&old).await["holdMs"]["samples"], 1);
        assert!(old
            .invoke(
                "acquire",
                json!([id(4), { "ownerId": "late" }, false]).into()
            )
            .is_err());
        let replacement = Arc::new(Admission::new(2, 1));
        ctx.plugin(Owner {
            admission: replacement.clone(),
            output,
        })
        .await
        .unwrap();
        assert_eq!(snapshot(&replacement).await["closed"], false);
        result(acquire(&replacement, 1, "a", 1)).await;
        ctx.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn stalled_diagnostics_stay_bounded_and_cannot_block_permits_or_close() {
        let ctx = Ctx::root().unwrap();
        let (output, responses) = Output::channel();
        let owner = Arc::new(Admission::new(1, 1));
        ctx.plugin(Owner {
            admission: owner.clone(),
            output,
        })
        .await
        .unwrap();
        for n in 0..600 {
            let correlation = json!({ "kind": "live_delegation", "parentSessionId": "parent", "delegationId": "delegation", "turnId": "turn" });
            result(
                owner
                    .invoke(
                        "acquire",
                        json!([id(n), { "ownerId": "a", "correlation": correlation }, true]).into(),
                    )
                    .unwrap(),
            )
            .await;
            result(
                owner
                    .invoke("release", json!([id(n), "permit_released", true]).into())
                    .unwrap(),
            )
            .await;
        }
        let before = snapshot(&owner).await;
        assert_eq!(before["active"], 0);
        assert_eq!(before["waitMs"]["samples"], SAMPLES);
        assert_eq!(before["holdMs"]["samples"], SAMPLES);
        assert!(before["observationsDropped"].as_u64().unwrap() > 0);
        assert!(owner.state.lock().unwrap().observations.len() <= OBSERVATIONS);
        drop(responses);
        result(owner.invoke("close", json!(["done", true]).into()).unwrap()).await;
        assert_eq!(snapshot(&owner).await["closed"], true);
        ctx.shutdown().await.unwrap();
    }
}
