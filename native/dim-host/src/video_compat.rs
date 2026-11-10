//! The desktop /videos protocol missing from this pinned dim adapter. This is
//! only a ModalityAdapter operation: dim owns admission, queueing, persistence,
//! restart and cancellation. All HTTP uses dim's shared Aimux transport.
use aimux_core::{AbortSignal, AiMuxError};
use aimux_provider_utils::{
    HttpRequest, get_from_api, post_json_to_api,
    response_handler::{
        ResponseHandler, ResponseHandlerOutput, create_json_response_handler,
        create_status_code_error_response_handler,
    },
};
use dim_agent_aimux::MediaTransport;
use dim_agent_capabilities::host::{ModalityConnection, ModelConnection};
use dim_modality::{AdapterError, AdapterOperation, AdapterOutput, Job, JobFile, Submitted};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

const PREFIX: &str = "deepchat-openai-video/v1:";
const MAX_BYTES: usize = 256 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
struct Handle {
    id: String,
    job: Job,
    started_at: u64,
}
pub fn operation() -> AdapterOperation {
    AdapterOperation {
        category: "video".into(),
        operation: "generate".into(),
        params_schema: json!({"type":"object","required":["prompt"],"properties":{
            "prompt":{"type":"string","minLength":1},
            "providerOptions":{"type":"object"}
        }}),
    }
}
pub fn handles(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.starts_with(PREFIX))
}
pub async fn submit(
    job: Job,
    connection: ModalityConnection,
    cancel: CancellationToken,
) -> Result<Submitted, AdapterError> {
    let body = request_body(&job)?;
    let task = exchange(&connection, "/videos", Some(body), &cancel).await?;
    let id = task
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 256
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        })
        .ok_or_else(|| AdapterError::provider_error("Video response has no valid task id"))?;
    let handle = Handle {
        id: id.into(),
        job,
        started_at: now(),
    };
    Ok(Submitted {
        remote_handle: Some(format!(
            "{PREFIX}{}",
            serde_json::to_string(&handle)
                .map_err(|_| AdapterError::provider_error("Cannot store video task handle"))?
        )),
    })
}
pub async fn wait(
    handle: &str,
    connection: ModalityConnection,
    cancel: CancellationToken,
) -> Result<AdapterOutput, AdapterError> {
    let handle: Handle = serde_json::from_str(handle.strip_prefix(PREFIX).unwrap_or_default())
        .map_err(|_| AdapterError::provider_error("Invalid desktop video task handle"))?;
    let run = async {
        loop {
            if now().saturating_sub(handle.started_at) >= 3600 {
                return Err(AdapterError::provider_error("Video task exceeded one hour"));
            }
            let task = exchange(
                &connection,
                &format!("/videos/{}", handle.id),
                None,
                &cancel,
            )
            .await?;
            match task
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "completed" => {
                    let content = task
                        .get("url")
                        .and_then(Value::as_str)
                        .filter(|url| !url.is_empty())
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("/videos/{}/content", handle.id));
                    let file = download(&connection, &content, &handle.job, &cancel).await?;
                    return Ok(AdapterOutput {
                        files: vec![file],
                        data: None,
                    });
                }
                "failed" | "cancelled" | "canceled" | "expired" => {
                    return Err(AdapterError::provider_error(
                        "Video provider did not complete the task",
                    ));
                }
                _ => {}
            }
            tokio::select! {
                _ = cancel.cancelled() => return Err(failed()),
                _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            }
        }
    };
    tokio::time::timeout(
        Duration::from_secs(3600u64.saturating_sub(now().saturating_sub(handle.started_at))),
        run,
    )
    .await
    .map_err(|_| AdapterError::provider_error("Video task exceeded one hour"))?
}
fn request(
    connection: &ModalityConnection,
    path: &str,
    signal: &AbortSignal,
) -> Result<HttpRequest, AdapterError> {
    let ModelConnection::Http(http) = &connection.resolved.connection else {
        return Err(failed());
    };
    let (base, fetch) = MediaTransport::new().resolve(&http.network, &http.base_url);
    let base = base.trim_end_matches('/');
    let tail = base.rsplit('/').next().unwrap_or_default();
    let versioned = tail == "v1"
        || tail
            .strip_prefix("v1beta")
            .is_some_and(|suffix| !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit()));
    let base = if versioned {
        base.to_owned()
    } else {
        format!("{base}/v1")
    };
    let mut headers: Vec<(String, String)> = http
        .headers
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if !headers
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("authorization"))
    {
        if let Some(key) = http
            .bearer
            .as_ref()
            .or(http.api_key.as_ref())
            .filter(|key| !key.is_empty())
        {
            headers.push(("Authorization".into(), format!("Bearer {key}")));
        }
    }
    let absolute = path.starts_with("https://") || path.starts_with("http://");
    Ok(HttpRequest {
        url: if absolute {
            path.into()
        } else {
            format!("{}{path}", base.trim_end_matches('/'))
        },
        headers,
        fetch: Some(fetch),
        abort_signal: Some(signal.clone()),
        trusted_origin: Some(base.clone()),
        credentialed_origin: Some(base),
        response_timeout: Some(Duration::from_secs(600)),
        max_json_response_bytes: Some(64 * 1024),
        ..Default::default()
    })
}
async fn exchange(
    connection: &ModalityConnection,
    path: &str,
    body: Option<Value>,
    cancel: &CancellationToken,
) -> Result<Value, AdapterError> {
    let signal = AbortSignal::new();
    let request = request(connection, path, &signal)?;
    let run = async {
        if let Some(body) = body {
            post_json_to_api(
                request,
                body,
                create_json_response_handler::<Value>(),
                create_status_code_error_response_handler(),
            )
            .await
        } else {
            get_from_api(
                request,
                create_json_response_handler::<Value>(),
                create_status_code_error_response_handler(),
            )
            .await
        }
    };
    tokio::pin!(run);
    let result = tokio::select! {
        result = &mut run => result,
        _ = cancel.cancelled() => { signal.abort(); run.await }
    };
    // Never persist provider response bodies, request URLs, headers or transport errors.
    result.map(|reply| reply.value).map_err(|_| failed())
}
async fn download(
    connection: &ModalityConnection,
    url: &str,
    job: &Job,
    cancel: &CancellationToken,
) -> Result<JobFile, AdapterError> {
    let signal = AbortSignal::new();
    let mut request = request(connection, url, &signal)?;
    request.validate_url = true;
    let root = job.work_dir.clone();
    let handler = ResponseHandler::new(move |input| async move {
        let media_type = input
            .response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .filter(|value| value.starts_with("video/"))
            .unwrap_or("video/mp4")
            .to_owned();
        let name = if media_type == "video/webm" {
            "video.webm"
        } else {
            "video.mp4"
        };
        let path = root.join(name);
        let mut file = tokio::fs::File::create(&path)
            .await
            .map_err(|_| AiMuxError::other("Cannot create video result"))?;
        let mut size = 0usize;
        let mut stream = input.response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| AiMuxError::other("Video download interrupted"))?;
            size = size.saturating_add(chunk.len());
            if size > MAX_BYTES {
                return Err(AiMuxError::other(
                    "Video exceeds 256 MiB desktop result limit",
                ));
            }
            file.write_all(&chunk)
                .await
                .map_err(|_| AiMuxError::other("Cannot write video result"))?;
        }
        if size == 0 {
            return Err(AiMuxError::other("Empty video result"));
        }
        file.flush()
            .await
            .map_err(|_| AiMuxError::other("Cannot flush video result"))?;
        Ok(ResponseHandlerOutput {
            value: JobFile {
                name: name.into(),
                media_type,
                path,
            },
            raw_value: None,
            response_headers: Default::default(),
        })
    });
    let run = get_from_api(
        request,
        handler,
        create_status_code_error_response_handler(),
    );
    tokio::pin!(run);
    let result = tokio::select! {
        result = &mut run => result,
        _ = cancel.cancelled() => { signal.abort(); run.await }
    };
    result.map(|reply| reply.value).map_err(|_| failed())
}
fn request_body(job: &Job) -> Result<Value, AdapterError> {
    let prompt = job
        .params
        .get("prompt")
        .and_then(Value::as_str)
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| AdapterError::invalid_input("Video prompt is required"))?;
    let options = &job.params["providerOptions"]["deepchat"];
    let mut body = json!({"model":job.model.model_id,"prompt":prompt});
    for (from, to) in [
        ("seconds", "seconds"),
        ("size", "size"),
        ("inputReference", "input_reference"),
    ] {
        if let Some(value) = options.get(from) {
            body[to] = if from == "inputReference" && value.is_object() {
                let mut value = value.clone();
                if let Some(mime) = value
                    .as_object_mut()
                    .and_then(|value| value.remove("mimeType"))
                {
                    value["mime_type"] = mime;
                }
                value
            } else {
                value.clone()
            };
        }
    }
    let mut extra = json!({});
    for (from, to) in [
        ("duration", "duration"),
        ("ratio", "ratio"),
        ("resolution", "resolution"),
        ("watermark", "watermark"),
        ("generateAudio", "generate_audio"),
    ] {
        if let Some(value) = options.get(from) {
            extra[to] = value.clone();
        }
    }
    if let Some(references) = options.get("references").and_then(Value::as_array) {
        let mut content = Vec::new();
        for reference in references {
            let kind = reference["type"]
                .as_str()
                .filter(|v| ["image", "video", "audio"].contains(v))
                .ok_or_else(|| AdapterError::invalid_input("Invalid video reference"))?;
            let url = reference["url"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| {
                    reference["data"].as_str().map(|data| {
                        if data.starts_with("data:") {
                            data.into()
                        } else {
                            format!(
                                "data:{};base64,{data}",
                                reference["mimeType"].as_str().unwrap_or(match kind {
                                    "image" => "image/png",
                                    "audio" => "audio/mpeg",
                                    _ => "video/mp4",
                                })
                            )
                        }
                    })
                })
                .ok_or_else(|| AdapterError::invalid_input("Video reference is empty"))?;
            let mut item = json!({"type":format!("{kind}_url"),"role":format!("reference_{kind}")});
            item[format!("{kind}_url")] = json!({"url":url});
            content.push(item);
        }
        if !content.is_empty() {
            extra["content"] = json!(content);
        }
    }
    if job.params["providerOptions"]["deepchatBodyShape"] == "flat-top-level" {
        if extra.get("duration").is_none() {
            if let Some(seconds) = options["seconds"]
                .as_str()
                .and_then(|v| v.parse::<i64>().ok())
            {
                extra["duration"] = json!(seconds.max(-1));
            }
        }
        body.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
    } else if !extra.as_object().unwrap().is_empty() {
        body["extra_body"] = extra;
    }
    Ok(body)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn failed() -> AdapterError {
    AdapterError::provider_error("Native desktop video operation failed")
}
