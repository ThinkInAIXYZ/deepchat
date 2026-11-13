//! Product OAuth leases feed native connection preparation and recovery.
use dim_agent_capabilities::host::{
    CredentialRecoveryPhase, CredentialRejection, HostError, HostErrorKind, HostFuture,
    ModelConnection, ModelProtocol, RecoverModelConnection, RecoveredModelConnection,
    ResolvedModelConnection,
};
use dim_agent_runtime::AgentBuilder;
use dim_app_server::provider::{PrepareProviderConnection, ProviderConnectionHost};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub fn install(builder: &mut AgentBuilder) {
    dim_agent_runtime::names::register::<ProviderConnectionHost>(builder.catalog_mut(), None);
    builder.plugin(|names| Ok(Box::new(Connections { key: names.key()? })));
}
struct Connections {
    key: Key<ProviderConnectionHost>,
}
impl DynPlugin for Connections {
    fn name(&self) -> &str {
        "DeepChatProviderConnections"
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            ctx.provide_at(
                self.key.clone(),
                Arc::new(ProviderConnectionHost(Arc::new(Desktop))),
            )?;
            Ok(Effect::Done)
        })
    }
}
struct Desktop;
impl PrepareProviderConnection for Desktop {
    fn prepare(
        &self,
        provider_id: String,
        model_id: String,
        credential_reference: Option<String>,
        connection: ResolvedModelConnection,
        cancel: CancellationToken,
    ) -> HostFuture<'_, ResolvedModelConnection> {
        Box::pin(async move {
            if !credential_reference
                .as_deref()
                .is_some_and(|reference| reference.starts_with("deepchat/codex/v1/"))
            {
                return Ok(connection);
            }
            let auth = credential(&provider_id, &model_id, None, cancel)
                .await?
                .ok_or_else(unavailable)?;
            attach(provider_id, model_id, connection, auth)
        })
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Auth {
    preset: String,
    bearer: String,
    account_id: Option<String>,
    lease: String,
}
async fn credential(
    provider: &str,
    model: &str,
    rejected: Option<&str>,
    cancel: CancellationToken,
) -> Result<Option<Auth>, HostError> {
    let mut request = json!({"kind":"model_connection", "providerId":provider, "modelId":model});
    if let Some(lease) = rejected {
        request["rejectedLease"] = json!(lease);
    }
    let reply = super::gateway::request(request, cancel, 64 * 1024).await?;
    serde_json::from_value(reply).map_err(|_| unavailable())
}
fn attach(
    provider_id: String,
    model_id: String,
    mut connection: ResolvedModelConnection,
    auth: Auth,
) -> Result<ResolvedModelConnection, HostError> {
    if auth.preset != "openai-codex"
        || auth.bearer.is_empty()
        || auth.bearer.len() > 32 * 1024
        || !auth
            .bearer
            .bytes()
            .all(|byte| (0x21..=0x7e).contains(&byte))
        || auth.lease != format!("{:x}", Sha256::digest(auth.bearer.as_bytes()))
        || auth.account_id.as_ref().is_some_and(|id| {
            id.is_empty() || id.len() > 256 || !id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
        })
    {
        return Err(unavailable());
    }
    let ModelConnection::Http(http) = &mut connection.connection else {
        return Err(unavailable());
    };
    if http.protocol != ModelProtocol::OpenaiResponses {
        return Err(unavailable());
    }
    http.preset = Some(auth.preset);
    http.bearer = Some(auth.bearer);
    http.api_key = None;
    http.headers.retain(|name, _| {
        ![
            "chatgpt-account-id",
            "authorization",
            "oai-product-sku",
            "originator",
            "version",
            "user-agent",
        ]
        .iter()
        .any(|controlled| name.eq_ignore_ascii_case(controlled))
    });
    http.headers.insert("Version".into(), "0.144.1".into());
    if let Some(id) = auth.account_id {
        http.headers.insert("ChatGPT-Account-Id".into(), id);
    }
    http.headers
        .insert("OAI-Product-Sku".into(), "codex".into());
    http.headers
        .insert("originator".into(), "codex_cli_rs".into());
    http.headers.insert(
        "User-Agent".into(),
        "codex_cli_rs/0.144.1 (Ubuntu 22.4.0; x86_64) xterm-256color".into(),
    );
    connection.recovery = Some(Arc::new(Recovery {
        provider_id,
        model_id,
        connection: connection.connection.clone(),
        lease: auth.lease,
    }));
    Ok(connection)
}
struct Recovery {
    provider_id: String,
    model_id: String,
    connection: ModelConnection,
    lease: String,
}
impl RecoverModelConnection for Recovery {
    fn rejection(&self, error: &HostError, phase: CredentialRecoveryPhase) -> CredentialRejection {
        if !matches!(
            error,
            HostError::Failed {
                kind: HostErrorKind::Http {
                    status: Some(401),
                    ..
                },
                ..
            }
        ) {
            return CredentialRejection::Unrelated;
        }
        match phase {
            CredentialRecoveryPhase::Initial => CredentialRejection::Recoverable,
            CredentialRecoveryPhase::Recovered => CredentialRejection::Terminal,
        }
    }
    fn recover(&self, cancel: CancellationToken) -> HostFuture<'_, RecoveredModelConnection> {
        Box::pin(async move {
            let auth = credential(&self.provider_id, &self.model_id, Some(&self.lease), cancel)
                .await?
                .ok_or_else(unavailable)?;
            let next = attach(
                self.provider_id.clone(),
                self.model_id.clone(),
                ResolvedModelConnection {
                    connection: self.connection.clone(),
                    failure_policy: None,
                    recovery: None,
                },
                auth,
            )?;
            Ok(RecoveredModelConnection {
                connection: next.connection,
                recovery: next.recovery.ok_or_else(unavailable)?,
            })
        })
    }
    fn finish_rejected(&self, _cancel: CancellationToken) -> HostFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
fn unavailable() -> HostError {
    HostError::failed("Product OAuth connection is unavailable")
}
