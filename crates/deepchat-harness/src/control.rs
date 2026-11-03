use rutis_bridge::session::Error;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::Mutex,
};

const MAX_METADATA: usize = 16 * 1024 * 1024;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Status {
    #[default]
    Idle,
    Generating,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Operation {
    id: String,
    aborted: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    id: String,
    message_id: String,
    operation_id: String,
}

struct Permission {
    id: String,
    message_id: String,
    tool_call_id: String,
    run_id: Option<String>,
    taken: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum InteractionOrigin {
    PreCheckPermission,
    Question,
    PostCallPermission,
    SkillDraftConfirmation,
    AcpPermission,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingInteraction {
    message_id: String,
    tool_call_id: String,
    origin: InteractionOrigin,
    order: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolBatch {
    id: String,
    call_order: Vec<String>,
    invoked_call_ids: Vec<String>,
    committed_result_call_ids: Vec<String>,
    pending_interaction_call_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InteractionUpdate {
    interactions: Vec<PendingInteraction>,
    #[serde(default, deserialize_with = "deserialize_batch_update")]
    batch: Option<Option<ToolBatch>>,
    #[serde(default)]
    reconcile: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum InputSource {
    Send,
    Queue,
    Steer,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum InputWakeReason {
    Completed,
    Enqueue,
    Manual,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum InputRowState {
    Pending,
    Blocked,
    RetryRequired,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InputRow {
    id: String,
    state: InputRowState,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InputSnapshot {
    queue: Vec<InputRow>,
    steer_head: Option<InputRow>,
    has_claimed: bool,
    has_blocking: bool,
    awaiting_follow_up: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InputRecovery {
    session_id: String,
    held_input_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum InputIntent {
    Enqueue,
    Drain,
    Prepare,
    Steer,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum InputHoldAction {
    ReleaseItem,
    Resume,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ClaimAction {
    Claim,
    UserFact,
    Rollback,
    Consume,
    Block,
    ReleaseForMutation,
    ReleaseBeforeUserFact,
    ReleaseAfterRollback,
}

impl ClaimAction {
    fn terminal(self) -> bool {
        !matches!(self, Self::Claim | Self::UserFact | Self::Rollback)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum InputEffectOutcome {
    Applied,
    Rejected,
    Unknown,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimEffect {
    id: String,
    action: ClaimAction,
    outcome: Option<InputEffectOutcome>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InputClaim {
    id: String,
    input_id: Option<String>,
    source: InputSource,
    disposition: Option<ClaimAction>,
    outcome: Option<InputEffectOutcome>,
    consume_before_provider_stream: bool,
    effect: Option<ClaimEffect>,
    #[serde(skip)]
    scope_id: String,
    #[serde(skip)]
    operation_id: Option<String>,
    #[serde(skip)]
    run_id: Option<String>,
    #[serde(skip)]
    user_fact: bool,
    #[serde(skip)]
    rolled_back: bool,
    #[serde(skip)]
    preparation_only: bool,
}

struct InputDrain {
    id: String,
    scope_id: String,
    claim_id: String,
    settled: bool,
}

struct SteerEffect {
    id: String,
    scope_id: String,
    operation_id: Option<String>,
    outcome: Option<InputEffectOutcome>,
    merge_item_id: Option<String>,
    promotion_id: Option<String>,
}

#[derive(Default)]
struct SessionInputs {
    latest_scope_id: Option<String>,
    active_steer_id: Option<String>,
    active_claim_id: Option<String>,
    claims: HashMap<String, InputClaim>,
    restart_held_ids: HashSet<String>,
    manually_resumed_ids: HashSet<String>,
    wake_reason: Option<InputWakeReason>,
    drain: Option<InputDrain>,
    steer_effect: Option<SteerEffect>,
    interrupted_operation: Option<String>,
}

impl SessionInputs {
    fn has_transcript_effect(&self, scope_id: &str) -> bool {
        self.claims.values().any(|claim| {
            claim.scope_id == scope_id
                && claim.effect.as_ref().is_some_and(|effect| {
                    matches!(effect.action, ClaimAction::UserFact | ClaimAction::Rollback)
                })
        })
    }

    fn snapshot(&self) -> Value {
        json!({
            "activeSteerId": self.active_steer_id,
            "activeClaimId": self.active_claim_id,
            "claims": self.claims.values().collect::<Vec<_>>(),
            "restartHeldIds": self.restart_held_ids,
            "manuallyResumedIds": self.manually_resumed_ids,
            "wakeReason": self.wake_reason,
        })
    }
}

fn deserialize_batch_update<'de, D>(deserializer: D) -> Result<Option<Option<ToolBatch>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<ToolBatch>::deserialize(deserializer).map(Some)
}

#[derive(Clone)]
enum Prepared {
    Operation(Operation),
    Run(Operation, Run),
}

impl Prepared {
    fn id(&self) -> &str {
        match self {
            Self::Operation(operation) => &operation.id,
            Self::Run(_, run) => &run.id,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Scope {
    id: String,
    session_id: String,
    current: bool,
    status: Status,
    operation: Option<Operation>,
    run: Option<Run>,
    first_turn_ready: bool,
    interactions: Vec<PendingInteraction>,
    batch: Option<ToolBatch>,
    #[serde(skip)]
    prepared: Option<Prepared>,
    #[serde(skip)]
    cleared_operation: Option<(String, Option<String>)>,
    #[serde(skip)]
    cleared_run: Option<String>,
    #[serde(skip)]
    leases: HashMap<LeaseTarget, String>,
    #[serde(skip)]
    allow_parking: bool,
    #[serde(skip)]
    permissions: HashMap<String, Permission>,
}

impl Scope {
    fn input_status_allows(&self, reason: InputWakeReason) -> bool {
        matches!(self.status, Status::Idle)
            || (reason != InputWakeReason::Completed && matches!(self.status, Status::Error))
    }

    fn projected_operation(&self, owner: &StatusOwner) -> Option<&str> {
        match owner {
            StatusOwner::Operation { id } => self.operation.as_ref().map_or_else(
                || {
                    self.cleared_operation
                        .as_ref()
                        .and_then(|(operation, _)| (operation == id).then_some(operation.as_str()))
                },
                |operation| (operation.id == *id).then_some(operation.id.as_str()),
            ),
            StatusOwner::Run { id } => self.run.as_ref().map_or_else(
                || {
                    self.cleared_operation
                        .as_ref()
                        .and_then(|(operation, run)| {
                            (run.as_ref() == Some(id)).then_some(operation.as_str())
                        })
                },
                |run| (run.id == *id).then_some(run.operation_id.as_str()),
            ),
            StatusOwner::Orphan => self
                .cleared_operation
                .as_ref()
                .map(|(operation, _)| operation.as_str()),
        }
    }

    fn is_first_interaction(&self, message_id: &str, tool_call_id: &str) -> bool {
        self.interactions.first().is_some_and(|interaction| {
            interaction.message_id == message_id && interaction.tool_call_id == tool_call_id
        })
    }

    fn can_project(&self, owner: &StatusOwner) -> bool {
        self.prepared.is_none()
            && match owner {
                StatusOwner::Operation { id } => self.operation.as_ref().map_or(
                    self.cleared_operation
                        .as_ref()
                        .is_some_and(|(cleared, run)| cleared == id && run.is_none())
                        && self.run.is_none(),
                    |operation| operation.id == *id && self.run.is_none(),
                ),
                StatusOwner::Run { id } => self.run.as_ref().map_or(
                    self.cleared_run.as_ref() == Some(id) && self.operation.is_none(),
                    |run| run.id == *id,
                ),
                StatusOwner::Orphan => self.run.is_none() && self.operation.is_none(),
            }
    }

    fn update_interactions(&mut self, update: InteractionUpdate) -> Result<(), Error> {
        let mut interactions = update.interactions;
        if interactions.iter().any(|interaction| {
            interaction.message_id.is_empty()
                || interaction.tool_call_id.is_empty()
                || interaction.order > MAX_SEQUENCE
        }) {
            return Err(protocol("Invalid pending interaction identity or order"));
        }
        if update.reconcile {
            let mut known = HashMap::new();
            for interaction in &self.interactions {
                known
                    .entry((&interaction.message_id, &interaction.tool_call_id))
                    .or_insert((interaction.origin, interaction.order));
            }
            for interaction in &mut interactions {
                if let Some((origin, order)) =
                    known.get(&(&interaction.message_id, &interaction.tool_call_id))
                {
                    interaction.origin = *origin;
                    interaction.order = *order;
                }
            }
        }
        interactions.sort_by_key(|interaction| interaction.order);
        let mut batch = update.batch.unwrap_or_else(|| self.batch.clone());
        if let Some(batch) = &mut batch {
            if batch.id.is_empty()
                || batch.call_order.iter().any(String::is_empty)
                || batch.invoked_call_ids.iter().any(String::is_empty)
                || batch.committed_result_call_ids.iter().any(String::is_empty)
                || batch
                    .pending_interaction_call_ids
                    .iter()
                    .any(String::is_empty)
            {
                return Err(protocol("Tool batch identity is empty"));
            }
            batch.pending_interaction_call_ids = interactions
                .iter()
                .filter(|interaction| interaction.origin != InteractionOrigin::AcpPermission)
                .map(|interaction| interaction.tool_call_id.clone())
                .collect();
        }
        if batch
            .as_ref()
            .is_some_and(|batch| batch.pending_interaction_call_ids.is_empty())
        {
            batch = None;
        }
        if serde_json::to_vec(&(&interactions, &batch))
            .map_err(protocol)?
            .len()
            > MAX_METADATA
        {
            return Err(protocol(
                "Pending interaction metadata exceeds the runtime bound",
            ));
        }
        self.interactions = interactions;
        self.batch = batch;
        Ok(())
    }

    fn can_start(&self, owner: &StatusOwner, message_id: &str) -> bool {
        let Some(operation) = self
            .operation
            .as_ref()
            .filter(|operation| !operation.aborted)
        else {
            return false;
        };
        self.prepared.is_none()
            && match owner {
                StatusOwner::Operation { id } => operation.id == *id && self.run.is_none(),
                StatusOwner::Run { id } => self.run.as_ref().is_some_and(|run| {
                    run.id == *id
                        && run.message_id == message_id
                        && run.operation_id == operation.id
                }),
                StatusOwner::Orphan => false,
            }
    }

    fn revoke_deferred(&mut self, parent: Option<&str>, fences: &mut Vec<Fence>) {
        self.leases.retain(|target, id| {
            if let LeaseTarget::Deferred {
                parent_lease_id, ..
            } = target
            {
                if parent.is_none_or(|parent| parent == parent_lease_id) {
                    fences.push(Fence::Operation { id: id.clone() });
                    return false;
                }
            }
            true
        });
    }
    fn revoke_permissions(&mut self, fences: &mut Vec<Fence>) {
        for (_, permission) in self.permissions.drain() {
            if !permission.taken {
                fences.push(Fence::Permission { id: permission.id });
            }
        }
    }
}

#[derive(Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum LeaseTarget {
    Interaction {
        message_id: String,
        tool_call_id: String,
    },
    Resume {
        message_id: String,
    },
    Deferred {
        message_id: String,
        tool_call_id: String,
        parent_lease_id: String,
        owner: StatusOwner,
    },
    Drain,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
enum AcceptanceLane {
    Send,
    Steer,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Ticket {
    scope_id: String,
    lease_id: String,
}

struct Acceptance {
    active: Ticket,
    pending: VecDeque<Ticket>,
}

#[derive(Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum StatusOwner {
    Operation { id: String },
    Run { id: String },
    Orphan,
}

#[derive(Deserialize)]
#[serde(
    tag = "method",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Command {
    InputRecovery {
        sessions: Vec<InputRecovery>,
    },
    QueryInput {
        scope_id: String,
        snapshot: InputSnapshot,
        reason: Option<InputWakeReason>,
    },
    BeginInput {
        scope_id: String,
        request_id: String,
        intent: InputIntent,
        source: InputSource,
        reason: Option<InputWakeReason>,
        item_id: Option<String>,
        snapshot: InputSnapshot,
    },
    AckInputEffect {
        scope_id: String,
        claim_id: Option<String>,
        effect_id: String,
        outcome: InputEffectOutcome,
        input_id: Option<String>,
        message_id: Option<String>,
    },
    PrepareClaimEffect {
        scope_id: String,
        owner: StatusOwner,
        claim_id: String,
        effect_id: String,
        action: ClaimAction,
    },
    InputHold {
        scope_id: String,
        action: InputHoldAction,
        item_id: Option<String>,
        queue_ids: Option<Vec<String>>,
        head_id: Option<String>,
    },
    EndInput {
        scope_id: String,
        drain_lease_id: String,
    },
    Open {
        session_id: String,
        scope_id: String,
    },
    PrepareOperation {
        scope_id: String,
        operation_id: String,
    },
    PrepareRun {
        scope_id: String,
        operation_id: String,
        run_id: String,
        message_id: String,
    },
    Commit {
        scope_id: String,
        transition_id: String,
        aborted: bool,
    },
    ClearOperation {
        scope_id: String,
        operation_id: String,
        run_id: Option<String>,
    },
    ClearRun {
        scope_id: String,
        run_id: String,
    },
    Abort {
        scope_id: String,
    },
    OperationAborted {
        scope_id: String,
        operation_id: String,
    },
    Status {
        scope_id: String,
        owner: StatusOwner,
        status: Status,
        interactions: Option<InteractionUpdate>,
    },
    UpdateInteractions {
        scope_id: String,
        owner: StatusOwner,
        update: InteractionUpdate,
    },
    AdvanceBatch {
        scope_id: String,
        owner: StatusOwner,
        invoked_call_id: Option<String>,
        committed_result_call_id: Option<String>,
    },
    InteractionOrigin {
        scope_id: String,
        owner: StatusOwner,
        message_id: String,
        tool_call_id: String,
        origin: InteractionOrigin,
    },
    CheckInteraction {
        scope_id: String,
        owner: StatusOwner,
        message_id: String,
        tool_call_id: String,
        lease_id: String,
    },
    Ready {
        scope_id: String,
        run_id: String,
    },
    ClearReady {
        scope_id: String,
    },
    AbortDeferred {
        scope_id: String,
    },
    RegisterPermission {
        scope_id: String,
        permission_id: String,
        request_id: String,
        message_id: String,
        tool_call_id: String,
        run_id: String,
    },
    TakePermission {
        scope_id: String,
        permission_id: Option<String>,
        request_id: String,
        message_id: String,
        tool_call_id: String,
        run_id: Option<String>,
        lease_id: String,
        granted: bool,
        resolution_id: String,
    },
    AcquireLease {
        scope_id: String,
        lease_id: String,
        target: LeaseTarget,
    },
    ReleaseLease {
        scope_id: String,
        lease_id: String,
        target: LeaseTarget,
    },
    ParkInteraction {
        scope_id: String,
        lease_id: String,
        message_id: String,
        tool_call_id: String,
    },
    ClearSession {
        session_id: String,
        origin_scope_id: Option<String>,
    },
    QueueAcceptance {
        scope_id: String,
        lease_id: String,
        lane: AcceptanceLane,
    },
    ReleaseAcceptance {
        scope_id: String,
        lease_id: String,
        lane: AcceptanceLane,
    },
    Retire {
        scope_id: String,
    },
    Release {
        scope_id: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Fence {
    Operation { id: String },
    Run { id: String },
    Scope { id: String },
    Permission { id: String },
}

#[derive(Default)]
struct State {
    next_sequence: u64,
    revision: u64,
    closed: bool,
    current: HashMap<String, String>,
    scopes: HashMap<String, Scope>,
    parked: HashMap<String, HashSet<String>>,
    acceptance: HashMap<(String, AcceptanceLane), Acceptance>,
    inputs: HashMap<String, SessionInputs>,
    inputs_ready: bool,
}

#[derive(Default)]
pub struct Control(Mutex<State>);

fn protocol(message: impl ToString) -> Error {
    Error::Remote {
        name: "HarnessControlProtocolError".into(),
        message: message.to_string(),
        graph: None,
    }
}

impl Control {
    pub fn dispatch(&self, sequence: u64, command: Value) -> Result<Value, Error> {
        if serde_json::to_vec(&command).map_err(protocol)?.len() > MAX_METADATA {
            return Err(protocol(
                "Harness control metadata exceeds the runtime message bound",
            ));
        }
        let command: Command = serde_json::from_value(command).map_err(protocol)?;
        let mut state = self.0.lock().map_err(protocol)?;
        if state.closed {
            return Err(protocol("Harness control generation ended"));
        }
        if sequence == 0 || sequence > MAX_SEQUENCE || sequence != state.next_sequence + 1 {
            state.closed = true;
            return Err(protocol("Invalid harness control command sequence"));
        }
        state.next_sequence = sequence;
        state.revision += 1;
        state.apply(command)
    }

    pub fn retire(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.closed = true;
            state.current.clear();
            state.scopes.clear();
            state.parked.clear();
            state.acceptance.clear();
            state.inputs.clear();
        }
    }
}

impl State {
    fn apply_input(&mut self, command: Command) -> Result<Value, Error> {
        if let Command::InputRecovery { sessions } = command {
            let is_current = |session_id: &String, scope_id: &String| {
                self.current.get(session_id) == Some(scope_id)
                    && self
                        .scopes
                        .get(scope_id)
                        .is_some_and(|scope| scope.current && scope.session_id == *session_id)
            };
            if self.inputs.iter().any(|(session_id, input)| {
                input
                    .claims
                    .values()
                    .any(|claim| is_current(session_id, &claim.scope_id))
                    || input
                        .steer_effect
                        .as_ref()
                        .is_some_and(|effect| is_current(session_id, &effect.scope_id))
                    || input
                        .drain
                        .as_ref()
                        .is_some_and(|drain| is_current(session_id, &drain.scope_id))
            }) {
                return Ok(self.receipt("", "stale", json!(false), vec![]));
            }
            let mut recovered = self
                .inputs
                .iter()
                .filter_map(|(session_id, input)| {
                    input.latest_scope_id.as_ref().map(|scope_id| {
                        (
                            session_id.clone(),
                            SessionInputs {
                                latest_scope_id: Some(scope_id.clone()),
                                ..SessionInputs::default()
                            },
                        )
                    })
                })
                .collect::<HashMap<_, _>>();
            let mut seen = HashSet::new();
            for session in sessions {
                if session.session_id.is_empty()
                    || session.held_input_ids.iter().any(String::is_empty)
                {
                    return Err(protocol("Input recovery identity is empty"));
                }
                if !seen.insert(session.session_id.clone()) {
                    return Err(protocol("Input recovery repeats a Session"));
                }
                recovered
                    .entry(session.session_id)
                    .or_default()
                    .restart_held_ids = session.held_input_ids.into_iter().collect();
            }
            self.inputs = recovered;
            self.inputs_ready = true;
            for scope in self.scopes.values_mut() {
                scope.leases.remove(&LeaseTarget::Drain);
            }
            return Ok(self.receipt("", "accepted", json!(true), vec![]));
        }
        let scope_id = match &command {
            Command::QueryInput { scope_id, .. }
            | Command::BeginInput { scope_id, .. }
            | Command::AckInputEffect { scope_id, .. }
            | Command::PrepareClaimEffect { scope_id, .. }
            | Command::InputHold { scope_id, .. }
            | Command::EndInput { scope_id, .. } => scope_id.clone(),
            _ => unreachable!(),
        };
        let Some(scope) = self.scopes.get(&scope_id) else {
            return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
        };
        let session_id = scope.session_id.clone();
        let current = scope.current && self.current.get(&session_id) == Some(&scope_id);
        if !self.inputs_ready {
            return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
        }
        let input = self.inputs.entry(session_id.clone()).or_default();
        let mut result = Value::Null;
        let mut outcome = "accepted";
        let mut collect_claim = None;
        match command {
            Command::QueryInput {
                snapshot, reason, ..
            } if current => {
                let head = snapshot.queue.first();
                let has_restart_held = head.is_some_and(|head| {
                    head.state == InputRowState::Pending
                        && input.restart_held_ids.contains(&head.id)
                });
                result = json!({
                    "canDrain": scope.input_status_allows(reason.unwrap_or(InputWakeReason::Enqueue))
                        && scope.interactions.is_empty() && !snapshot.awaiting_follow_up
                        && input.drain.is_none() && !scope.leases.contains_key(&LeaseTarget::Drain)
                        && input.steer_effect.is_none(),
                    "hasRestartHeld": has_restart_held,
                    "onlyRestartHeld": !snapshot.has_claimed && !snapshot.has_blocking
                        && input.active_claim_id.is_none() && snapshot.steer_head.is_none()
                        && !snapshot.queue.is_empty()
                        && snapshot.queue.iter().all(|row| input.restart_held_ids.contains(&row.id))
                });
            }
            Command::BeginInput {
                request_id,
                intent,
                source,
                reason,
                item_id,
                snapshot,
                ..
            } if current => {
                if request_id.is_empty()
                    || snapshot.queue.iter().any(|row| row.id.is_empty())
                    || snapshot
                        .steer_head
                        .as_ref()
                        .is_some_and(|row| row.id.is_empty())
                {
                    return Err(protocol("Input selection identity is empty"));
                }
                let reason = reason.unwrap_or(InputWakeReason::Enqueue);
                let base_ready = scope.input_status_allows(reason)
                    && scope.interactions.is_empty()
                    && !snapshot.awaiting_follow_up;
                let drain_busy =
                    input.drain.is_some() || scope.leases.contains_key(&LeaseTarget::Drain);
                let claim_busy = input.active_claim_id.is_some()
                    || input.steer_effect.is_some()
                    || snapshot.has_claimed;
                let has_retry = snapshot
                    .queue
                    .iter()
                    .any(|row| row.state == InputRowState::RetryRequired);
                let steer = snapshot
                    .steer_head
                    .as_ref()
                    .filter(|row| row.state == InputRowState::Pending);
                let queue = snapshot
                    .queue
                    .first()
                    .filter(|row| row.state == InputRowState::Pending);
                let mut selected = None;
                let mut selected_source = source;
                let mut has_drain = false;
                let mut enqueue_wake = false;
                let action = match intent {
                    InputIntent::Enqueue => {
                        let follow_up = source == InputSource::Send
                            && snapshot.awaiting_follow_up
                            && !has_retry
                            && !snapshot.has_blocking
                            && !claim_busy
                            && !drain_busy;
                        let has_waiting = has_retry
                            || steer.is_some()
                            || if source == InputSource::Send {
                                queue.is_some_and(|row| !input.restart_held_ids.contains(&row.id))
                            } else {
                                queue.is_some()
                            };
                        if source == InputSource::Steer {
                            return Err(protocol("Queue admission cannot use the steer source"));
                        }
                        if follow_up
                            || (base_ready
                                && !snapshot.has_blocking
                                && !claim_busy
                                && !drain_busy
                                && !has_waiting)
                        {
                            has_drain = true;
                            "claim"
                        } else {
                            enqueue_wake = base_ready
                                && !snapshot.has_blocking
                                && !claim_busy
                                && (!drain_busy
                                    || input.drain.as_ref().is_some_and(|drain| {
                                        drain.scope_id == scope_id && drain.settled
                                    }));
                            "pending"
                        }
                    }
                    InputIntent::Drain => {
                        if drain_busy {
                            if input
                                .drain
                                .as_ref()
                                .is_some_and(|drain| drain.scope_id == scope_id && drain.settled)
                                && scope.input_status_allows(reason)
                            {
                                input.wake_reason = Some(
                                    input
                                        .wake_reason
                                        .map_or(reason, |current| current.max(reason)),
                                );
                            }
                            "busy"
                        } else if !base_ready || snapshot.has_blocking || claim_busy {
                            "blocked"
                        } else if let Some(steer) = steer {
                            selected = Some(steer.id.clone());
                            selected_source = InputSource::Steer;
                            has_drain = true;
                            "claim"
                        } else if let Some(queue) =
                            queue.filter(|row| !input.restart_held_ids.contains(&row.id))
                        {
                            selected = Some(queue.id.clone());
                            selected_source = InputSource::Queue;
                            has_drain = true;
                            "claim"
                        } else {
                            "blocked"
                        }
                    }
                    InputIntent::Prepare => {
                        if claim_busy
                            || snapshot.has_blocking
                            || !scope.interactions.is_empty()
                            || snapshot.awaiting_follow_up
                        {
                            "blocked"
                        } else if let Some(row) = snapshot.queue.iter().find(|row| {
                            Some(&row.id) == item_id.as_ref() && row.state == InputRowState::Pending
                        }) {
                            selected = Some(row.id.clone());
                            selected_source = InputSource::Queue;
                            "prepare"
                        } else {
                            "blocked"
                        }
                    }
                    InputIntent::Steer => {
                        let operation = scope.operation.as_ref();
                        let active = scope.run.is_some()
                            || operation.is_some_and(|operation| {
                                !operation.aborted
                                    || input.interrupted_operation.as_ref() == Some(&operation.id)
                            });
                        let merge = input
                            .active_steer_id
                            .as_ref()
                            .filter(|id| steer.is_some_and(|row| &row.id == *id))
                            .cloned();
                        let preparing_promotion = item_id.is_some()
                            && input
                                .active_claim_id
                                .as_ref()
                                .and_then(|id| input.claims.get(id))
                                .is_some_and(|claim| {
                                    claim.scope_id == scope_id
                                        && claim.preparation_only
                                        && claim.input_id.as_ref() == item_id.as_ref()
                                        && claim.disposition.is_none()
                                        && claim.outcome.is_none()
                                        && claim.effect.is_none()
                                });
                        let promotion = item_id
                            .as_ref()
                            .filter(|id| {
                                preparing_promotion
                                    || (input.active_claim_id.is_none()
                                        && !snapshot.has_claimed
                                        && snapshot.queue.iter().any(|row| {
                                            &row.id == *id && row.state == InputRowState::Pending
                                        }))
                            })
                            .cloned();
                        if input.steer_effect.is_some() {
                            "busy"
                        } else if !scope.interactions.is_empty()
                            || snapshot.awaiting_follow_up
                            || (item_id.is_some() && promotion.is_none())
                            || !(active
                                || promotion.is_some()
                                || merge.is_some()
                                || (base_ready && !drain_busy))
                        {
                            "blocked"
                        } else {
                            input.steer_effect = Some(SteerEffect {
                                id: request_id.clone(),
                                scope_id: scope_id.clone(),
                                operation_id: operation.map(|operation| operation.id.clone()),
                                outcome: None,
                                merge_item_id: if promotion.is_some() {
                                    None
                                } else {
                                    merge.clone()
                                },
                                promotion_id: promotion.clone(),
                            });
                            result = json!({ "action": "steer", "effectId": request_id,
                                "source": "steer", "consumeBeforeProviderStream": false });
                            if let Some(merge) = merge.filter(|_| promotion.is_none()) {
                                result["mergeItemId"] = json!(merge);
                            }
                            "steer"
                        }
                    }
                };
                if matches!(action, "claim" | "prepare") {
                    if input.claims.contains_key(&request_id) {
                        return Err(protocol("Input claim identity was reused"));
                    }
                    let consume_before_stream = selected_source == InputSource::Queue
                        && selected
                            .as_ref()
                            .is_some_and(|id| input.manually_resumed_ids.contains(id));
                    input.active_claim_id = Some(request_id.clone());
                    input.claims.insert(
                        request_id.clone(),
                        InputClaim {
                            id: request_id.clone(),
                            input_id: selected.clone(),
                            source: selected_source,
                            disposition: None,
                            outcome: None,
                            consume_before_provider_stream: consume_before_stream,
                            effect: Some(ClaimEffect {
                                id: request_id.clone(),
                                action: ClaimAction::Claim,
                                outcome: None,
                            }),
                            scope_id: scope_id.clone(),
                            operation_id: None,
                            run_id: None,
                            user_fact: false,
                            rolled_back: false,
                            preparation_only: action == "prepare",
                        },
                    );
                    if has_drain {
                        input.drain = Some(InputDrain {
                            id: request_id.clone(),
                            scope_id: scope_id.clone(),
                            claim_id: request_id.clone(),
                            settled: false,
                        });
                        self.scopes
                            .get_mut(&scope_id)
                            .expect("Selected input scope")
                            .leases
                            .insert(LeaseTarget::Drain, request_id.clone());
                    }
                    result = json!({ "action": action, "claimId": request_id, "effectId": request_id,
                        "source": selected_source, "consumeBeforeProviderStream": consume_before_stream });
                    if let Some(selected) = selected {
                        result["inputId"] = json!(selected);
                    }
                    if has_drain {
                        result["drainLeaseId"] = json!(request_id);
                    }
                } else if result.is_null() {
                    result = json!({ "action": action, "consumeBeforeProviderStream": false });
                    if enqueue_wake {
                        result["wakeReason"] = json!("enqueue");
                    }
                }
            }
            Command::PrepareClaimEffect {
                owner,
                claim_id,
                effect_id,
                action,
                ..
            } => {
                let Some(claim) = input
                    .claims
                    .get_mut(&claim_id)
                    .filter(|claim| claim.scope_id == scope_id)
                else {
                    return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
                };
                let projected_operation = scope.projected_operation(&owner);
                let captured_operation = matches!(&owner, StatusOwner::Operation { id }
                    if projected_operation == Some(id.as_str()));
                let owner_matches = (scope.can_project(&owner) || captured_operation)
                    && claim
                        .operation_id
                        .as_deref()
                        .is_none_or(|operation| projected_operation == Some(operation));
                let preparation_cleanup = claim.preparation_only && current;
                let originating_owner = match (&claim.operation_id, &owner) {
                    (Some(operation), StatusOwner::Operation { id }) => operation == id,
                    (Some(_), StatusOwner::Run { id }) => claim.run_id.as_ref() == Some(id),
                    (None, StatusOwner::Orphan) => true,
                    _ => false,
                };
                let allowed = claim.input_id.is_some()
                    && claim.effect.is_none()
                    && claim.disposition.is_none()
                    && claim.outcome != Some(InputEffectOutcome::Unknown)
                    && input.active_claim_id.as_ref() == Some(&claim_id)
                    && match action {
                        ClaimAction::Claim => false,
                        ClaimAction::UserFact => {
                            current
                                && scope.prepared.is_none()
                                && !claim.preparation_only
                                && owner_matches
                                && !claim.user_fact
                                && claim.source != InputSource::Steer
                                && scope.run.is_none()
                                && scope
                                    .operation
                                    .as_ref()
                                    .is_some_and(|operation| !operation.aborted)
                        }
                        ClaimAction::Rollback => {
                            current
                                && scope.prepared.is_none()
                                && !claim.preparation_only
                                && owner_matches
                                && claim.user_fact
                                && claim.source != InputSource::Steer
                                && claim.run_id.as_ref().is_none_or(|run_id| {
                                    scope.run.as_ref().map_or_else(
                                        || scope.cleared_run.as_ref() == Some(run_id),
                                        |run| run.id == *run_id,
                                    )
                                })
                        }
                        ClaimAction::Consume => {
                            !claim.preparation_only && (owner_matches || originating_owner)
                        }
                        ClaimAction::Block => current && (owner_matches || preparation_cleanup),
                        ClaimAction::ReleaseForMutation => {
                            current
                                && (owner_matches || preparation_cleanup)
                                && !claim.user_fact
                                && claim.source != InputSource::Steer
                        }
                        ClaimAction::ReleaseBeforeUserFact => {
                            !claim.user_fact
                                && claim.source != InputSource::Steer
                                && (owner_matches || originating_owner || preparation_cleanup)
                        }
                        ClaimAction::ReleaseAfterRollback => {
                            (owner_matches || originating_owner)
                                && !claim.user_fact
                                && claim.rolled_back
                                && claim.source != InputSource::Steer
                        }
                    };
                if allowed && !effect_id.is_empty() {
                    if claim.operation_id.is_none() && !claim.preparation_only {
                        claim.operation_id = projected_operation.map(str::to_owned);
                    }
                    claim.effect = Some(ClaimEffect {
                        id: effect_id.clone(),
                        action,
                        outcome: None,
                    });
                    result = json!({ "effectId": effect_id, "action": action });
                } else {
                    outcome = "stale";
                }
            }
            Command::AckInputEffect {
                claim_id,
                effect_id,
                outcome: effect_outcome,
                input_id,
                message_id,
                ..
            } => {
                if let Some(claim_id) = claim_id {
                    let Some(claim) = input
                        .claims
                        .get_mut(&claim_id)
                        .filter(|claim| claim.scope_id == scope_id)
                    else {
                        return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
                    };
                    let Some(effect) = claim
                        .effect
                        .as_mut()
                        .filter(|effect| effect.id == effect_id && effect.outcome.is_none())
                    else {
                        return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
                    };
                    let action = effect.action;
                    if effect_outcome == InputEffectOutcome::Applied {
                        if action == ClaimAction::Claim {
                            let selected = input_id
                                .as_ref()
                                .or(claim.input_id.as_ref())
                                .filter(|id| !id.is_empty());
                            if selected.is_none()
                                || (claim.input_id.is_some()
                                    && input_id
                                        .as_ref()
                                        .is_some_and(|id| Some(id) != claim.input_id.as_ref()))
                            {
                                return Err(protocol(
                                    "Input claim acknowledgement changed its selected identity",
                                ));
                            }
                            claim.input_id = selected.cloned();
                            claim.user_fact = claim.source == InputSource::Steer;
                            if input.active_steer_id == claim.input_id
                                && claim.source == InputSource::Steer
                            {
                                input.active_steer_id = None;
                            }
                        } else if action == ClaimAction::UserFact {
                            if message_id.as_ref().is_none_or(String::is_empty) {
                                return Err(protocol(
                                    "User fact acknowledgement has no message identity",
                                ));
                            }
                            claim.user_fact = true;
                            claim.rolled_back = false;
                        } else if action == ClaimAction::Rollback {
                            claim.user_fact = false;
                            claim.rolled_back = true;
                        } else {
                            claim.disposition = Some(action);
                            claim.outcome = Some(effect_outcome);
                            input.active_claim_id = None;
                            if let Some(drain) = input
                                .drain
                                .as_mut()
                                .filter(|drain| drain.claim_id == claim_id)
                            {
                                drain.settled = true;
                            }
                            if action == ClaimAction::Consume {
                                if let Some(id) = &claim.input_id {
                                    input.restart_held_ids.remove(id);
                                    input.manually_resumed_ids.remove(id);
                                }
                            }
                        }
                        claim.effect = None;
                    } else if effect_outcome == InputEffectOutcome::Rejected {
                        claim.effect = None;
                        if action == ClaimAction::Claim {
                            input.active_claim_id = None;
                            if let Some(drain) = input
                                .drain
                                .as_mut()
                                .filter(|drain| drain.claim_id == claim_id)
                            {
                                drain.settled = true;
                            }
                            collect_claim = Some(claim_id.clone());
                        }
                    } else {
                        effect.outcome = Some(InputEffectOutcome::Unknown);
                        claim.outcome = Some(InputEffectOutcome::Unknown);
                        if action.terminal() {
                            claim.disposition = Some(action);
                        }
                    }
                    if claim.disposition.is_some()
                        && claim.outcome == Some(InputEffectOutcome::Applied)
                        && input
                            .drain
                            .as_ref()
                            .is_none_or(|drain| drain.claim_id != claim_id)
                    {
                        collect_claim = Some(claim_id);
                    }
                    result = json!(true);
                } else {
                    let Some(effect) = input.steer_effect.as_mut().filter(|effect| {
                        effect.scope_id == scope_id
                            && effect.id == effect_id
                            && effect.outcome.is_none()
                    }) else {
                        return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
                    };
                    if effect_outcome == InputEffectOutcome::Applied {
                        let Some(id) = input_id.filter(|id| !id.is_empty()) else {
                            return Err(protocol("Steer acknowledgement has no input identity"));
                        };
                        if effect
                            .merge_item_id
                            .as_ref()
                            .is_some_and(|merge| *merge != id)
                        {
                            return Err(protocol(
                                "Steer acknowledgement changed its merge identity",
                            ));
                        }
                        if effect
                            .promotion_id
                            .as_ref()
                            .is_some_and(|promotion| *promotion != id)
                        {
                            return Err(protocol(
                                "Steer acknowledgement changed its promoted identity",
                            ));
                        }
                        input.restart_held_ids.remove(&id);
                        input.manually_resumed_ids.remove(&id);
                        if effect.promotion_id.is_none() {
                            input.active_steer_id = Some(id);
                        }
                        input.interrupted_operation = effect.operation_id.clone();
                        input.steer_effect = None;
                    } else if effect_outcome == InputEffectOutcome::Rejected {
                        input.steer_effect = None;
                    } else {
                        effect.outcome = Some(InputEffectOutcome::Unknown);
                    }
                    result = json!(true);
                }
            }
            Command::InputHold {
                action,
                item_id,
                queue_ids,
                head_id,
                ..
            } if current => match action {
                InputHoldAction::ReleaseItem => {
                    if let Some(id) = item_id {
                        input.restart_held_ids.remove(&id);
                        input.manually_resumed_ids.remove(&id);
                        if input.active_steer_id.as_ref() == Some(&id) {
                            input.active_steer_id = None;
                        }
                        result = json!(true);
                    } else {
                        outcome = "stale";
                    }
                }
                InputHoldAction::Resume => {
                    let queue_ids = queue_ids.unwrap_or_default();
                    if let Some(head) = head_id.filter(|head| {
                        queue_ids.first() == Some(head)
                            && input.restart_held_ids.contains(head)
                            && input.drain.is_none()
                            && input.active_claim_id.is_none()
                            && input.steer_effect.is_none()
                            && scope.input_status_allows(InputWakeReason::Manual)
                            && scope.interactions.is_empty()
                    }) {
                        for id in queue_ids {
                            input.restart_held_ids.remove(&id);
                        }
                        input.manually_resumed_ids.insert(head);
                        result = json!(true);
                    } else {
                        result = json!(false);
                    }
                }
            },
            Command::EndInput { drain_lease_id, .. } => {
                let matches = input
                    .drain
                    .as_ref()
                    .is_some_and(|drain| drain.scope_id == scope_id && drain.id == drain_lease_id);
                let mut next_wake = None;
                if matches {
                    let drain = input.drain.take().expect("Matching input drain");
                    if input
                        .claims
                        .get(&drain.claim_id)
                        .is_some_and(|claim| claim.outcome == Some(InputEffectOutcome::Applied))
                    {
                        input.claims.remove(&drain.claim_id);
                    }
                    if input.active_claim_id.is_none() {
                        next_wake = input.wake_reason.take();
                    }
                    let scope = self
                        .scopes
                        .get_mut(&scope_id)
                        .expect("Originating input scope");
                    if scope.leases.get(&LeaseTarget::Drain) == Some(&drain_lease_id) {
                        scope.leases.remove(&LeaseTarget::Drain);
                    }
                }
                result = json!({ "released": matches, "nextWake": next_wake });
            }
            _ => outcome = "stale",
        }
        let receipt = self.receipt(&scope_id, outcome, result, vec![]);
        if let Some(claim_id) = collect_claim {
            self.inputs
                .get_mut(&session_id)
                .expect("Input Session")
                .claims
                .remove(&claim_id);
        }
        self.collect_scope(&scope_id);
        Ok(receipt)
    }

    fn receipt(&self, scope_id: &str, outcome: &str, result: Value, fences: Vec<Fence>) -> Value {
        let scope = self.scopes.get(scope_id).map(|scope| {
            let mut snapshot = serde_json::to_value(scope).expect("Control scope serialization");
            snapshot["drainLeaseId"] = json!(scope.leases.get(&LeaseTarget::Drain));
            snapshot["permissions"] = json!(scope.permissions.iter().filter(|(_, permission)| !permission.taken)
                .map(|(request_id, permission)| json!({ "requestId": request_id, "id": permission.id })).collect::<Vec<_>>());
            snapshot["deferred"] = json!(scope.leases.iter().filter_map(|(target, id)| match target {
                LeaseTarget::Deferred { tool_call_id, .. } => Some(json!({ "toolCallId": tool_call_id, "id": id })),
                _ => None,
            }).collect::<Vec<_>>());
            snapshot["input"] = self.inputs.get(&scope.session_id).map_or_else(
                || SessionInputs::default().snapshot(),
                SessionInputs::snapshot,
            );
            snapshot
        });
        json!({ "protocol": 1, "revision": self.revision, "outcome": outcome,
            "scope": scope, "result": result, "fences": fences, "grants": [] })
    }

    fn collect_scope(&mut self, scope_id: &str) {
        let empty = self.scopes.get(scope_id).is_some_and(|scope| {
            !scope.current
                && scope.operation.is_none()
                && scope.run.is_none()
                && scope.prepared.is_none()
                && scope.leases.is_empty()
        });
        if empty
            && !self.acceptance.values().any(|lane| {
                lane.active.scope_id == scope_id
                    || lane
                        .pending
                        .iter()
                        .any(|ticket| ticket.scope_id == scope_id)
            })
            && !self.inputs.values().any(|input| {
                input
                    .claims
                    .values()
                    .any(|claim| claim.scope_id == scope_id)
                    || input
                        .steer_effect
                        .as_ref()
                        .is_some_and(|effect| effect.scope_id == scope_id)
                    || input
                        .drain
                        .as_ref()
                        .is_some_and(|drain| drain.scope_id == scope_id)
            })
        {
            self.scopes.remove(scope_id);
        }
    }

    fn acceptance_transition(
        &mut self,
        scope_id: &str,
        lease_id: &str,
        lane: AcceptanceLane,
        release: bool,
    ) -> Result<Value, Error> {
        let Some(scope) = self.scopes.get(scope_id) else {
            return Ok(self.receipt(scope_id, "stale", Value::Null, vec![]));
        };
        let current = scope.current
            && self
                .current
                .get(&scope.session_id)
                .is_some_and(|id| id == scope_id);
        if !release && !current {
            return Ok(self.receipt(scope_id, "stale", Value::Null, vec![]));
        }
        if lease_id.is_empty() {
            return Err(protocol("Acceptance identity is empty"));
        }
        let key = (scope.session_id.clone(), lane);
        let ticket = Ticket {
            scope_id: scope_id.into(),
            lease_id: lease_id.into(),
        };
        let result;
        let mut grants = vec![];
        if !release {
            let count: usize = self
                .acceptance
                .values()
                .map(|lane| 1 + lane.pending.len())
                .sum();
            let bytes: usize = self
                .acceptance
                .iter()
                .map(|((session, _), lane)| {
                    session.len()
                        + lane.active.scope_id.len()
                        + lane.active.lease_id.len()
                        + lane
                            .pending
                            .iter()
                            .map(|ticket| ticket.scope_id.len() + ticket.lease_id.len())
                            .sum::<usize>()
                })
                .sum();
            if count >= 1024 || bytes + scope_id.len() + lease_id.len() + key.0.len() > MAX_METADATA
            {
                return Err(protocol("Acceptance ticket queue exceeded its bound"));
            }
            if let Some(lane) = self.acceptance.get_mut(&key) {
                lane.pending.push_back(ticket);
                result = json!("queued");
            } else {
                self.acceptance.insert(
                    key,
                    Acceptance {
                        active: ticket,
                        pending: VecDeque::new(),
                    },
                );
                result = json!("granted");
            }
        } else if let Some(lane) = self.acceptance.get_mut(&key) {
            if lane.active.scope_id == scope_id && lane.active.lease_id == lease_id {
                if let Some(next) = lane.pending.pop_front() {
                    grants.push(next.clone());
                    lane.active = next;
                } else {
                    self.acceptance.remove(&key);
                }
                result = json!(true);
            } else {
                let before = lane.pending.len();
                lane.pending
                    .retain(|pending| pending.scope_id != scope_id || pending.lease_id != lease_id);
                result = json!(before != lane.pending.len());
            }
        } else {
            result = json!(false);
        }
        let mut receipt = self.receipt(scope_id, "accepted", result, vec![]);
        receipt["grants"] = json!(grants);
        self.collect_scope(scope_id);
        Ok(receipt)
    }

    fn apply(&mut self, command: Command) -> Result<Value, Error> {
        if matches!(
            command,
            Command::InputRecovery { .. }
                | Command::QueryInput { .. }
                | Command::BeginInput { .. }
                | Command::AckInputEffect { .. }
                | Command::PrepareClaimEffect { .. }
                | Command::InputHold { .. }
                | Command::EndInput { .. }
        ) {
            return self.apply_input(command);
        }
        match &command {
            Command::QueueAcceptance {
                scope_id,
                lease_id,
                lane,
            } => return self.acceptance_transition(scope_id, lease_id, *lane, false),
            Command::ReleaseAcceptance {
                scope_id,
                lease_id,
                lane,
            } => return self.acceptance_transition(scope_id, lease_id, *lane, true),
            _ => {}
        }
        if let Command::ClearSession {
            session_id,
            origin_scope_id,
        } = &command
        {
            let latest = self
                .inputs
                .get(session_id)
                .and_then(|input| input.latest_scope_id.as_ref());
            if self.current.contains_key(session_id) || latest != origin_scope_id.as_ref() {
                return Ok(self.receipt("", "stale", json!(false), vec![]));
            }
            self.parked.remove(session_id);
            self.inputs.remove(session_id);
            self.acceptance
                .retain(|(session, _), _| session != session_id);
            let mut origins = vec![];
            for scope in self
                .scopes
                .values_mut()
                .filter(|scope| scope.session_id == *session_id)
            {
                scope.allow_parking = false;
                scope.leases.remove(&LeaseTarget::Drain);
                origins.push(scope.id.clone());
            }
            for origin in origins {
                self.collect_scope(&origin);
            }
            return Ok(self.receipt("", "accepted", json!(true), vec![]));
        }
        if let Command::Open {
            session_id,
            scope_id,
        } = &command
        {
            if session_id.is_empty() || scope_id.is_empty() {
                return Err(protocol("Harness control scope identity is empty"));
            }
            if self
                .current
                .get(session_id)
                .is_some_and(|current| current != scope_id)
                || self
                    .scopes
                    .get(scope_id)
                    .is_some_and(|scope| scope.session_id != *session_id || !scope.current)
            {
                return Ok(self.receipt(scope_id, "stale", Value::Null, vec![]));
            }
            self.scopes
                .entry(scope_id.clone())
                .or_insert_with(|| Scope {
                    id: scope_id.clone(),
                    session_id: session_id.clone(),
                    current: true,
                    status: Status::Idle,
                    operation: None,
                    run: None,
                    first_turn_ready: false,
                    interactions: vec![],
                    batch: None,
                    prepared: None,
                    cleared_operation: None,
                    cleared_run: None,
                    leases: HashMap::new(),
                    allow_parking: true,
                    permissions: HashMap::new(),
                });
            self.current.insert(session_id.clone(), scope_id.clone());
            self.inputs
                .entry(session_id.clone())
                .or_default()
                .latest_scope_id = Some(scope_id.clone());
            return Ok(self.receipt(scope_id, "accepted", Value::Null, vec![]));
        }
        let scope_id = match &command {
            Command::InputRecovery { .. }
            | Command::QueryInput { .. }
            | Command::BeginInput { .. }
            | Command::AckInputEffect { .. }
            | Command::PrepareClaimEffect { .. }
            | Command::InputHold { .. }
            | Command::EndInput { .. }
            | Command::Open { .. }
            | Command::ClearSession { .. }
            | Command::QueueAcceptance { .. }
            | Command::ReleaseAcceptance { .. } => unreachable!(),
            Command::PrepareOperation { scope_id, .. }
            | Command::PrepareRun { scope_id, .. }
            | Command::Commit { scope_id, .. }
            | Command::ClearOperation { scope_id, .. }
            | Command::ClearRun { scope_id, .. }
            | Command::Abort { scope_id }
            | Command::OperationAborted { scope_id, .. }
            | Command::Status { scope_id, .. }
            | Command::UpdateInteractions { scope_id, .. }
            | Command::AdvanceBatch { scope_id, .. }
            | Command::InteractionOrigin { scope_id, .. }
            | Command::CheckInteraction { scope_id, .. }
            | Command::Ready { scope_id, .. }
            | Command::ClearReady { scope_id }
            | Command::AbortDeferred { scope_id }
            | Command::RegisterPermission { scope_id, .. }
            | Command::TakePermission { scope_id, .. }
            | Command::AcquireLease { scope_id, .. }
            | Command::ReleaseLease { scope_id, .. }
            | Command::ParkInteraction { scope_id, .. }
            | Command::Retire { scope_id }
            | Command::Release { scope_id } => scope_id.clone(),
        };
        let Some(scope) = self.scopes.get_mut(&scope_id) else {
            return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
        };
        let current = scope.current && self.current.get(&scope.session_id) == Some(&scope_id);
        let mut result = Value::Null;
        let mut fences = vec![];
        let mut outcome = "accepted";
        match command {
            Command::PrepareOperation { operation_id, .. } if current => {
                if operation_id.is_empty() {
                    return Err(protocol("Operation identity is empty"));
                }
                if let (Some(run), Some(operation)) = (&scope.run, &scope.operation) {
                    if run.operation_id == operation.id && !operation.aborted {
                        result = json!({ "operationId": operation.id, "reused": true });
                        return Ok(self.receipt(&scope_id, outcome, result, fences));
                    }
                }
                if self
                    .inputs
                    .get(&scope.session_id)
                    .is_some_and(|input| input.has_transcript_effect(&scope_id))
                {
                    return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
                }
                scope.revoke_permissions(&mut fences);
                scope.revoke_deferred(None, &mut fences);
                if let Some(operation) = &scope.operation {
                    fences.push(Fence::Operation {
                        id: operation.id.clone(),
                    });
                }
                if let Some(run) = &scope.run {
                    fences.push(Fence::Run { id: run.id.clone() });
                }
                scope.prepared = Some(Prepared::Operation(Operation {
                    id: operation_id.clone(),
                    aborted: false,
                }));
                result = json!({ "transitionId": operation_id, "reused": false });
            }
            Command::PrepareRun {
                operation_id,
                run_id,
                message_id,
                ..
            } if current => {
                if operation_id.is_empty() || run_id.is_empty() || message_id.is_empty() {
                    return Err(protocol("Run identity is empty"));
                }
                if self
                    .inputs
                    .get(&scope.session_id)
                    .is_some_and(|input| input.has_transcript_effect(&scope_id))
                {
                    return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
                }
                if scope.run.as_ref().is_some_and(|run| run.id != run_id) {
                    scope.revoke_permissions(&mut fences);
                    scope.revoke_deferred(None, &mut fences);
                }
                if let Some(operation) = &scope.operation {
                    if operation.id != operation_id {
                        fences.push(Fence::Operation {
                            id: operation.id.clone(),
                        });
                    }
                }
                if let Some(run) = &scope.run {
                    if run.id != run_id {
                        fences.push(Fence::Run { id: run.id.clone() });
                    } else if run.operation_id != operation_id || run.message_id != message_id {
                        return Err(protocol("Registered Run identity cannot change"));
                    }
                }
                let operation = scope
                    .operation
                    .as_ref()
                    .filter(|operation| operation.id == operation_id)
                    .cloned()
                    .unwrap_or(Operation {
                        id: operation_id.clone(),
                        aborted: false,
                    });
                scope.prepared = Some(Prepared::Run(
                    operation,
                    Run {
                        id: run_id.clone(),
                        message_id,
                        operation_id,
                    },
                ));
                result = json!({ "transitionId": run_id });
            }
            Command::Commit {
                transition_id,
                aborted,
                ..
            } if current => {
                if scope
                    .prepared
                    .as_ref()
                    .is_none_or(|prepared| prepared.id() != transition_id)
                {
                    outcome = "stale";
                } else {
                    match scope.prepared.take().unwrap() {
                        Prepared::Operation(mut operation) => {
                            if let Some(input) = self.inputs.get_mut(&scope.session_id) {
                                input.interrupted_operation = None;
                                if let Some(claim) = input
                                    .active_claim_id
                                    .as_ref()
                                    .and_then(|id| input.claims.get_mut(id))
                                {
                                    if claim.scope_id == scope_id
                                        && !claim.preparation_only
                                        && claim.operation_id.is_none()
                                    {
                                        claim.operation_id = Some(operation.id.clone());
                                    }
                                }
                            }
                            operation.aborted |= aborted;
                            scope.run = None;
                            scope.cleared_run = None;
                            scope.cleared_operation = None;
                            result = json!({ "operationId": operation.id });
                            if operation.aborted {
                                outcome = "cancelled";
                            }
                            scope.operation = Some(operation);
                        }
                        Prepared::Run(mut operation, run) => {
                            if let Some(input) = self.inputs.get_mut(&scope.session_id) {
                                if let Some(claim) = input
                                    .active_claim_id
                                    .as_ref()
                                    .and_then(|id| input.claims.get_mut(id))
                                {
                                    if claim.scope_id == scope_id
                                        && !claim.preparation_only
                                        && claim.run_id.is_none()
                                        && claim
                                            .operation_id
                                            .as_ref()
                                            .is_none_or(|id| *id == operation.id)
                                    {
                                        claim.operation_id = Some(operation.id.clone());
                                        claim.run_id = Some(run.id.clone());
                                    }
                                }
                            }
                            operation.aborted |= aborted;
                            result = json!({ "operationId": operation.id, "runId": run.id });
                            if operation.aborted {
                                outcome = "cancelled";
                            }
                            scope.operation = Some(operation);
                            scope.run = Some(run);
                            scope.cleared_run = None;
                            scope.cleared_operation = None;
                        }
                    }
                }
            }
            Command::ClearOperation {
                operation_id,
                run_id,
                ..
            } => {
                let matches = scope
                    .operation
                    .as_ref()
                    .is_some_and(|operation| operation.id == operation_id)
                    && scope.run.is_none()
                    && run_id.is_none();
                let settles = current
                    && scope.prepared.is_none()
                    && (matches
                        || (scope.operation.is_none()
                            && scope.run.is_none()
                            && scope
                                .cleared_operation
                                .as_ref()
                                .is_some_and(|(id, run)| *id == operation_id && *run == run_id)));
                if matches {
                    scope.operation = None;
                    scope.cleared_operation = Some((operation_id, None));
                }
                result = json!({ "cleared": matches, "settles": settles });
            }
            Command::ClearRun { run_id, .. } => {
                let matches = scope.run.as_ref().is_some_and(|run| run.id == run_id);
                if matches {
                    scope.revoke_permissions(&mut fences);
                    scope.revoke_deferred(None, &mut fences);
                    let run = scope.run.take().unwrap();
                    if scope
                        .operation
                        .as_ref()
                        .is_some_and(|operation| operation.id == run.operation_id)
                    {
                        scope.cleared_operation = scope
                            .operation
                            .take()
                            .map(|operation| (operation.id, Some(run.id.clone())));
                    }
                    scope.cleared_run = Some(run.id);
                }
                result = json!(matches);
            }
            Command::Abort { .. } if current => {
                if let Some(input) = self.inputs.get_mut(&scope.session_id) {
                    input.interrupted_operation = None;
                }
                scope.revoke_permissions(&mut fences);
                scope.revoke_deferred(None, &mut fences);
                if let Some(operation) = &mut scope.operation {
                    operation.aborted = true;
                    fences.push(Fence::Operation {
                        id: operation.id.clone(),
                    });
                }
                if scope.run.is_none() {
                    if let Some(operation) = scope.operation.take() {
                        scope.cleared_operation = Some((operation.id, None));
                    }
                }
                if let Some(prepared) = &mut scope.prepared {
                    let operation = match prepared {
                        Prepared::Operation(operation) | Prepared::Run(operation, _) => operation,
                    };
                    operation.aborted = true;
                    fences.push(Fence::Operation {
                        id: operation.id.clone(),
                    });
                }
            }
            Command::OperationAborted { operation_id, .. } => {
                let mut aborted_current = false;
                if let Some(operation) = &mut scope.operation {
                    if operation.id == operation_id {
                        operation.aborted = true;
                        aborted_current = true;
                    }
                }
                if aborted_current {
                    scope.revoke_permissions(&mut fences);
                    scope.revoke_deferred(None, &mut fences);
                }
                if let Some(prepared) = &mut scope.prepared {
                    let operation = match prepared {
                        Prepared::Operation(operation) | Prepared::Run(operation, _) => operation,
                    };
                    if operation.id == operation_id {
                        operation.aborted = true;
                    }
                }
            }
            Command::Status {
                owner,
                status,
                interactions,
                ..
            } if current => {
                if scope.can_project(&owner) {
                    if let Some(update) = interactions {
                        scope.update_interactions(update)?;
                    }
                    scope.status = status;
                    result = json!(true);
                } else {
                    outcome = "stale";
                    result = json!(false);
                }
            }
            Command::UpdateInteractions { owner, update, .. } if current => {
                if scope.can_project(&owner) {
                    scope.update_interactions(update)?;
                    result = json!(true);
                } else {
                    outcome = "stale";
                    result = json!(false);
                }
            }
            Command::AdvanceBatch {
                owner,
                invoked_call_id,
                committed_result_call_id,
                ..
            } if current => {
                if scope.can_project(&owner) {
                    if let Some(mut batch) = scope.batch.clone() {
                        for (id, selected) in [
                            (invoked_call_id, &mut batch.invoked_call_ids),
                            (
                                committed_result_call_id,
                                &mut batch.committed_result_call_ids,
                            ),
                        ] {
                            if let Some(id) = id {
                                if id.is_empty() {
                                    return Err(protocol("Tool batch advance identity is empty"));
                                }
                                if !selected.contains(&id) {
                                    selected.push(id);
                                }
                            }
                        }
                        if serde_json::to_vec(&(&scope.interactions, &batch))
                            .map_err(protocol)?
                            .len()
                            > MAX_METADATA
                        {
                            return Err(protocol(
                                "Pending interaction metadata exceeds the runtime bound",
                            ));
                        }
                        scope.batch = Some(batch);
                        result = json!(true);
                    } else {
                        result = json!(false);
                    }
                } else {
                    outcome = "stale";
                    result = json!(false);
                }
            }
            Command::InteractionOrigin {
                owner,
                message_id,
                tool_call_id,
                origin,
                ..
            } if current => {
                if scope.can_project(&owner) {
                    let interaction = scope.interactions.iter_mut().find(|interaction| {
                        interaction.message_id == message_id
                            && interaction.tool_call_id == tool_call_id
                    });
                    if let Some(interaction) = interaction {
                        interaction.origin = origin;
                        if let Some(batch) = &mut scope.batch {
                            batch.pending_interaction_call_ids = scope
                                .interactions
                                .iter()
                                .filter(|interaction| {
                                    interaction.origin != InteractionOrigin::AcpPermission
                                })
                                .map(|interaction| interaction.tool_call_id.clone())
                                .collect();
                            if batch.pending_interaction_call_ids.is_empty() {
                                scope.batch = None;
                            }
                        }
                        result = json!(true);
                    } else {
                        result = json!(false);
                    }
                } else {
                    outcome = "stale";
                    result = json!(false);
                }
            }
            Command::CheckInteraction {
                owner,
                message_id,
                tool_call_id,
                lease_id,
                ..
            } if current => {
                let allowed = scope.can_project(&owner)
                    && scope.is_first_interaction(&message_id, &tool_call_id)
                    && scope.leases.get(&LeaseTarget::Interaction {
                        message_id,
                        tool_call_id,
                    }) == Some(&lease_id);
                result = json!(allowed);
                if !allowed {
                    outcome = "stale";
                }
            }
            Command::Ready { run_id, .. } if current => {
                let allowed = scope.prepared.is_none()
                    && scope.run.as_ref().is_some_and(|run| run.id == run_id)
                    && scope
                        .operation
                        .as_ref()
                        .is_some_and(|operation| !operation.aborted);
                if allowed {
                    scope.first_turn_ready = true;
                }
                result = json!(allowed);
            }
            Command::ClearReady { .. } if current => scope.first_turn_ready = false,
            Command::AbortDeferred { .. } => scope.revoke_deferred(None, &mut fences),
            Command::RegisterPermission {
                permission_id,
                request_id,
                message_id,
                tool_call_id,
                run_id,
                ..
            } if current => {
                if permission_id.is_empty() || request_id.is_empty() {
                    return Err(protocol("Permission identity is empty"));
                }
                let allowed =
                    scope.can_start(&StatusOwner::Run { id: run_id.clone() }, &message_id);
                if allowed {
                    if let Some(previous) = scope.permissions.insert(
                        request_id,
                        Permission {
                            id: permission_id,
                            message_id,
                            tool_call_id,
                            run_id: Some(run_id),
                            taken: false,
                        },
                    ) {
                        if !previous.taken {
                            fences.push(Fence::Permission { id: previous.id });
                        }
                    }
                }
                result = json!(allowed);
            }
            Command::TakePermission {
                permission_id,
                request_id,
                message_id,
                tool_call_id,
                run_id,
                lease_id,
                granted,
                resolution_id,
                ..
            } if current => {
                let lease = LeaseTarget::Interaction {
                    message_id: message_id.clone(),
                    tool_call_id: tool_call_id.clone(),
                };
                let run_current = run_id.as_ref().is_some_and(|run_id| {
                    scope.can_start(&StatusOwner::Run { id: run_id.clone() }, &message_id)
                });
                if scope.prepared.is_some()
                    || scope.leases.get(&lease) != Some(&lease_id)
                    || (run_id.is_some() && !run_current)
                    || (granted
                        && (!run_current
                            || !scope.is_first_interaction(&message_id, &tool_call_id)))
                {
                    outcome = "stale";
                } else if let Some(permission) = scope.permissions.get_mut(&request_id) {
                    if permission.message_id != message_id
                        || permission.tool_call_id != tool_call_id
                    {
                        result = json!("conflict");
                    } else if permission.taken {
                        result = json!("spent");
                    } else if permission_id.as_ref() != Some(&permission.id)
                        || (run_id.is_some() && run_id != permission.run_id)
                    {
                        result = json!("conflict");
                    } else {
                        permission.taken = true;
                        result = json!("callback");
                    }
                } else if permission_id.is_some() {
                    result = json!("spent");
                } else {
                    if request_id.is_empty() || resolution_id.is_empty() {
                        return Err(protocol("Permission resolution identity is empty"));
                    }
                    scope.permissions.insert(
                        request_id,
                        Permission {
                            id: resolution_id,
                            message_id,
                            tool_call_id,
                            run_id,
                            taken: true,
                        },
                    );
                    result = json!("direct");
                }
            }
            Command::AcquireLease {
                lease_id, target, ..
            } if current => {
                if matches!(target, LeaseTarget::Drain) {
                    return Err(protocol("Input drains require input selection"));
                }
                let valid_target = match &target {
                    LeaseTarget::Interaction {
                        message_id,
                        tool_call_id,
                    } => !message_id.is_empty() && !tool_call_id.is_empty(),
                    LeaseTarget::Resume { message_id } => !message_id.is_empty(),
                    LeaseTarget::Deferred {
                        message_id,
                        tool_call_id,
                        parent_lease_id,
                        owner,
                    } => {
                        !message_id.is_empty()
                            && !tool_call_id.is_empty()
                            && scope.can_start(owner, message_id)
                            && scope.is_first_interaction(message_id, tool_call_id)
                            && scope.leases.get(&LeaseTarget::Interaction {
                                message_id: message_id.clone(),
                                tool_call_id: tool_call_id.clone(),
                            }) == Some(parent_lease_id)
                    }
                    LeaseTarget::Drain => unreachable!(),
                };
                if lease_id.is_empty() || !valid_target {
                    if matches!(target, LeaseTarget::Deferred { .. }) {
                        return Ok(self.receipt(&scope_id, "stale", Value::Null, vec![]));
                    }
                    return Err(protocol("Control lease identity is empty"));
                }
                let parked = match &target {
                    LeaseTarget::Interaction { message_id, .. } => self
                        .parked
                        .get(&scope.session_id)
                        .is_some_and(|messages| messages.contains(message_id)),
                    _ => false,
                };
                if parked {
                    result = json!("parked");
                } else if let std::collections::hash_map::Entry::Vacant(entry) =
                    scope.leases.entry(target)
                {
                    entry.insert(lease_id);
                    result = json!("granted");
                } else {
                    result = json!("busy");
                }
            }
            Command::ReleaseLease {
                lease_id, target, ..
            } => {
                if matches!(target, LeaseTarget::Drain) {
                    return Err(protocol("Input drains require originating input cleanup"));
                }
                let matches = scope.leases.get(&target) == Some(&lease_id);
                if matches {
                    scope.leases.remove(&target);
                    if matches!(target, LeaseTarget::Interaction { .. }) {
                        scope.revoke_deferred(Some(&lease_id), &mut fences);
                    }
                }
                result = json!(matches);
            }
            Command::ParkInteraction {
                lease_id,
                message_id,
                tool_call_id,
                ..
            } => {
                let target = LeaseTarget::Interaction {
                    message_id: message_id.clone(),
                    tool_call_id,
                };
                let matches = scope.allow_parking && scope.leases.get(&target) == Some(&lease_id);
                if matches {
                    self.parked
                        .entry(scope.session_id.clone())
                        .or_default()
                        .insert(message_id);
                }
                result = json!(matches);
            }
            Command::Retire { .. } | Command::Release { .. } => {
                scope.revoke_permissions(&mut fences);
                scope.revoke_deferred(None, &mut fences);
                scope.interactions.clear();
                scope.batch = None;
                scope.current = false;
                if self.current.get(&scope.session_id) == Some(&scope_id) {
                    self.current.remove(&scope.session_id);
                }
                fences.push(Fence::Scope {
                    id: scope_id.clone(),
                });
                scope.prepared = None;
                for lane in self.acceptance.values_mut() {
                    lane.pending.retain(|ticket| ticket.scope_id != scope_id);
                }
                if scope.run.is_none() {
                    scope.cleared_operation =
                        scope.operation.take().map(|operation| (operation.id, None));
                }
            }
            _ => outcome = "stale",
        }
        let receipt = self.receipt(&scope_id, outcome, result, fences);
        self.collect_scope(&scope_id);
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Actor {
        control: Control,
        sequence: u64,
    }
    impl Actor {
        fn send(&mut self, command: Value) -> Value {
            self.sequence += 1;
            self.control.dispatch(self.sequence, command).unwrap()
        }
        fn open(&mut self, scope: &str) -> Value {
            self.send(json!({ "method": "open", "sessionId": "session", "scopeId": scope }))
        }
        fn operation(&mut self, scope: &str, operation: &str) {
            self.send(
                json!({ "method": "prepareOperation", "scopeId": scope, "operationId": operation }),
            );
            self.send(json!({ "method": "commit", "scopeId": scope, "transitionId": operation, "aborted": false }));
        }
        fn run(&mut self, scope: &str, operation: &str, run: &str) -> Value {
            self.send(json!({ "method": "prepareRun", "scopeId": scope, "operationId": operation, "runId": run, "messageId": format!("message-{run}") }));
            self.send(json!({ "method": "commit", "scopeId": scope, "transitionId": run, "aborted": false }))
        }
        fn input_snapshot(queue: &[&str], steer: Option<&str>) -> Value {
            json!({
                "queue": queue.iter().map(|id| json!({ "id": id, "state": "pending" })).collect::<Vec<_>>(),
                "steerHead": steer.map(|id| json!({ "id": id, "state": "pending" })),
                "hasClaimed": false, "hasBlocking": false, "awaitingFollowUp": false
            })
        }
        fn begin_input(
            &mut self,
            scope: &str,
            request: &str,
            intent: &str,
            source: &str,
            snapshot: &Value,
        ) -> Value {
            self.send(
                json!({ "method": "beginInput", "scopeId": scope, "requestId": request,
                "intent": intent, "source": source, "snapshot": snapshot }),
            )
        }
        fn input_effect(
            &mut self,
            scope: &str,
            claim: &str,
            effect: &str,
            action: &str,
            owner: Value,
        ) -> Value {
            self.send(
                json!({ "method": "prepareClaimEffect", "scopeId": scope, "claimId": claim,
                "effectId": effect, "action": action, "owner": owner }),
            )
        }
        fn input_ack(
            &mut self,
            scope: &str,
            claim: &str,
            effect: &str,
            outcome: &str,
            input: Option<&str>,
            message: Option<&str>,
        ) -> Value {
            let mut command = json!({ "method": "ackInputEffect", "scopeId": scope, "claimId": claim,
                "effectId": effect, "outcome": outcome });
            if let Some(input) = input {
                command["inputId"] = json!(input);
            }
            if let Some(message) = message {
                command["messageId"] = json!(message);
            }
            self.send(command)
        }
    }

    #[test]
    fn input_claims_serialize_selection_and_fence_unknown_or_replaced_origins() {
        let mut actor = Actor::default();
        actor.open("old");
        let snapshot = Actor::input_snapshot(&[], None);
        assert_eq!(
            actor.begin_input("old", "before-ready", "enqueue", "send", &snapshot)["outcome"],
            "stale"
        );
        actor.send(json!({ "method": "inputRecovery", "sessions": [] }));
        let selected = actor.begin_input("old", "send", "enqueue", "send", &snapshot);
        assert_eq!(selected["result"]["action"], "claim");
        assert_eq!(selected["result"]["drainLeaseId"], "send");
        let held = actor.control.0.lock().unwrap().inputs["session"].snapshot();
        let blocked_recovery = actor.send(json!({ "method": "inputRecovery", "sessions": [{ "sessionId": "session", "heldInputIds": ["replacement-hold"] }] }));
        assert_eq!(blocked_recovery["outcome"], "stale");
        assert_eq!(blocked_recovery["result"], false);
        assert_eq!(
            actor.control.0.lock().unwrap().inputs["session"].snapshot(),
            held
        );
        for method in ["acquireLease", "releaseLease"] {
            actor.sequence += 1;
            assert!(actor.control.dispatch(actor.sequence, json!({ "method": method, "scopeId": "old", "leaseId": "send", "target": { "kind": "drain" } })).is_err());
        }
        assert_eq!(
            actor.send(json!({ "method": "clearReady", "scopeId": "old" }))["scope"]
                ["drainLeaseId"],
            "send"
        );
        assert_eq!(
            actor.begin_input("old", "steer", "steer", "steer", &snapshot)["result"]["action"],
            "blocked"
        );
        assert_eq!(
            actor.begin_input("old", "queue", "enqueue", "queue", &snapshot)["result"]["action"],
            "pending"
        );
        assert_eq!(
            actor.begin_input(
                "old",
                "drain",
                "drain",
                "queue",
                &Actor::input_snapshot(&[], Some("steer"))
            )["result"]["action"],
            "busy"
        );
        actor.input_ack("old", "send", "send", "applied", Some("first-input"), None);
        assert_eq!(actor.send(json!({ "method": "beginInput", "scopeId": "old", "requestId": "turn-promotion",
            "intent": "steer", "source": "steer", "itemId": "first-input", "snapshot": Actor::input_snapshot(&["first-input"], None) }))["result"]["action"], "blocked");
        actor.operation("old", "operation");
        let owner = json!({ "kind": "operation", "id": "operation" });
        let wrong_owner = json!({ "kind": "operation", "id": "wrong" });
        assert_eq!(
            actor.input_effect("old", "send", "wrong", "user-fact", wrong_owner)["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect("old", "send", "fact", "user-fact", owner.clone())["result"]
                ["effectId"],
            "fact"
        );
        assert_eq!(
            actor.input_effect("old", "send", "overlap", "consume", owner.clone())["outcome"],
            "stale"
        );
        let blocked_run = actor.send(json!({ "method": "prepareRun", "scopeId": "old", "operationId": "operation", "runId": "too-early", "messageId": "too-early" }));
        assert_eq!(blocked_run["outcome"], "stale");
        assert_eq!(blocked_run["fences"], json!([]));
        assert_eq!(actor.send(json!({ "method": "prepareOperation", "scopeId": "old", "operationId": "too-early" }))["outcome"], "stale");
        actor.input_ack("old", "send", "fact", "applied", None, Some("user-message"));
        actor.run("old", "operation", "first-run");
        assert_eq!(
            actor.input_effect("old", "send", "rollback-current", "rollback", owner.clone())
                ["outcome"],
            "accepted"
        );
        assert_eq!(actor.send(json!({ "method": "prepareRun", "scopeId": "old", "operationId": "other-operation", "runId": "before-rollback", "messageId": "before-rollback" }))["outcome"], "stale");
        actor.input_ack("old", "send", "rollback-current", "rejected", None, None);
        actor.run("old", "operation", "second-run");
        assert_eq!(
            actor.input_effect(
                "old",
                "send",
                "rollback-replaced",
                "rollback",
                owner.clone()
            )["outcome"],
            "stale"
        );
        actor.send(json!({ "method": "abort", "scopeId": "old" }));
        actor.operation("old", "superseding-operation");
        assert_eq!(
            actor.input_effect(
                "old",
                "send",
                "wrong-cleanup",
                "consume",
                json!({ "kind": "operation", "id": "superseding-operation" })
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect(
                "old",
                "send",
                "superseded-rollback",
                "rollback",
                owner.clone()
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect("old", "send", "consume-active", "consume", owner.clone())
                ["outcome"],
            "accepted"
        );
        actor.input_ack("old", "send", "consume-active", "rejected", None, None);
        actor.send(json!({ "method": "retire", "scopeId": "old" }));
        actor.open("new");
        assert_eq!(
            actor.begin_input("new", "replacement", "enqueue", "send", &snapshot)["result"]
                ["action"],
            "pending"
        );
        assert_eq!(
            actor.input_effect("old", "send", "rollback", "rollback", owner.clone())["outcome"],
            "stale"
        );
        actor.input_effect("old", "send", "consume", "consume", owner);
        assert_eq!(
            actor.input_ack("new", "send", "consume", "applied", None, None)["outcome"],
            "stale"
        );
        let settled = actor.input_ack("old", "send", "consume", "applied", None, None);
        assert_eq!(settled["scope"]["input"]["activeClaimId"], Value::Null);
        assert_eq!(
            settled["scope"]["input"]["claims"][0]["disposition"],
            "consume"
        );
        actor.send(json!({ "method": "clearRun", "scopeId": "old", "runId": "second-run" }));
        assert_eq!(
            actor.send(json!({ "method": "endInput", "scopeId": "new", "drainLeaseId": "send" }))
                ["result"]["released"],
            false
        );
        assert_eq!(
            actor.send(json!({ "method": "endInput", "scopeId": "old", "drainLeaseId": "send" }))
                ["result"]["released"],
            true
        );
        assert!(!actor.control.0.lock().unwrap().scopes.contains_key("old"));

        actor.begin_input("new", "unknown", "enqueue", "send", &snapshot);
        actor.input_ack(
            "new",
            "unknown",
            "unknown",
            "applied",
            Some("second-input"),
            None,
        );
        actor.operation("new", "new-operation");
        actor.input_effect(
            "new",
            "unknown",
            "uncertain-fact",
            "user-fact",
            json!({ "kind": "operation", "id": "new-operation" }),
        );
        let unknown = actor.input_ack("new", "unknown", "uncertain-fact", "unknown", None, None);
        assert_eq!(unknown["scope"]["input"]["activeClaimId"], "unknown");
        assert_eq!(unknown["scope"]["input"]["claims"][0]["outcome"], "unknown");
        actor.send(json!({ "method": "endInput", "scopeId": "new", "drainLeaseId": "unknown" }));
        assert_eq!(
            actor.begin_input("new", "after-unknown", "enqueue", "send", &snapshot)["result"]
                ["action"],
            "pending"
        );
        assert_eq!(
            actor.input_effect(
                "new",
                "unknown",
                "release",
                "release-before-user-fact",
                json!({ "kind": "operation", "id": "new-operation" })
            )["outcome"],
            "stale"
        );
        let unknown_state = actor.control.0.lock().unwrap().inputs["session"].snapshot();
        assert_eq!(
            actor.send(json!({ "method": "inputRecovery", "sessions": [] }))["outcome"],
            "stale"
        );
        assert_eq!(
            actor.control.0.lock().unwrap().inputs["session"].snapshot(),
            unknown_state
        );
        actor.send(json!({ "method": "retire", "scopeId": "new" }));
        assert_eq!(
            actor.send(json!({ "method": "inputRecovery", "sessions": [] }))["result"],
            true
        );
        actor.open("recovered");
        actor.operation("recovered", "new-operation");
        assert_eq!(
            actor.input_ack(
                "new",
                "unknown",
                "uncertain-fact",
                "applied",
                None,
                Some("late")
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.begin_input("recovered", "visible", "steer", "steer", &snapshot)["result"]
                ["action"],
            "steer"
        );
        assert_eq!(
            actor.begin_input(
                "recovered",
                "send-behind-steer",
                "enqueue",
                "send",
                &snapshot
            )["result"]["action"],
            "pending"
        );
        assert_eq!(
            actor.send(json!({ "method": "inputRecovery", "sessions": [] }))["outcome"],
            "stale"
        );
        actor.send(json!({ "method": "ackInputEffect", "scopeId": "recovered", "effectId": "visible", "outcome": "applied", "inputId": "open-steer" }));
        actor.send(json!({ "method": "operationAborted", "scopeId": "recovered", "operationId": "new-operation" }));
        let steer_snapshot = Actor::input_snapshot(&["promoted"], Some("open-steer"));
        let merged = actor.begin_input("recovered", "merge", "steer", "steer", &steer_snapshot);
        assert_eq!(merged["result"]["mergeItemId"], "open-steer");
        actor.send(json!({ "method": "ackInputEffect", "scopeId": "recovered", "effectId": "merge", "outcome": "rejected" }));
        let promotion = actor.send(json!({ "method": "beginInput", "scopeId": "recovered", "requestId": "promotion", "intent": "steer", "source": "steer", "itemId": "promoted", "snapshot": steer_snapshot }));
        assert_eq!(promotion["result"]["action"], "steer");
        assert_eq!(promotion["result"]["mergeItemId"], Value::Null);
        let promoted = actor.send(json!({ "method": "ackInputEffect", "scopeId": "recovered", "effectId": "promotion", "outcome": "applied", "inputId": "promoted" }));
        assert_eq!(promoted["scope"]["input"]["activeSteerId"], "open-steer");

        actor.send(
            json!({ "method": "open", "sessionId": "wake-session", "scopeId": "wake-scope" }),
        );
        let waiting = Actor::input_snapshot(&["waiting"], None);
        let status = |status: &str| json!({ "method": "status", "scopeId": "wake-scope", "owner": { "kind": "orphan" }, "status": status });
        actor.send(status("generating"));
        let old_enqueue =
            actor.begin_input("wake-scope", "old-enqueue", "enqueue", "queue", &waiting);
        assert_eq!(old_enqueue["result"]["action"], "pending");
        assert!(old_enqueue["result"].get("wakeReason").is_none());
        actor.send(status("error"));
        assert_eq!(
            actor.send(
                json!({ "method": "beginInput", "scopeId": "wake-scope", "requestId": "completed",
            "intent": "drain", "source": "queue", "reason": "completed", "snapshot": waiting })
            )["result"]["action"],
            "blocked"
        );
        let fresh_enqueue =
            actor.begin_input("wake-scope", "fresh-enqueue", "enqueue", "queue", &waiting);
        assert_eq!(fresh_enqueue["result"]["wakeReason"], "enqueue");
        let mut blocked = waiting.clone();
        blocked["hasBlocking"] = json!(true);
        assert!(actor.begin_input(
            "wake-scope",
            "blocked-enqueue",
            "enqueue",
            "queue",
            &blocked
        )["result"]
            .get("wakeReason")
            .is_none());
        let mut follow_up = waiting.clone();
        follow_up["awaitingFollowUp"] = json!(true);
        assert!(actor.begin_input(
            "wake-scope",
            "followup-enqueue",
            "enqueue",
            "queue",
            &follow_up
        )["result"]
            .get("wakeReason")
            .is_none());
        actor.begin_input("wake-scope", "wake-drain", "drain", "queue", &waiting);
        actor.input_ack(
            "wake-scope",
            "wake-drain",
            "wake-drain",
            "applied",
            Some("waiting"),
            None,
        );
        assert!(actor.begin_input(
            "wake-scope",
            "unsettled-enqueue",
            "enqueue",
            "queue",
            &waiting
        )["result"]
            .get("wakeReason")
            .is_none());
        actor.input_effect(
            "wake-scope",
            "wake-drain",
            "wake-consume",
            "consume",
            json!({ "kind": "orphan" }),
        );
        actor.input_ack(
            "wake-scope",
            "wake-drain",
            "wake-consume",
            "applied",
            None,
            None,
        );
        let settled = actor.begin_input(
            "wake-scope",
            "settled-enqueue",
            "enqueue",
            "queue",
            &waiting,
        );
        assert_eq!(settled["result"]["wakeReason"], "enqueue");
        assert_eq!(
            actor.send(json!({ "method": "inputRecovery", "sessions": [] }))["outcome"],
            "stale"
        );
        actor.send(
            json!({ "method": "endInput", "scopeId": "wake-scope", "drainLeaseId": "wake-drain" }),
        );

        actor.send(json!({ "method": "open", "sessionId": "rollback-session", "scopeId": "rollback-origin" }));
        actor.begin_input(
            "rollback-origin",
            "rollback-claim",
            "enqueue",
            "queue",
            &snapshot,
        );
        actor.input_ack(
            "rollback-origin",
            "rollback-claim",
            "rollback-claim",
            "applied",
            Some("rollback-input"),
            None,
        );
        actor.operation("rollback-origin", "rollback-operation");
        let original_owner = json!({ "kind": "operation", "id": "rollback-operation" });
        actor.input_effect(
            "rollback-origin",
            "rollback-claim",
            "rollback-fact",
            "user-fact",
            original_owner.clone(),
        );
        actor.input_ack(
            "rollback-origin",
            "rollback-claim",
            "rollback-fact",
            "applied",
            None,
            Some("rollback-message"),
        );
        actor.input_effect(
            "rollback-origin",
            "rollback-claim",
            "applied-rollback",
            "rollback",
            original_owner.clone(),
        );
        actor.input_ack(
            "rollback-origin",
            "rollback-claim",
            "applied-rollback",
            "applied",
            None,
            None,
        );
        actor.send(json!({ "method": "retire", "scopeId": "rollback-origin" }));
        actor.send(json!({ "method": "open", "sessionId": "rollback-session", "scopeId": "rollback-replacement" }));
        actor.operation("rollback-replacement", "replacement-operation");
        let replacement_owner = json!({ "kind": "operation", "id": "replacement-operation" });
        assert_eq!(
            actor.input_effect(
                "rollback-origin",
                "rollback-claim",
                "wrong-release",
                "release-after-rollback",
                replacement_owner
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect(
                "rollback-origin",
                "rollback-claim",
                "late-fact",
                "user-fact",
                original_owner.clone()
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect(
                "rollback-origin",
                "rollback-claim",
                "second-rollback",
                "rollback",
                original_owner.clone()
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect(
                "rollback-origin",
                "rollback-claim",
                "origin-release",
                "release-after-rollback",
                original_owner
            )["outcome"],
            "accepted"
        );
        actor.input_ack(
            "rollback-origin",
            "rollback-claim",
            "origin-release",
            "applied",
            None,
            None,
        );
        actor.send(json!({ "method": "endInput", "scopeId": "rollback-origin", "drainLeaseId": "rollback-claim" }));
        assert_eq!(
            actor.begin_input(
                "rollback-replacement",
                "after-rollback",
                "enqueue",
                "queue",
                &snapshot
            )["result"]["action"],
            "claim"
        );
        actor.input_ack(
            "rollback-replacement",
            "after-rollback",
            "after-rollback",
            "rejected",
            None,
            None,
        );
        actor.send(json!({ "method": "endInput", "scopeId": "rollback-replacement", "drainLeaseId": "after-rollback" }));
    }

    #[test]
    fn input_recovery_manual_tickets_and_wake_priority_preserve_once_only_effects() {
        let mut actor = Actor::default();
        actor.send(json!({ "method": "inputRecovery", "sessions": [{ "sessionId": "session", "heldInputIds": ["first", "second"] }] }));
        actor.open("scope");
        let snapshot = Actor::input_snapshot(&["first", "second"], None);
        let query = |snapshot: &Value| json!({ "method": "queryInput", "scopeId": "scope", "snapshot": snapshot });
        assert_eq!(
            actor.send(query(&snapshot))["result"],
            json!({ "canDrain": true, "hasRestartHeld": true, "onlyRestartHeld": true })
        );
        assert_eq!(
            actor.begin_input("scope", "held", "drain", "queue", &snapshot)["result"]["action"],
            "blocked"
        );
        let bypass = actor.begin_input("scope", "send", "enqueue", "send", &snapshot);
        assert_eq!(bypass["result"]["action"], "claim");
        actor.input_ack("scope", "send", "send", "rejected", None, None);
        actor.send(json!({ "method": "endInput", "scopeId": "scope", "drainLeaseId": "send" }));
        let mut blocked_snapshot = Actor::input_snapshot(&["blocked"], None);
        blocked_snapshot["queue"][0]["state"] = json!("blocked");
        blocked_snapshot["hasBlocking"] = json!(true);
        assert_eq!(
            actor.send(query(&blocked_snapshot))["result"]["canDrain"],
            true
        );
        assert_eq!(
            actor.begin_input(
                "scope",
                "visible-blocked",
                "steer",
                "steer",
                &blocked_snapshot
            )["result"]["action"],
            "steer"
        );
        actor.send(json!({ "method": "ackInputEffect", "scopeId": "scope", "effectId": "visible-blocked", "outcome": "applied", "inputId": "visible-pending" }));
        assert_eq!(
            actor.begin_input(
                "scope",
                "blocked-drain",
                "drain",
                "queue",
                &blocked_snapshot
            )["result"]["action"],
            "blocked"
        );
        assert_eq!(actor.send(json!({ "method": "inputHold", "scopeId": "scope", "action": "resume", "queueIds": ["first", "second"], "headId": "first" }))["result"], true);
        let steer_first = actor.begin_input(
            "scope",
            "steer",
            "drain",
            "queue",
            &Actor::input_snapshot(&["first", "second"], Some("steer-input")),
        );
        assert_eq!(steer_first["result"]["inputId"], "steer-input");
        assert_eq!(steer_first["result"]["source"], "steer");
        actor.input_ack(
            "scope",
            "steer",
            "steer",
            "applied",
            Some("steer-input"),
            None,
        );
        actor.input_effect(
            "scope",
            "steer",
            "steer-consume",
            "consume",
            json!({ "kind": "orphan" }),
        );
        actor.input_ack("scope", "steer", "steer-consume", "applied", None, None);
        actor.send(json!({ "method": "endInput", "scopeId": "scope", "drainLeaseId": "steer" }));

        let manual = actor.begin_input("scope", "manual", "drain", "queue", &snapshot);
        assert_eq!(manual["result"]["consumeBeforeProviderStream"], true);
        actor.input_ack("scope", "manual", "manual", "applied", Some("first"), None);
        actor.operation("scope", "operation");
        let owner = json!({ "kind": "operation", "id": "operation" });
        actor.input_effect("scope", "manual", "fact", "user-fact", owner.clone());
        actor.input_ack(
            "scope",
            "manual",
            "fact",
            "applied",
            None,
            Some("user-message"),
        );
        let ticket = actor.input_effect("scope", "manual", "pre-consume", "consume", owner.clone());
        assert_eq!(
            ticket["scope"]["input"]["claims"][0]["disposition"],
            Value::Null
        );
        assert_eq!(
            actor.run("scope", "operation", "manual-run")["outcome"],
            "accepted"
        );
        assert_eq!(
            actor.input_effect("scope", "manual", "overlap", "rollback", owner.clone())["outcome"],
            "stale"
        );
        actor.input_ack("scope", "manual", "pre-consume", "rejected", None, None);
        actor.input_effect("scope", "manual", "rollback", "rollback", owner.clone());
        actor.input_ack("scope", "manual", "rollback", "applied", None, None);
        actor.input_effect(
            "scope",
            "manual",
            "release",
            "release-after-rollback",
            owner.clone(),
        );
        actor.input_ack("scope", "manual", "release", "applied", None, None);
        actor.send(json!({ "method": "clearRun", "scopeId": "scope", "runId": "manual-run" }));
        for reason in ["completed", "manual", "enqueue"] {
            actor.send(
                json!({ "method": "beginInput", "scopeId": "scope", "requestId": reason,
                "intent": "drain", "source": "queue", "reason": reason, "snapshot": snapshot }),
            );
        }
        assert_eq!(
            actor.send(
                json!({ "method": "endInput", "scopeId": "scope", "drainLeaseId": "manual" })
            )["result"]["nextWake"],
            "manual"
        );
        let resumed = actor.begin_input("scope", "resumed", "drain", "queue", &snapshot);
        assert_eq!(resumed["result"]["consumeBeforeProviderStream"], true);
        actor.input_ack(
            "scope",
            "resumed",
            "resumed",
            "applied",
            Some("first"),
            None,
        );
        actor.operation("scope", "resumed-operation");
        let owner = json!({ "kind": "operation", "id": "resumed-operation" });
        actor.input_effect(
            "scope",
            "resumed",
            "resumed-fact",
            "user-fact",
            owner.clone(),
        );
        actor.input_ack(
            "scope",
            "resumed",
            "resumed-fact",
            "applied",
            None,
            Some("new-message"),
        );
        actor.input_effect("scope", "resumed", "consumed", "consume", owner.clone());
        let consumed = actor.input_ack("scope", "resumed", "consumed", "applied", None, None);
        assert_eq!(consumed["scope"]["input"]["manuallyResumedIds"], json!([]));
        let preparation = actor.send(
            json!({ "method": "beginInput", "scopeId": "scope", "requestId": "prepare",
            "intent": "prepare", "source": "queue", "itemId": "second", "snapshot": snapshot }),
        );
        assert_eq!(preparation["result"]["action"], "prepare");
        actor.input_ack(
            "scope",
            "prepare",
            "prepare",
            "applied",
            Some("second"),
            None,
        );
        assert_eq!(
            actor.input_effect("scope", "prepare", "no-fact", "user-fact", owner)["outcome"],
            "stale"
        );
        actor.input_effect(
            "scope",
            "prepare",
            "block",
            "block",
            json!({ "kind": "orphan" }),
        );
        actor.input_ack("scope", "prepare", "block", "applied", None, None);
        assert_eq!(
            actor.input_effect(
                "scope",
                "prepare",
                "again",
                "release-for-mutation",
                json!({ "kind": "orphan" })
            )["outcome"],
            "stale"
        );
        actor.send(json!({ "method": "endInput", "scopeId": "scope", "drainLeaseId": "resumed" }));
        let promotion_snapshot = Actor::input_snapshot(&["promotion-row", "other-row"], None);
        actor.send(json!({ "method": "beginInput", "scopeId": "scope", "requestId": "promotion-preparation", "intent": "prepare",
            "source": "queue", "itemId": "promotion-row", "snapshot": promotion_snapshot }));
        actor.input_ack(
            "scope",
            "promotion-preparation",
            "promotion-preparation",
            "applied",
            Some("promotion-row"),
            None,
        );
        let mut claimed_snapshot = Actor::input_snapshot(&["other-row"], None);
        claimed_snapshot["hasClaimed"] = json!(true);
        assert_eq!(actor.send(json!({ "method": "beginInput", "scopeId": "scope", "requestId": "wrong-promotion",
            "intent": "steer", "source": "steer", "itemId": "other-row", "snapshot": claimed_snapshot }))["result"]["action"], "blocked");
        let marker = actor.control.0.lock().unwrap().inputs["session"]
            .active_steer_id
            .clone();
        let reserved = actor.send(json!({ "method": "beginInput", "scopeId": "scope", "requestId": "reserved-promotion",
            "intent": "steer", "source": "steer", "itemId": "promotion-row", "snapshot": claimed_snapshot }));
        assert_eq!(reserved["result"]["action"], "steer");
        assert_eq!(
            reserved["scope"]["input"]["activeClaimId"],
            "promotion-preparation"
        );
        actor.input_effect(
            "scope",
            "promotion-preparation",
            "release-mutation",
            "release-for-mutation",
            json!({ "kind": "orphan" }),
        );
        let released = actor.input_ack(
            "scope",
            "promotion-preparation",
            "release-mutation",
            "applied",
            None,
            None,
        );
        assert_eq!(released["scope"]["input"]["activeClaimId"], Value::Null);
        assert_eq!(
            actor.begin_input(
                "scope",
                "competing-drain",
                "drain",
                "queue",
                &promotion_snapshot
            )["result"]["action"],
            "blocked"
        );
        let promoted = actor.send(json!({ "method": "ackInputEffect", "scopeId": "scope", "effectId": "reserved-promotion",
            "outcome": "applied", "inputId": "promotion-row" }));
        assert_eq!(promoted["scope"]["input"]["activeSteerId"], json!(marker));
        let promoted_drain = actor.begin_input(
            "scope",
            "promoted-drain",
            "drain",
            "queue",
            &Actor::input_snapshot(&["other-row"], Some("promotion-row")),
        );
        assert_eq!(promoted_drain["result"]["inputId"], "promotion-row");
        assert_eq!(promoted_drain["result"]["source"], "steer");
        actor.input_ack(
            "scope",
            "promoted-drain",
            "promoted-drain",
            "applied",
            Some("promotion-row"),
            None,
        );
        actor.input_effect(
            "scope",
            "promoted-drain",
            "promoted-consume",
            "consume",
            json!({ "kind": "operation", "id": "resumed-operation" }),
        );
        actor.input_ack(
            "scope",
            "promoted-drain",
            "promoted-consume",
            "applied",
            None,
            None,
        );
        actor.send(
            json!({ "method": "endInput", "scopeId": "scope", "drainLeaseId": "promoted-drain" }),
        );
        let empty = Actor::input_snapshot(&[], None);
        actor.begin_input("scope", "destroy-unknown", "enqueue", "send", &empty);
        actor.input_ack(
            "scope",
            "destroy-unknown",
            "destroy-unknown",
            "unknown",
            None,
            None,
        );
        let target =
            json!({ "kind": "interaction", "messageId": "parked-message", "toolCallId": "tool" });
        actor.send(json!({ "method": "acquireLease", "scopeId": "scope", "leaseId": "park", "target": target }));
        assert_eq!(actor.send(json!({ "method": "clearSession", "sessionId": "session", "originScopeId": "scope" }))["outcome"], "stale");
        actor.send(json!({ "method": "retire", "scopeId": "scope" }));
        assert_eq!(actor.send(json!({ "method": "clearSession", "sessionId": "session", "originScopeId": "scope" }))["result"], true);
        actor.open("replacement");
        assert_eq!(
            actor.begin_input(
                "replacement",
                "replacement-input",
                "enqueue",
                "send",
                &empty
            )["result"]["action"],
            "claim"
        );
        assert_eq!(
            actor.input_ack(
                "scope",
                "destroy-unknown",
                "destroy-unknown",
                "applied",
                Some("late"),
                None
            )["outcome"],
            "stale"
        );
        let late_end = actor.send(
            json!({ "method": "endInput", "scopeId": "scope", "drainLeaseId": "destroy-unknown" }),
        );
        assert_eq!(late_end["result"]["released"], false);
        assert_eq!(
            late_end["scope"]["input"]["activeClaimId"],
            "replacement-input"
        );
        assert_eq!(actor.send(json!({ "method": "parkInteraction", "scopeId": "scope", "leaseId": "park", "messageId": "parked-message", "toolCallId": "tool" }))["result"], false);
        assert_eq!(actor.send(json!({ "method": "clearSession", "sessionId": "session", "originScopeId": "scope" }))["outcome"], "stale");
        actor.input_ack(
            "replacement",
            "replacement-input",
            "replacement-input",
            "rejected",
            None,
            None,
        );
        actor.send(json!({ "method": "endInput", "scopeId": "replacement", "drainLeaseId": "replacement-input" }));

        actor.begin_input("replacement", "pre-fact", "enqueue", "send", &empty);
        actor.input_ack(
            "replacement",
            "pre-fact",
            "pre-fact",
            "applied",
            Some("pre-fact-input"),
            None,
        );
        actor.operation("replacement", "bound");
        let bound = json!({ "kind": "operation", "id": "bound" });
        actor.send(json!({ "method": "prepareRun", "scopeId": "replacement", "operationId": "bound", "runId": "phase-run", "messageId": "phase-message" }));
        assert_eq!(
            actor.input_effect(
                "replacement",
                "pre-fact",
                "during-phase",
                "user-fact",
                bound.clone()
            )["outcome"],
            "stale"
        );
        actor.send(json!({ "method": "commit", "scopeId": "replacement", "transitionId": "phase-run", "aborted": false }));
        actor.send(json!({ "method": "clearRun", "scopeId": "replacement", "runId": "phase-run" }));
        actor.operation("replacement", "superseded");
        assert_eq!(
            actor.input_effect(
                "replacement",
                "pre-fact",
                "late-user-fact",
                "user-fact",
                bound.clone()
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect(
                "replacement",
                "pre-fact",
                "late-rollback",
                "rollback",
                bound.clone()
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.input_effect(
                "replacement",
                "pre-fact",
                "origin-consume",
                "consume",
                bound.clone()
            )["outcome"],
            "accepted"
        );
        actor.input_ack(
            "replacement",
            "pre-fact",
            "origin-consume",
            "rejected",
            None,
            None,
        );
        assert_eq!(
            actor.input_effect(
                "replacement",
                "pre-fact",
                "origin-release",
                "release-before-user-fact",
                bound
            )["outcome"],
            "accepted"
        );
        actor.input_ack(
            "replacement",
            "pre-fact",
            "origin-release",
            "applied",
            None,
            None,
        );
        actor.send(
            json!({ "method": "endInput", "scopeId": "replacement", "drainLeaseId": "pre-fact" }),
        );
        let foreign = Actor::input_snapshot(&["foreign-row"], None);
        actor.send(json!({ "method": "beginInput", "scopeId": "replacement", "requestId": "foreign-preparation",
            "intent": "prepare", "source": "queue", "itemId": "foreign-row", "snapshot": foreign }));
        actor.input_ack(
            "replacement",
            "foreign-preparation",
            "foreign-preparation",
            "applied",
            Some("foreign-row"),
            None,
        );
        actor.send(json!({ "method": "retire", "scopeId": "replacement" }));
        actor.open("foreign-successor");
        let mut foreign_claimed = Actor::input_snapshot(&[], None);
        foreign_claimed["hasClaimed"] = json!(true);
        assert_eq!(actor.send(json!({ "method": "beginInput", "scopeId": "foreign-successor", "requestId": "foreign-promotion",
            "intent": "steer", "source": "steer", "itemId": "foreign-row", "snapshot": foreign_claimed }))["result"]["action"], "blocked");
        actor.input_effect(
            "replacement",
            "foreign-preparation",
            "foreign-release",
            "release-before-user-fact",
            json!({ "kind": "orphan" }),
        );
        actor.input_ack(
            "replacement",
            "foreign-preparation",
            "foreign-release",
            "applied",
            None,
            None,
        );
    }

    #[test]
    fn replacement_requires_fencing_and_preserves_run_operation_and_message_identity() {
        let mut actor = Actor::default();
        actor.open("scope");
        actor.operation("scope", "first");
        actor.run("scope", "first", "run-1");
        let reused = actor.send(
            json!({ "method": "prepareOperation", "scopeId": "scope", "operationId": "unused" }),
        );
        assert_eq!(reused["result"]["operationId"], "first");
        assert_eq!(reused["result"]["reused"], true);
        let aborted = actor.send(json!({ "method": "abort", "scopeId": "scope" }));
        assert_eq!(aborted["scope"]["run"]["id"], "run-1");
        let prepared = actor.send(
            json!({ "method": "prepareOperation", "scopeId": "scope", "operationId": "next" }),
        );
        assert_eq!(prepared["scope"]["operation"]["id"], "first");
        assert_eq!(
            prepared["fences"],
            json!([{ "kind": "operation", "id": "first" }, { "kind": "run", "id": "run-1" }])
        );
        let stale = actor.send(json!({ "method": "status", "scopeId": "scope", "owner": { "kind": "run", "id": "run-1" }, "status": "idle" }));
        assert_eq!(stale["outcome"], "stale");
        let committed = actor.send(json!({ "method": "commit", "scopeId": "scope", "transitionId": "next", "aborted": false }));
        assert_eq!(committed["scope"]["operation"]["id"], "next");
        assert_eq!(committed["scope"]["run"], Value::Null);
        let late = actor.send(
            json!({ "method": "clearOperation", "scopeId": "scope", "operationId": "first" }),
        );
        assert_eq!(late["result"]["cleared"], false);
        assert_eq!(late["result"]["settles"], false);
        assert_eq!(late["scope"]["operation"]["id"], "next");
        actor.run("scope", "next", "run-2");
        actor.sequence += 1;
        assert!(actor.control.dispatch(actor.sequence, json!({ "method": "prepareRun", "scopeId": "scope", "operationId": "next", "runId": "run-2", "messageId": "wrong-message" })).is_err());
    }

    #[test]
    fn retired_incarnation_can_clean_its_run_without_mutating_a_replacement() {
        let mut actor = Actor::default();
        actor.open("old");
        actor.operation("old", "operation-old");
        actor.run("old", "operation-old", "run-old");
        assert_eq!(actor.open("new")["outcome"], "stale");
        let retired = actor.send(json!({ "method": "retire", "scopeId": "old" }));
        assert_eq!(retired["scope"]["current"], false);
        assert_eq!(actor.open("new")["scope"]["current"], true);
        actor.operation("new", "operation-new");
        let rejected = actor.send(json!({ "method": "status", "scopeId": "old", "owner": { "kind": "run", "id": "run-old" }, "status": "error" }));
        assert_eq!(rejected["outcome"], "stale");
        let cleaned =
            actor.send(json!({ "method": "clearRun", "scopeId": "old", "runId": "run-old" }));
        assert_eq!(cleaned["result"], true);
        let ready = actor.send(json!({ "method": "clearReady", "scopeId": "new" }));
        assert_eq!(ready["scope"]["operation"]["id"], "operation-new");
        assert_eq!(ready["scope"]["status"], "idle");
        assert!(!actor.control.0.lock().unwrap().scopes.contains_key("old"));
    }

    #[test]
    fn exclusion_and_parking_keep_origin_identity_across_scope_retirement_and_destroy() {
        let mut actor = Actor::default();
        actor.open("old");
        let target = json!({ "kind": "interaction", "messageId": "message", "toolCallId": "tool" });
        let acquire = |scope: &str, id: &str| json!({ "method": "acquireLease", "scopeId": scope, "leaseId": id, "target": target });
        actor.send(json!({ "method": "queueAcceptance", "scopeId": "old", "leaseId": "old-preparation", "lane": "send" }));
        assert_eq!(actor.send(acquire("old", "first"))["result"], "granted");
        assert_eq!(actor.send(acquire("old", "second"))["result"], "busy");
        actor.send(json!({ "method": "abort", "scopeId": "old" }));
        assert_eq!(actor.send(acquire("old", "second"))["result"], "busy");
        actor.send(json!({ "method": "retire", "scopeId": "old" }));
        actor.open("new");
        let park = json!({ "method": "parkInteraction", "scopeId": "old", "leaseId": "first", "messageId": "message", "toolCallId": "tool" });
        assert_eq!(actor.send(park.clone())["result"], true);
        assert_eq!(
            actor.send(acquire("new", "replacement"))["result"],
            "parked"
        );
        assert_eq!(
            actor.send(
                json!({ "method": "clearSession", "sessionId": "session", "originScopeId": "old" })
            )["outcome"],
            "stale"
        );
        actor.send(json!({ "method": "retire", "scopeId": "new" }));
        actor.send(json!({ "method": "inputRecovery", "sessions": [] }));
        assert_eq!(
            actor.send(
                json!({ "method": "clearSession", "sessionId": "session", "originScopeId": null })
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.send(
                json!({ "method": "clearSession", "sessionId": "session", "originScopeId": "old" })
            )["outcome"],
            "stale"
        );
        assert_eq!(
            actor.send(
                json!({ "method": "clearSession", "sessionId": "session", "originScopeId": "new" })
            )["result"],
            true
        );
        actor.open("replacement");
        assert_eq!(actor.send(json!({ "method": "queueAcceptance", "scopeId": "replacement", "leaseId": "new-preparation", "lane": "send" }))["result"], "granted");
        assert_eq!(actor.send(json!({ "method": "releaseAcceptance", "scopeId": "old", "leaseId": "old-preparation", "lane": "send" }))["result"], false);
        assert_eq!(actor.send(json!({ "method": "queueAcceptance", "scopeId": "replacement", "leaseId": "waiting", "lane": "send" }))["result"], "queued");
        assert_eq!(actor.send(park)["result"], false);
        assert_eq!(
            actor.send(acquire("replacement", "replacement"))["result"],
            "granted"
        );
        assert_eq!(actor.send(json!({ "method": "releaseLease", "scopeId": "replacement", "leaseId": "first", "target": target }))["result"], false);
        assert_eq!(
            actor.send(acquire("replacement", "third"))["result"],
            "busy"
        );
        assert_eq!(actor.send(json!({ "method": "releaseLease", "scopeId": "old", "leaseId": "first", "target": target }))["result"], true);
        assert_eq!(
            actor.send(acquire("replacement", "third"))["result"],
            "busy"
        );
    }

    #[test]
    fn acceptance_preserves_fifo_cancellation_and_active_preparation_across_replacement() {
        let mut actor = Actor::default();
        actor.open("old");
        let queue = |scope: &str, id: &str, lane: &str| json!({ "method": "queueAcceptance", "scopeId": scope, "leaseId": id, "lane": lane });
        let release = |scope: &str, id: &str, lane: &str| json!({ "method": "releaseAcceptance", "scopeId": scope, "leaseId": id, "lane": lane });
        assert_eq!(actor.send(queue("old", "a", "send"))["result"], "granted");
        assert_eq!(
            actor.send(queue("old", "steer", "steer"))["result"],
            "granted"
        );
        assert_eq!(actor.send(queue("old", "b", "send"))["result"], "queued");
        assert_eq!(actor.send(queue("old", "c", "send"))["result"], "queued");
        let cancelled = actor.send(release("old", "b", "send"));
        assert_eq!(cancelled["result"], true);
        assert_eq!(cancelled["grants"], json!([]));
        actor.send(json!({ "method": "retire", "scopeId": "old" }));
        actor.open("new");
        assert_eq!(actor.send(queue("new", "next", "send"))["result"], "queued");
        assert_eq!(actor.send(release("new", "a", "send"))["result"], false);
        let granted = actor.send(release("old", "a", "send"));
        assert_eq!(
            granted["grants"],
            json!([{ "scopeId": "new", "leaseId": "next" }])
        );
        assert_eq!(actor.send(release("old", "next", "send"))["result"], false);
        assert_eq!(actor.send(release("new", "next", "send"))["result"], true);
        assert_eq!(actor.send(release("old", "steer", "steer"))["result"], true);
    }

    #[test]
    fn deferred_children_require_the_origin_owner_and_are_revoked_with_the_parent() {
        let mut actor = Actor::default();
        actor.open("scope");
        actor.operation("scope", "operation");
        let parent = json!({ "kind": "interaction", "messageId": "message", "toolCallId": "tool" });
        let child = json!({ "kind": "deferred", "messageId": "message", "toolCallId": "tool", "parentLeaseId": "parent", "owner": { "kind": "operation", "id": "operation" } });
        let acquire = |id: &str, target: &Value| json!({ "method": "acquireLease", "scopeId": "scope", "leaseId": id, "target": target });
        let first = |tool: &str| {
            json!({ "method": "updateInteractions", "scopeId": "scope", "owner": { "kind": "operation", "id": "operation" },
            "update": { "interactions": [{ "messageId": "message", "toolCallId": tool, "origin": "pre-check-permission", "order": 0 }] } })
        };
        actor.send(first("tool"));
        assert_eq!(actor.send(acquire("child", &child))["outcome"], "stale");
        actor.send(acquire("parent", &parent));
        actor.send(first("other"));
        assert_eq!(actor.send(acquire("child", &child))["outcome"], "stale");
        actor.send(first("tool"));
        assert_eq!(actor.send(acquire("child", &child))["result"], "granted");
        assert_eq!(actor.send(acquire("duplicate", &child))["result"], "busy");
        let release = actor.send(json!({ "method": "releaseLease", "scopeId": "scope", "leaseId": "parent", "target": parent }));
        assert_eq!(
            release["fences"],
            json!([{ "kind": "operation", "id": "child" }])
        );
        assert_eq!(release["scope"]["deferred"], json!([]));
        actor.send(acquire("parent", &parent));
        actor.send(acquire("replacement", &child));
        let old_clear = actor.send(json!({ "method": "releaseLease", "scopeId": "scope", "leaseId": "child", "target": child }));
        assert_eq!(old_clear["result"], false);
        assert_eq!(
            old_clear["scope"]["deferred"],
            json!([{ "toolCallId": "tool", "id": "replacement" }])
        );
        let stopped = actor.send(json!({ "method": "abortDeferred", "scopeId": "scope" }));
        assert_eq!(
            stopped["fences"],
            json!([{ "kind": "operation", "id": "replacement" }])
        );
    }

    #[test]
    fn permission_resolution_is_run_bound_once_only_and_preserves_conflicting_slots() {
        let mut actor = Actor::default();
        actor.open("scope");
        actor.operation("scope", "operation");
        actor.run("scope", "operation", "run");
        let register = |id: &str, request: &str, tool: &str| json!({ "method": "registerPermission", "scopeId": "scope", "permissionId": id, "requestId": request, "messageId": "message-run", "toolCallId": tool, "runId": "run" });
        let take = |id: Option<&str>, request: &str, tool: &str| json!({ "method": "takePermission", "scopeId": "scope", "permissionId": id, "requestId": request, "messageId": "message-run", "toolCallId": tool, "runId": "run", "leaseId": "interaction", "granted": true, "resolutionId": "direct-resolution" });
        let first = |tool: &str| {
            json!({ "method": "updateInteractions", "scopeId": "scope", "owner": { "kind": "run", "id": "run" },
            "update": { "interactions": [{ "messageId": "message-run", "toolCallId": tool, "origin": "acp-permission", "order": 0 }] } })
        };
        actor.send(json!({ "method": "acquireLease", "scopeId": "scope", "leaseId": "interaction", "target": { "kind": "interaction", "messageId": "message-run", "toolCallId": "tool" } }));
        assert_eq!(
            actor.send(register("callback", "request", "tool"))["result"],
            true
        );
        actor.send(first("other"));
        assert_eq!(
            actor.send(take(Some("callback"), "request", "tool"))["outcome"],
            "stale"
        );
        actor.send(first("tool"));
        assert_eq!(
            actor.send(take(Some("wrong"), "request", "tool"))["result"],
            "conflict"
        );
        let claimed = actor.send(take(Some("callback"), "request", "tool"));
        assert_eq!(claimed["result"], "callback");
        assert_eq!(claimed["scope"]["permissions"], json!([]));
        assert_eq!(actor.send(take(None, "request", "tool"))["result"], "spent");
        assert_eq!(
            actor.send(take(None, "missing", "tool"))["result"],
            "direct"
        );
        assert_eq!(actor.send(take(None, "missing", "tool"))["result"], "spent");
        actor.send(register("replacement", "request", "other-tool"));
        let conflict = actor.send(take(Some("callback"), "request", "tool"));
        assert_eq!(conflict["result"], "conflict");
        assert_eq!(
            conflict["scope"]["permissions"],
            json!([{ "requestId": "request", "id": "replacement" }])
        );
        assert_eq!(
            actor.send(register("empty-tool", "empty-request", ""))["result"],
            true
        );
        let aborted = actor.send(json!({ "method": "abort", "scopeId": "scope" }));
        let fences = aborted["fences"].as_array().unwrap();
        assert!(fences.contains(&json!({ "kind": "permission", "id": "replacement" })));
        assert!(fences.contains(&json!({ "kind": "permission", "id": "empty-tool" })));
        assert_eq!(aborted["scope"]["permissions"], json!([]));
        assert_eq!(
            actor.send(register("late", "late", "tool"))["result"],
            false
        );
        assert_eq!(actor.send(take(None, "late", "tool"))["outcome"], "stale");
        actor.send(json!({ "method": "updateInteractions", "scopeId": "scope", "owner": { "kind": "run", "id": "run" },
            "update": { "interactions": [] } }));
        let orphan_denial = actor.send(
            json!({ "method": "takePermission", "scopeId": "scope", "permissionId": null,
            "requestId": "orphan", "messageId": "message-run", "toolCallId": "tool", "runId": null,
            "leaseId": "interaction", "granted": false, "resolutionId": "denial" }),
        );
        assert_eq!(orphan_denial["result"], "direct");
    }

    #[test]
    fn reused_controller_does_not_authorize_an_old_runs_status_or_local_cleanup() {
        let mut actor = Actor::default();
        actor.open("scope");
        actor.operation("scope", "shared");
        actor.run("scope", "shared", "first");
        actor.run("scope", "shared", "second");
        let status = |kind: &str, id: &str| json!({ "method": "status", "scopeId": "scope", "owner": { "kind": kind, "id": id }, "status": "error" });
        let clear = |run: Option<&str>| json!({ "method": "clearOperation", "scopeId": "scope", "operationId": "shared", "runId": run });
        assert_eq!(
            actor.send(status("operation", "shared"))["outcome"],
            "stale"
        );
        let late = actor.send(clear(Some("first")));
        assert_eq!(
            late["result"],
            json!({ "cleared": false, "settles": false })
        );
        assert_eq!(late["scope"]["run"]["id"], "second");
        actor.send(json!({ "method": "clearRun", "scopeId": "scope", "runId": "second" }));
        assert_eq!(
            actor.send(status("operation", "shared"))["outcome"],
            "stale"
        );
        assert_eq!(actor.send(status("run", "first"))["outcome"], "stale");
        assert_eq!(actor.send(clear(Some("first")))["result"]["settles"], false);
        assert_eq!(actor.send(clear(Some("second")))["result"]["settles"], true);
        assert_eq!(actor.send(status("run", "second"))["result"], true);
        actor.operation("scope", "next");
        actor
            .send(json!({ "method": "clearOperation", "scopeId": "scope", "operationId": "next" }));
        assert_eq!(actor.send(status("run", "second"))["outcome"], "stale");
        assert_eq!(actor.send(status("operation", "next"))["result"], true);
    }

    #[test]
    fn interaction_order_origins_and_batch_projection_belong_to_the_originating_run() {
        let mut actor = Actor::default();
        actor.open("scope");
        actor.operation("scope", "shared");
        actor.run("scope", "shared", "first");
        let owner = json!({ "kind": "run", "id": "first" });
        let entry = |tool: &str, origin: &str, order: u64| {
            json!({
                "messageId": "message-first", "toolCallId": tool, "origin": origin, "order": order
            })
        };
        let update = |interactions: Value, extra: Value| {
            let mut update = json!({ "interactions": interactions });
            update
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            json!({ "method": "updateInteractions", "scopeId": "scope", "owner": owner, "update": update })
        };
        let second = entry("second", "pre-check-permission", 1);
        let first = entry("first", "question", 0);
        let acp = entry("acp", "acp-permission", 2);
        let projection = actor.send(update(
            json!([second, acp, first]),
            json!({ "batch": {
                "id": "batch", "callOrder": ["first", "second"], "invokedCallIds": [],
                "committedResultCallIds": [], "pendingInteractionCallIds": []
            }}),
        ));
        assert_eq!(
            projection["scope"]["interactions"],
            json!([first, second, acp])
        );
        assert_eq!(
            projection["scope"]["batch"]["pendingInteractionCallIds"],
            json!(["first", "second"])
        );
        for tool in ["first", "second"] {
            actor.send(json!({ "method": "acquireLease", "scopeId": "scope", "leaseId": format!("lease-{tool}"),
                "target": { "kind": "interaction", "messageId": "message-first", "toolCallId": tool } }));
        }
        let check = |tool: &str, lease: &str| {
            json!({ "method": "checkInteraction", "scopeId": "scope", "owner": owner,
            "messageId": "message-first", "toolCallId": tool, "leaseId": lease })
        };
        assert_eq!(actor.send(check("first", "lease-first"))["result"], true);
        assert_eq!(actor.send(check("second", "lease-second"))["result"], false);
        assert_eq!(actor.send(check("first", "wrong"))["result"], false);
        let origin = actor.send(json!({ "method": "interactionOrigin", "scopeId": "scope", "owner": owner,
            "messageId": "message-first", "toolCallId": "second", "origin": "post-call-permission" }));
        assert_eq!(origin["result"], true);
        let advance = json!({ "method": "advanceBatch", "scopeId": "scope", "owner": owner,
            "invokedCallId": "second", "committedResultCallId": "first" });
        actor.send(advance.clone());
        let advanced = actor.send(advance);
        assert_eq!(
            advanced["scope"]["batch"]["invokedCallIds"],
            json!(["second"])
        );
        assert_eq!(
            advanced["scope"]["batch"]["committedResultCallIds"],
            json!(["first"])
        );
        let reconciled = actor.send(update(
            json!([
                entry("second", "pre-check-permission", 0),
                entry("first", "question", 1),
                acp
            ]),
            json!({ "reconcile": true }),
        ));
        assert_eq!(reconciled["scope"]["interactions"][0], first);
        assert_eq!(
            reconciled["scope"]["interactions"][1]["origin"],
            "post-call-permission"
        );
        assert_eq!(reconciled["scope"]["batch"]["id"], "batch");

        actor.run("scope", "shared", "second");
        assert_eq!(actor.send(check("first", "lease-first"))["result"], false);
        let stale = actor.send(
            json!({ "method": "status", "scopeId": "scope", "owner": owner,
            "status": "error", "interactions": { "interactions": [], "batch": null } }),
        );
        assert_eq!(stale["outcome"], "stale");
        assert_eq!(stale["scope"]["status"], "idle");
        assert_eq!(stale["scope"]["batch"]["id"], "batch");
        let replacement = json!({ "kind": "run", "id": "second" });
        let only_acp = actor.send(
            json!({ "method": "updateInteractions", "scopeId": "scope", "owner": replacement,
            "update": { "interactions": [acp] } }),
        );
        assert_eq!(only_acp["scope"]["interactions"], json!([acp]));
        assert_eq!(only_acp["scope"]["batch"], Value::Null);
        actor.send(
            json!({ "method": "updateInteractions", "scopeId": "scope", "owner": replacement,
            "update": { "interactions": [first], "batch": {
                "id": "next-batch", "callOrder": ["first"], "invokedCallIds": [],
                "committedResultCallIds": [], "pendingInteractionCallIds": ["first"]
            } } }),
        );
        let cleared = actor.send(
            json!({ "method": "updateInteractions", "scopeId": "scope", "owner": replacement,
            "update": { "interactions": [first], "batch": null } }),
        );
        assert_eq!(cleared["scope"]["interactions"], json!([first]));
        assert_eq!(cleared["scope"]["batch"], Value::Null);
        actor.send(json!({ "method": "clearRun", "scopeId": "scope", "runId": "second" }));
        let settled = actor.send(
            json!({ "method": "status", "scopeId": "scope", "owner": replacement,
            "status": "generating", "interactions": { "interactions": [first] } }),
        );
        assert_eq!(settled["result"], true);
        let retired = actor.send(json!({ "method": "retire", "scopeId": "scope" }));
        assert_eq!(retired["scope"]["interactions"], json!([]));
        assert_eq!(retired["scope"]["batch"], Value::Null);
    }

    #[test]
    fn cancelled_preparation_cannot_be_revived_and_protocol_reordering_fails_closed() {
        let mut actor = Actor::default();
        actor.open("scope");
        actor.send(
            json!({ "method": "prepareOperation", "scopeId": "scope", "operationId": "operation" }),
        );
        actor.send(json!({ "method": "abort", "scopeId": "scope" }));
        let late = actor.send(json!({ "method": "commit", "scopeId": "scope", "transitionId": "operation", "aborted": false }));
        assert_eq!(late["outcome"], "cancelled");
        assert_eq!(late["scope"]["operation"]["aborted"], true);
        actor.run("scope", "operation", "run");
        let ready = actor.send(json!({ "method": "ready", "scopeId": "scope", "runId": "run" }));
        assert_eq!(ready["result"], false);
        let terminal = actor.send(json!({ "method": "status", "scopeId": "scope", "owner": { "kind": "run", "id": "run" }, "status": "idle" }));
        assert_eq!(terminal["result"], true);
        assert!(actor
            .control
            .dispatch(
                actor.sequence + 2,
                json!({ "method": "clearReady", "scopeId": "scope" })
            )
            .is_err());
        assert!(actor
            .control
            .dispatch(
                actor.sequence + 1,
                json!({ "method": "clearReady", "scopeId": "scope" })
            )
            .is_err());
    }
}
