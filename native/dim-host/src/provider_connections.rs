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
            let reference = credential_reference.as_deref().unwrap_or_default();
            let preset = if reference.starts_with("deepchat/codex/v1/") {
                OAuthPreset::Codex
            } else if reference.starts_with("deepchat/grok/v1/") {
                OAuthPreset::Grok
            } else {
                return Ok(connection);
            };
            let auth = credential(&provider_id, &model_id, None, cancel).await?;
            if let Some(auth) = auth {
                return attach(provider_id, model_id, connection, preset, auth);
            }
            if preset == OAuthPreset::Grok
                && matches!(&connection.connection, ModelConnection::Http(http)
                    if http.bearer.as_deref().is_some_and(|value| value != "deepchat-grok-admission-v1"))
            {
                return Ok(connection);
            }
            Err(unavailable())
        })
    }
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
enum OAuthPreset {
    #[serde(rename = "openai-codex")]
    Codex,
    #[serde(rename = "xai-grok")]
    Grok,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Auth {
    preset: OAuthPreset,
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
    preset: OAuthPreset,
    auth: Auth,
) -> Result<ResolvedModelConnection, HostError> {
    if auth.preset != preset
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
    match preset {
        OAuthPreset::Codex if http.protocol == ModelProtocol::OpenaiResponses => {
            http.preset = Some("openai-codex".into());
            configure_codex_headers(&mut http.headers, auth.account_id);
        }
        OAuthPreset::Grok if http.protocol == ModelProtocol::OpenaiCompatible => {
            let url = url::Url::parse(&http.base_url).map_err(|_| unavailable())?;
            if url.scheme() != "https"
                || !url
                    .host_str()
                    .is_some_and(|host| host == "x.ai" || host.ends_with(".x.ai"))
            {
                return Err(unavailable());
            }
            http.headers
                .retain(|name, _| !name.eq_ignore_ascii_case("authorization"));
        }
        _ => return Err(unavailable()),
    }
    http.bearer = Some(auth.bearer);
    http.api_key = None;
    connection.recovery = Some(Arc::new(Recovery {
        provider_id,
        model_id,
        connection: connection.connection.clone(),
        preset,
        lease: auth.lease,
    }));
    Ok(connection)
}

fn configure_codex_headers(
    headers: &mut std::collections::HashMap<String, String>,
    account_id: Option<String>,
) {
    headers.retain(|name, _| {
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
    headers.insert("Version".into(), "0.144.1".into());
    if let Some(id) = account_id {
        headers.insert("ChatGPT-Account-Id".into(), id);
    }
    headers.insert("OAI-Product-Sku".into(), "codex".into());
    headers.insert("originator".into(), "codex_cli_rs".into());
    headers.insert(
        "User-Agent".into(),
        "codex_cli_rs/0.144.1 (Ubuntu 22.4.0; x86_64) xterm-256color".into(),
    );
}
struct Recovery {
    provider_id: String,
    model_id: String,
    connection: ModelConnection,
    preset: OAuthPreset,
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
                self.preset,
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

#[cfg(test)]
mod tests {
    use super::*;
    use dim_agent_capabilities::host::HttpModelConnection;

    #[test]
    fn grok_oauth_replaces_the_bearer_only_on_trusted_https() {
        let connect = |base_url: &str| {
            let token = "fixture-oauth";
            attach(
                "grok".into(),
                "fixture".into(),
                ResolvedModelConnection {
                    connection: ModelConnection::Http(HttpModelConnection {
                        protocol: ModelProtocol::OpenaiCompatible,
                        base_url: base_url.into(),
                        network: Default::default(),
                        headers: Default::default(),
                        bearer: Some("deepchat-grok-admission-v1".into()),
                        api_key: None,
                        preset: None,
                    }),
                    failure_policy: None,
                    recovery: None,
                },
                OAuthPreset::Grok,
                Auth {
                    preset: OAuthPreset::Grok,
                    bearer: token.into(),
                    account_id: None,
                    lease: format!("{:x}", Sha256::digest(token.as_bytes())),
                },
            )
        };
        let resolved = connect("https://api.x.ai/v1").expect("trusted Grok endpoint");
        let ModelConnection::Http(http) = resolved.connection else {
            panic!("expected HTTP connection")
        };
        assert_eq!(http.bearer.as_deref(), Some("fixture-oauth"));
        assert!(resolved.recovery.is_some());
        assert!(connect("https://api.x.ai.example.com/v1").is_err());
        assert!(connect("http://api.x.ai/v1").is_err());
    }
}
