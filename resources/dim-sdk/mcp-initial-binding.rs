/// Mount a host-owned temporary MCP selection during Session resource acquisition.
/// The returned view owns the native connections and withdraws their tool source on unload.
pub async fn mount_initial_binding(
    ctx: &Ctx,
    session: InstanceId,
    tools: Key<ToolRegistry>,
    lifecycle: Key<SessionLifecycle>,
    cwd: &str,
    mut servers: BTreeMap<String, McpServerSettings>,
) -> Result<FiberView, RpcError> {
    for (name, configuration) in &mut servers {
        if name.trim().is_empty() {
            return Err(RpcError::invalid("Empty MCP server name"));
        }
        if let McpServerSettings::Stdio { cwd: directory, .. } = configuration {
            *directory = Some(cwd.to_owned());
        }
        McpServerPlugin::new(name, temporary_expansion(configuration), Key::of())
            .map_err(|_| RpcError::invalid("Invalid temporary MCP configuration"))?;
    }
    let (ready, _) = watch::channel(None);
    dim_agent_runtime::mount_active(
        ctx,
        BindingPlugin {
            id: uuid::Uuid::new_v4(),
            session,
            servers,
            tools,
            lifecycle,
            ready,
            changed: Arc::new(Notify::new()),
            initial: true,
        },
    )
    .await
    .map_err(|_| failed())
}

fn publish_binding(
    ctx: &Ctx,
    session: InstanceId,
    prefix: &str,
    connections: &[(String, Arc<McpConnection>)],
    lists: &[Vec<super::server::McpTool>],
    sets: &Arc<Mutex<Vec<Arc<ToolSourceSet>>>>,
    stop: &tokio_util::sync::CancellationToken,
) -> Result<(), RpcError> {
    let next = connections
        .iter()
        .zip(lists)
        .map(|((id, connection), tools)| {
            Arc::new(ToolSourceSet {
                key: format!("{prefix}:{id}"),
                version: uuid::Uuid::new_v4().to_string(),
                tools: tools
                    .iter()
                    .map(|tool| contribution(id, tool, connection.clone(), stop.clone()))
                    .collect(),
            })
        })
        .collect();
    *sets.lock().unwrap() = next;
    ctx.emit(ToolProviderChanged {
        name: tool_provider_changes(session),
    })
    .map_err(|_| failed())?;
    Ok(())
}
