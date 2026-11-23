//! Unadmitted legacy drafts are compatibility facts. Branch/InputQueue own every admitted input.
use crate::{facts::*, inputs::DeepChatInputMetadata};
use dim_agent_capabilities::methods::RpcError;
use dim_agent_types::EventKind;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftRef {
    pub id: String,
    pub revision: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Mutation {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub branch_id: String,
    pub operation_id: String,
    pub draft: DraftRef,
    pub action: String,
    pub payload: Option<Value>,
    pub to_index: Option<usize>,
    pub blocking: Option<Value>,
}

pub(crate) fn validate(inputs: &[Value], product: &str) -> Result<(), RpcError> {
    let mut ids = BTreeSet::new();
    if inputs.len() > 128 {
        return Err(RpcError::invalid("Too many legacy drafts"));
    }
    for item in inputs {
        let id = item["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 256)
            .ok_or_else(|| RpcError::invalid("Invalid legacy draft identity"))?;
        if !ids.insert(id)
            || item["sessionId"] != product
            || !item["payload"]["text"].is_string()
            || !matches!(item["mode"].as_str(), Some("queue" | "steer"))
            || !matches!(
                item["state"].as_str(),
                Some("pending" | "blocked" | "retry_required" | "claimed")
            )
            || !item["messageIds"]
                .as_array()
                .is_some_and(|items| items.iter().all(Value::is_string))
        {
            return Err(RpcError::invalid("Invalid legacy draft"));
        }
    }
    Ok(())
}

pub(crate) async fn list(metadata: &DeepChatInputMetadata) -> Result<Value, RpcError> {
    let states = events(&metadata.timeline, extension("legacy-queue-state")).await?;
    let (mut inputs, revision) = if let Some(event) = states.last() {
        let EventKind::Extension(state) = &event.kind else {
            unreachable!()
        };
        (
            state.data()["inputs"]
                .as_array()
                .cloned()
                .ok_or_else(|| RpcError::invalid("Invalid legacy draft state"))?,
            event.sequence,
        )
    } else {
        let source = metadata
            .legacy_source
            .get_or_try_init(|| crate::migration::pending_drafts(metadata))
            .await?;
        let Some((inputs, revision)) = source else {
            return Ok(json!({"revision":null,"inputs":[]}));
        };
        (inputs.clone(), *revision)
    };
    let represented = events(
        &metadata.timeline,
        and(vec![
            extension("input-representation"),
            json!({"op":"present","value":field("data.legacyDraft.id")}),
        ]),
    )
    .await?;
    if !represented.is_empty() {
        let submissions: Vec<_> = represented
            .iter()
            .filter_map(|event| {
                let EventKind::Extension(data) = &event.kind else {
                    return None;
                };
                data.data()["submissionId"].as_str().map(str::to_owned)
            })
            .collect();
        let admitted = events(
            &metadata.timeline,
            and(vec![
                equal("kind", json!("input/message")),
                one_of("data.submission_id", json!(submissions)),
            ]),
        )
        .await?;
        let admitted: BTreeSet<_> = admitted
            .iter()
            .filter_map(|event| match &event.kind {
                EventKind::InputMessage(input) => input.submission_id.as_deref(),
                _ => None,
            })
            .collect();
        let consumed: BTreeSet<_> = represented
            .iter()
            .filter_map(|event| {
                let EventKind::Extension(data) = &event.kind else {
                    return None;
                };
                admitted
                    .contains(data.data()["submissionId"].as_str()?)
                    .then(|| data.data()["legacyDraft"]["id"].as_str())
                    .flatten()
            })
            .collect();
        inputs.retain(|item| !item["id"].as_str().is_some_and(|id| consumed.contains(id)));
    }
    Ok(json!({"revision":revision.to_string(),"inputs":inputs}))
}

pub(crate) async fn check(
    metadata: &DeepChatInputMetadata,
    draft: &DraftRef,
) -> Result<(), RpcError> {
    let state = list(metadata).await?;
    if state["revision"] != draft.revision
        || !state["inputs"]
            .as_array()
            .is_some_and(|inputs| inputs.iter().any(|item| item["id"] == draft.id))
    {
        return Err(RpcError::service(
            "input_blocked",
            "The legacy draft changed before admission",
        ));
    }
    Ok(())
}

pub(crate) async fn mutate(
    metadata: &DeepChatInputMetadata,
    request: Mutation,
) -> Result<Value, RpcError> {
    if request.operation_id.is_empty()
        || request.operation_id.len() > 64
        || !request
            .operation_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err(RpcError::invalid("Invalid legacy draft command identity"));
    }
    let previous = events(
        &metadata.timeline,
        and(vec![
            extension("legacy-queue-state"),
            equal("data.command.operationId", json!(request.operation_id)),
        ]),
    )
    .await?;
    if let Some(event) = previous.first() {
        let EventKind::Extension(data) = &event.kind else {
            unreachable!()
        };
        if data.data()["command"]
            != serde_json::to_value(&request)
                .map_err(|error| RpcError::invalid(error.to_string()))?
        {
            return Err(RpcError::invalid(
                "Legacy draft command identity was reused",
            ));
        }
        published(&metadata.timeline, event.sequence).await?;
        return list(metadata).await;
    }
    crate::inputs::ensure_active(metadata).await?;
    crate::migration::check_ready(metadata).await?;
    check(metadata, &request.draft).await?;
    let state = list(metadata).await?;
    let mut inputs = state["inputs"].as_array().cloned().unwrap_or_default();
    let index = inputs
        .iter()
        .position(|item| item["id"] == request.draft.id)
        .ok_or_else(|| RpcError::invalid("Legacy draft is absent"))?;
    match request.action.as_str() {
        "delete" => {
            inputs.remove(index);
        }
        "move" => {
            let target = request
                .to_index
                .filter(|target| *target < inputs.len())
                .ok_or_else(|| RpcError::invalid("Invalid legacy draft destination"))?;
            let item = inputs.remove(index);
            inputs.insert(target, item);
        }
        "update" => {
            let payload = request
                .payload
                .as_ref()
                .filter(|payload| payload["text"].is_string())
                .ok_or_else(|| RpcError::invalid("Invalid legacy draft payload"))?;
            inputs[index]["payload"] = payload.clone();
            inputs[index]["state"] = json!("pending");
            inputs[index]["blocking"] = Value::Null;
        }
        "block" => {
            inputs[index]["state"] = json!("blocked");
            inputs[index]["blocking"] = request.blocking.clone().unwrap_or(Value::Null);
        }
        _ => return Err(RpcError::invalid("Unknown legacy draft command")),
    }
    for (index, item) in inputs.iter_mut().enumerate() {
        item["queueOrder"] = json!(index);
    }
    append(
        &metadata.timeline,
        "legacy-queue-state",
        json!({"inputs":inputs,"command":request}),
    )?;
    published(&metadata.timeline, metadata.timeline.committed()).await?;
    list(metadata).await
}
