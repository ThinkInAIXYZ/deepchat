/// An embedding product may supply connection metadata and credential recovery.
/// The native resolver has already authorized and assembled the base connection.
pub trait PrepareProviderConnection: Send + Sync + 'static {
    fn prepare(
        &self,
        provider_id: String,
        model_id: String,
        credential_reference: Option<String>,
        connection: dim_agent_capabilities::host::ResolvedModelConnection,
        cancel: tokio_util::sync::CancellationToken,
    ) -> dim_agent_capabilities::host::HostFuture<
        '_,
        dim_agent_capabilities::host::ResolvedModelConnection,
    >;
}

pub struct ProviderConnectionHost(pub std::sync::Arc<dyn PrepareProviderConnection>);
