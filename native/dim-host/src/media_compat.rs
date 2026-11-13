//! Desktop-only wire protocols. Modality remains the task, file and recovery owner.
use crate::video_compat;
use aimux_core::{AbortSignal, AiMuxError};
use aimux_provider_utils::{
    get_from_api, post_json_to_api,
    response_handler::{
        ResponseHandler, ResponseHandlerInput, ResponseHandlerOutput,
        create_status_code_error_response_handler,
    },
};
use base64::{Engine, engine::general_purpose::STANDARD};
use dim_agent_capabilities::host::{ModalityConnection, ModelConnection};
use dim_modality::{AdapterError, AdapterOperation, AdapterOutput, Job, JobFile, Submitted};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

const PREFIX: &str = "deepchat-media/v1:";
const MAX_BYTES: usize = 256 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind")]
enum Handle {
    Voice {
        output: AdapterOutput,
    },
    Apimart {
        job: Job,
        id: String,
        started_at: u64,
    },
}
pub fn supports(vendor: &str) -> bool {
    matches!(vendor, "voiceai" | "apimart")
}
pub fn handles(handle: Option<&str>) -> bool {
    handle.is_some_and(|s| s.starts_with(PREFIX))
}
pub fn operations(vendor: &str) -> Vec<AdapterOperation> {
    let pairs: &[(&str, &str, &str)] = if vendor == "voiceai" {
        &[("speech", "synthesize", "text")]
    } else {
        &[
            ("image", "generate", "prompt"),
            ("video", "generate", "prompt"),
        ]
    };
    pairs
        .iter()
        .map(|(category, operation, field)| AdapterOperation {
            category: (*category).into(),
            operation: (*operation).into(),
            params_schema: json!({"type":"object","required":[field],"properties":{
                *field: {"type":"string","minLength":1},
                "voice":{"type":"string"}, "outputFormat":{"type":"string"},
                "size":{"type":"string"}, "aspectRatio":{"type":"string"},
                "durationSeconds":{"type":"number","exclusiveMinimum":0},
                "resolution":{"type":"string"}, "generateAudio":{"type":"boolean"},
                "providerOptions":{"type":"object"}
            }}),
        })
        .collect()
}
pub async fn submit(
    job: Job,
    config: Value,
    connection: ModalityConnection,
    cancel: CancellationToken,
) -> Result<Submitted, AdapterError> {
    let handle = match job.model.provider_id.as_str() {
        "voiceai" if job.category == "speech" && job.operation == "synthesize" => {
            let body = voice_body(&job, &config["voice"])?;
            let endpoint = format!(
                "{}/api/v1/tts/speech",
                base(&connection)?.trim_end_matches("/api/v1")
            );
            let output = voice_request(&job, &connection, &endpoint, body, &cancel).await?;
            Handle::Voice { output }
        }
        "apimart"
            if matches!(job.category.as_str(), "image" | "video")
                && job.operation == "generate" =>
        {
            let route = &config["route"];
            let endpoint = route["endpoint"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("/v1/{}s/generations", job.category));
            if !endpoint.starts_with('/')
                || endpoint.starts_with("//")
                || endpoint.contains(['?', '#', '\\'])
                || endpoint.split('/').any(|part| matches!(part, "." | ".."))
                || !endpoint.ends_with(&format!("/{}s/generations", job.category))
            {
                return Err(AdapterError::invalid_input(
                    "Invalid APIMart media endpoint",
                ));
            }
            let root = base(&connection)?;
            let endpoint = if let Some(tail) = endpoint.strip_prefix("/v1/") {
                format!("{}/{}", versioned(&root), tail)
            } else {
                format!("{}{}", versioned(&root), endpoint)
            };
            let body = apimart_body(&job, route)?;
            let reply = video_compat::exchange(&connection, &endpoint, Some(body), &cancel).await?;
            let task = task_record(&reply);
            let id = task
                .get("task_id")
                .or_else(|| task.get("id"))
                .and_then(Value::as_str)
                .filter(|id| {
                    !id.is_empty()
                        && id.len() <= 256
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                })
                .ok_or_else(|| {
                    AdapterError::provider_error("APIMart response has no valid task id")
                })?
                .to_owned();
            Handle::Apimart {
                job,
                id,
                started_at: now(),
            }
        }
        _ => {
            return Err(AdapterError::invalid_input(
                "Unsupported desktop media operation",
            ));
        }
    };
    Ok(Submitted {
        remote_handle: Some(format!(
            "{PREFIX}{}",
            serde_json::to_string(&handle).map_err(|_| failed())?
        )),
    })
}
pub async fn wait(
    handle: &str,
    connection: ModalityConnection,
    cancel: CancellationToken,
) -> Result<AdapterOutput, AdapterError> {
    let handle: Handle = serde_json::from_str(handle.strip_prefix(PREFIX).unwrap_or_default())
        .map_err(|_| failed())?;
    match handle {
        Handle::Voice { output } => Ok(output),
        Handle::Apimart {
            job,
            id,
            started_at,
        } => loop {
            if now().saturating_sub(started_at) >= 3600 {
                return Err(AdapterError::provider_error(
                    "APIMart task exceeded one hour",
                ));
            }
            let reply = video_compat::exchange(
                &connection,
                &format!("/tasks/{id}?language=en"),
                None,
                &cancel,
            )
            .await?;
            let task = task_record(&reply);
            match task["status"]
                .as_str()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .as_str()
            {
                "completed" | "succeeded" | "success" => {
                    let result = &task["result"];
                    let mut urls = Vec::new();
                    for key in [
                        format!("{}s", job.category),
                        job.category.clone(),
                        "url".into(),
                    ] {
                        collect_urls(&result[&key], &mut urls);
                    }
                    let mut seen = std::collections::HashSet::new();
                    urls.retain(|url| seen.insert(url.clone()));
                    if urls.is_empty() || urls.len() > 16 {
                        return Err(AdapterError::provider_error(
                            "APIMart completed without bounded media output",
                        ));
                    }
                    let mut files = Vec::new();
                    for (index, url) in urls.iter().enumerate() {
                        files.push(
                            download(&job, &connection, url, &job.category, index, &cancel).await?,
                        );
                    }
                    return Ok(AdapterOutput { files, data: None });
                }
                "failed" | "error" | "cancelled" | "canceled" => {
                    return Err(AdapterError::provider_error("APIMart media task failed"));
                }
                _ => tokio::select! {
                    _ = cancel.cancelled() => return Err(AdapterError::unavailable("Desktop media wait cancelled")),
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                },
            }
        },
    }
}
fn base(connection: &ModalityConnection) -> Result<String, AdapterError> {
    let ModelConnection::Http(http) = &connection.resolved.connection else {
        return Err(failed());
    };
    Ok(http.base_url.trim_end_matches('/').to_owned())
}
fn versioned(root: &str) -> String {
    if root.ends_with("/v1") {
        root.into()
    } else {
        format!("{root}/v1")
    }
}
fn voice_body(job: &Job, config: &Value) -> Result<Value, AdapterError> {
    let text = job.params["text"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AdapterError::invalid_input("Speech text is required"))?;
    let language = config["language"]
        .as_str()
        .unwrap_or("en")
        .trim()
        .to_ascii_lowercase();
    if ![
        "en", "ca", "sv", "es", "fr", "de", "it", "pt", "pl", "ru", "nl",
    ]
    .contains(&language.as_str())
    {
        return Err(AdapterError::invalid_input("Unsupported Voice.ai language"));
    }
    let mut body = json!({"text":text,"model":config["model"].as_str().filter(|s| !s.is_empty()).unwrap_or("voiceai-tts-v1-latest"),
        "audio_format":job.params["outputFormat"].as_str().or(config["audioFormat"].as_str()).unwrap_or("mp3"),
        "language":language,"temperature":job.params["temperature"].as_f64().or(config["temperature"].as_f64()).unwrap_or(1.),"top_p":config["topP"].as_f64().unwrap_or(0.8)});
    let voice = job.params["voice"].as_str().unwrap_or(&job.model.model_id);
    if voice != "default" && !voice.is_empty() {
        body["voice_id"] = json!(voice);
    }
    Ok(body)
}
fn apimart_body(job: &Job, route: &Value) -> Result<Value, AdapterError> {
    let prompt = job.params["prompt"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AdapterError::invalid_input("Media prompt is required"))?;
    let allows = |name: &str| {
        route["parameterNames"]
            .as_array()
            .is_some_and(|names| names.iter().any(|v| v.as_str() == Some(name)))
    };
    let mut body = json!({"model":job.model.model_id,"prompt":prompt});
    if job.category == "image" {
        if allows("size") {
            if let Some(value) = job.params["size"].as_str().and_then(aspect_ratio) {
                body["size"] = json!(value);
            }
        }
        for (from, to) in [
            ("quality", "quality"),
            ("outputCompression", "output_compression"),
            ("background", "background"),
            ("moderation", "moderation"),
        ] {
            if allows(to) {
                if let Some(value) = job.params["providerOptions"].get(from) {
                    body[to] = value.clone();
                }
            }
        }
        if allows("output_format") {
            if let Some(value) = job.params.get("outputFormat") {
                body["output_format"] = value.clone();
            }
        }
    } else {
        let options = &job.params["providerOptions"]["deepchat"];
        if let Some(duration) = options["duration"]
            .as_f64()
            .or_else(|| options["seconds"].as_str().and_then(|s| s.parse().ok()))
            .or_else(|| job.params["durationSeconds"].as_f64())
        {
            if allows("duration") {
                body["duration"] = json!(duration);
            } else if allows("seconds") {
                body["seconds"] = json!(duration.to_string());
            }
        }
        let ratio = options["ratio"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| options["size"].as_str().and_then(aspect_ratio))
            .or_else(|| job.params["aspectRatio"].as_str().map(str::to_owned));
        if let Some(ratio) = ratio {
            if let Some(name) = ["aspect_ratio", "ratio", "size"]
                .into_iter()
                .find(|name| allows(name))
            {
                body[name] = json!(ratio);
            }
        } else if allows("size") {
            if let Some(value) = options.get("size") {
                body["size"] = value.clone();
            }
        }
        for (from, to) in [
            ("resolution", "resolution"),
            ("watermark", "watermark"),
            ("generateAudio", "generate_audio"),
        ] {
            if allows(to) {
                if let Some(value) = options.get(from).or_else(|| job.params.get(from)) {
                    body[to] = value.clone();
                }
            }
        }
        let mut images = Vec::new();
        let mut videos = Vec::new();
        let mut audios = Vec::new();
        if let Some(reference) = options.get("inputReference") {
            if let Some(reference) = reference_value(reference) {
                images.push(reference);
            }
        }
        for reference in options["references"].as_array().into_iter().flatten() {
            if let Some(value) = reference_value(reference) {
                match reference["type"].as_str() {
                    Some("image") => images.push(value),
                    Some("video") => videos.push(value),
                    Some("audio") => audios.push(value),
                    _ => {}
                }
            }
        }
        for (name, values) in [
            ("image_urls", images),
            ("video_urls", videos),
            ("audio_urls", audios),
        ] {
            if allows(name) && !values.is_empty() {
                body[name] = json!(values);
            }
        }
    }
    Ok(body)
}
fn reference_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.into());
    }
    let data = value
        .get("url")
        .or_else(|| value.get("data"))
        .and_then(Value::as_str)?;
    if data.starts_with("data:") || data.starts_with("https://") || data.starts_with("http://") {
        return Some(data.into());
    }
    value["mimeType"]
        .as_str()
        .map(|mime| format!("data:{mime};base64,{data}"))
}
fn aspect_ratio(value: &str) -> Option<String> {
    if value.contains(':') {
        return Some(value.into());
    }
    let (a, b) = value.split_once('x')?;
    let (mut a, mut b) = (a.parse::<u32>().ok()?, b.parse::<u32>().ok()?);
    if a == 0 || b == 0 {
        return None;
    }
    let (width, height) = (a, b);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    Some(format!("{}:{}", width / a, height / a))
}
fn task_record(reply: &Value) -> &Value {
    match reply.get("data") {
        Some(Value::Array(items)) => items.first().unwrap_or(reply),
        Some(data) if data.is_object() => data,
        _ => reply,
    }
}
fn collect_urls(value: &Value, output: &mut Vec<String>) {
    if output.len() > 16 {
        return;
    }
    match value {
        Value::String(url) => output.push(url.clone()),
        Value::Array(items) => {
            for item in items {
                collect_urls(item, output);
            }
        }
        Value::Object(items) => {
            for key in ["url", "urls", "uri", "image_url", "video_url"] {
                if let Some(value) = items.get(key) {
                    collect_urls(value, output);
                }
            }
        }
        _ => {}
    }
}
enum SpeechResponse {
    Json(Value),
    File(JobFile),
}
async fn voice_request(
    job: &Job,
    connection: &ModalityConnection,
    endpoint: &str,
    body: Value,
    cancel: &CancellationToken,
) -> Result<AdapterOutput, AdapterError> {
    let signal = AbortSignal::new();
    let request = video_compat::request(connection, endpoint, &signal)?;
    let owned = job.clone();
    let fallback = match body["audio_format"].as_str() {
        Some("wav") => "audio/wav",
        Some("pcm") => "audio/pcm",
        _ => "audio/mpeg",
    }
    .to_owned();
    let fallback_response = fallback.clone();
    let handler = ResponseHandler::new(move |input| async move {
        let media_type = input
            .response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let value = if media_type.contains("application/json") {
            let mut bytes = Vec::new();
            let mut stream = input.response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| AiMuxError::other("Speech response interrupted"))?;
                if bytes.len().saturating_add(chunk.len()) > MAX_BYTES * 4 / 3 + 1024 * 1024 {
                    return Err(AiMuxError::other("Speech response is too large"));
                }
                bytes.extend_from_slice(&chunk);
            }
            SpeechResponse::Json(
                serde_json::from_slice(&bytes)
                    .map_err(|_| AiMuxError::other("Invalid speech response"))?,
            )
        } else {
            SpeechResponse::File(
                write_response(input, &owned, "speech", 0, &fallback_response).await?,
            )
        };
        Ok(ResponseHandlerOutput {
            value,
            raw_value: None,
            response_headers: Default::default(),
        })
    });
    let run = post_json_to_api(
        request,
        body,
        handler,
        create_status_code_error_response_handler(),
    );
    tokio::pin!(run);
    let response = tokio::select! { result = &mut run => result, _ = cancel.cancelled() => { signal.abort(); run.await } }.map_err(|_| failed())?.value;
    let file = match response {
        SpeechResponse::File(file) => file,
        SpeechResponse::Json(value) => {
            let audio = value
                .get("audio")
                .filter(|value| value.is_object())
                .unwrap_or(&value);
            let mime = ["mime_type", "content_type", "contentType"]
                .into_iter()
                .find_map(|key| audio[key].as_str())
                .or_else(|| {
                    ["mime_type", "content_type", "contentType"]
                        .into_iter()
                        .find_map(|key| value[key].as_str())
                })
                .unwrap_or(&fallback);
            let data = [
                "base64",
                "data",
                "audio_base64",
                "audioBase64",
                "audio",
                "url",
                "audio_url",
                "audioUrl",
            ]
            .into_iter()
            .find_map(|key| audio[key].as_str())
            .ok_or_else(failed)?;
            if data.starts_with("https://") || data.starts_with("http://") {
                download(job, connection, data, "speech", 0, cancel).await?
            } else {
                let (mime, data) = if let Some(uri) = data.strip_prefix("data:") {
                    uri.split_once(";base64,").ok_or_else(failed)?
                } else {
                    (mime, data)
                };
                if !mime.starts_with("audio/") || data.len() > MAX_BYTES * 4 / 3 + 4 {
                    return Err(failed());
                }
                let bytes = STANDARD.decode(data).map_err(|_| failed())?;
                if bytes.is_empty() || bytes.len() > MAX_BYTES {
                    return Err(failed());
                }
                let (name, media_type) = filename("speech", 0, mime);
                let path = job.work_dir.join(&name);
                tokio::fs::write(&path, bytes).await.map_err(|_| failed())?;
                JobFile {
                    name,
                    media_type,
                    path,
                }
            }
        }
    };
    Ok(AdapterOutput {
        files: vec![file],
        data: None,
    })
}
fn filename(category: &str, index: usize, media_type: &str) -> (String, String) {
    let media_type = media_type.split(';').next().unwrap_or_default().trim();
    let (ext, mime) = match media_type {
        "image/jpeg" | "image/jpg" => ("jpg", "image/jpeg"),
        "image/webp" => ("webp", "image/webp"),
        "image/gif" => ("gif", "image/gif"),
        "image/png" => ("png", "image/png"),
        "audio/wav" | "audio/x-wav" => ("wav", "audio/wav"),
        "audio/pcm" => ("pcm", "audio/pcm"),
        "audio/ogg" | "audio/opus" => ("ogg", "audio/ogg"),
        "audio/flac" => ("flac", "audio/flac"),
        "audio/aac" => ("aac", "audio/aac"),
        "audio/mp4" => ("m4a", "audio/mp4"),
        "audio/webm" => ("webm", "audio/webm"),
        "audio/mpeg" | "audio/mp3" => ("mp3", "audio/mpeg"),
        "video/webm" => ("webm", "video/webm"),
        "video/mp4" => ("mp4", "video/mp4"),
        _ => match category {
            "image" => ("png", "image/png"),
            "speech" => ("mp3", "audio/mpeg"),
            _ => ("mp4", "video/mp4"),
        },
    };
    (format!("{category}-{index}.{ext}"), mime.into())
}
async fn write_response(
    input: ResponseHandlerInput,
    job: &Job,
    category: &str,
    index: usize,
    fallback: &str,
) -> Result<JobFile, AiMuxError> {
    let response = input.response;
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .filter(|mime| {
            mime.starts_with(&format!(
                "{}/",
                if category == "speech" {
                    "audio"
                } else {
                    category
                }
            ))
        })
        .unwrap_or(fallback);
    let (name, media_type) = filename(category, index, mime);
    let path = job.work_dir.join(&name);
    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|_| AiMuxError::other("Cannot create media result"))?;
    let mut size = 0usize;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AiMuxError::other("Media response interrupted"))?;
        size = size.saturating_add(chunk.len());
        if size > MAX_BYTES {
            return Err(AiMuxError::other("Media result exceeds 256 MiB"));
        }
        file.write_all(&chunk)
            .await
            .map_err(|_| AiMuxError::other("Cannot write media result"))?;
    }
    if size == 0 {
        return Err(AiMuxError::other("Empty media output"));
    }
    file.flush()
        .await
        .map_err(|_| AiMuxError::other("Cannot flush media output"))?;
    Ok(JobFile {
        name,
        media_type,
        path,
    })
}
async fn download(
    job: &Job,
    connection: &ModalityConnection,
    url: &str,
    category: &str,
    index: usize,
    cancel: &CancellationToken,
) -> Result<JobFile, AdapterError> {
    let signal = AbortSignal::new();
    let mut request = video_compat::request(connection, url, &signal)?;
    request.validate_url = true;
    let job = job.clone();
    let category = category.to_owned();
    let handler = ResponseHandler::new(move |input| async move {
        let fallback = match category.as_str() {
            "image" => "image/png",
            "speech" => "audio/mpeg",
            _ => "video/mp4",
        };
        let file = write_response(input, &job, &category, index, fallback).await?;
        Ok(ResponseHandlerOutput {
            value: file,
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
    tokio::select! { result = &mut run => result, _ = cancel.cancelled() => { signal.abort(); run.await } }.map(|result| result.value).map_err(|_| failed())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn failed() -> AdapterError {
    AdapterError::provider_error("Desktop media provider request failed")
}
