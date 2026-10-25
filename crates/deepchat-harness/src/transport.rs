use super::{Json, Result, MAX_FRAME, MAX_MEMORY_FRAME, MEMORY_FRAME_FLAG};
use std::sync::Arc;
use tokio::{
    io::AsyncWriteExt,
    sync::{mpsc, OwnedSemaphorePermit, Semaphore},
};

const BUFFER_BYTES: usize = 1024 * 1024;
const CONTROL_BYTES: usize = MAX_FRAME + 4;

struct Frame {
    bytes: Vec<u8>,
    vector: bool,
    _permit: OwnedSemaphorePermit,
}

#[derive(Clone)]
pub struct Output {
    control: mpsc::Sender<Frame>,
    data: mpsc::Sender<Frame>,
    control_bytes: Arc<Semaphore>,
    data_bytes: Arc<Semaphore>,
}

pub struct Responses {
    control: mpsc::Receiver<Frame>,
    data: mpsc::Receiver<Frame>,
}

impl Output {
    pub fn channel() -> (Self, Responses) {
        let (control, control_rx) = mpsc::channel(64);
        let (data, data_rx) = mpsc::channel(32);
        (
            Self {
                control,
                data,
                control_bytes: Arc::new(Semaphore::new(CONTROL_BYTES)),
                data_bytes: Arc::new(Semaphore::new(BUFFER_BYTES - CONTROL_BYTES)),
            },
            Responses {
                control: control_rx,
                data: data_rx,
            },
        )
    }

    pub async fn send(&self, value: Json) -> Result<()> {
        self.send_frame(value, true).await
    }

    pub async fn send_frame(&self, value: Json, control: bool) -> Result<()> {
        let max = if control { MAX_FRAME } else { MAX_MEMORY_FRAME };
        let (sender, quota) = if control {
            (&self.control, &self.control_bytes)
        } else {
            (&self.data, &self.data_bytes)
        };
        let mut permit = quota.clone().acquire_many_owned((max + 4) as u32).await?;
        let vector = value["type"] == "memoryReply";
        let mut bytes = serde_json::to_vec(&value)?;
        if vector && bytes.len() > max {
            bytes = serde_json::to_vec(&serde_json::json!({
                "type": "memoryReply", "id": value["id"],
                "error": { "name": "MemoryVectorResponseLimitError", "message": "Memory vector response exceeds the frame limit" }
            }))?;
        }
        if bytes.is_empty() || bytes.len() > max {
            return Err("Harness response exceeds frame limit".into());
        }
        let retained = permit
            .split(bytes.len() + 4)
            .ok_or("Invalid output byte quota")?;
        drop(permit);
        sender
            .send(Frame {
                bytes,
                vector,
                _permit: retained,
            })
            .await
            .map_err(|_| "Harness output closed".into())
    }
}

pub async fn write_responses(mut responses: Responses) -> Result<()> {
    let mut output = tokio::io::stdout();
    loop {
        let frame = tokio::select! {
            biased;
            frame = responses.control.recv() => frame,
            frame = responses.data.recv() => frame,
        };
        let Some(frame) = frame else {
            return Ok(());
        };
        output
            .write_u32(frame.bytes.len() as u32 | if frame.vector { MEMORY_FRAME_FLAG } else { 0 })
            .await?;
        output.write_all(&frame.bytes).await?;
        output.flush().await?;
    }
}
