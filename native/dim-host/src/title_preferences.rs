//! Native SessionTitle requests the product's optional auxiliary-model preference.
use dim_agent_capabilities::host::{HostError, HostFuture};
use dim_agent_runtime::AgentBuilder;
use dim_agent_types::ModelId;
use dim_session_title::{ReadTitleModelPreference, TitleModelHost};
use serde_json::json;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub(crate) fn install(builder: &mut AgentBuilder) {
    if super::GATEWAY.get().and_then(Option::as_ref).is_some() {
        builder.replace_session_host(|identity| {
            Arc::new(TitleModelHost(Arc::new(Preference {
                session_id: identity.session_id.clone(),
            })))
        });
    }
}
struct Preference {
    session_id: String,
}
impl ReadTitleModelPreference for Preference {
    fn model(&self, cancel: CancellationToken) -> HostFuture<'_, Option<ModelId>> {
        Box::pin(async move {
            let value = super::gateway::request(
                json!({"kind":"title_model","sessionId":self.session_id}),
                cancel,
                8192,
            )
            .await?;
            serde_json::from_value(value)
                .map_err(|_| HostError::failed("Invalid title model preference"))
        })
    }
}
