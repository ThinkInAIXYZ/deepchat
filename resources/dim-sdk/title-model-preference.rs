/// Optional host preference for the model used by this Session's title owner.
/// Native title generation, fallback and metadata publication remain with SessionTitle.
pub trait ReadTitleModelPreference: Send + Sync {
    fn model(
        &self,
        cancel: CancellationToken,
    ) -> dim_agent_capabilities::host::HostFuture<'_, Option<ModelId>>;
}
pub struct TitleModelHost(pub Arc<dyn ReadTitleModelPreference>);
struct NoTitleModelPreference;
impl ReadTitleModelPreference for NoTitleModelPreference {
    fn model(
        &self,
        _: CancellationToken,
    ) -> dim_agent_capabilities::host::HostFuture<'_, Option<ModelId>> {
        Box::pin(async { Ok(None) })
    }
}
