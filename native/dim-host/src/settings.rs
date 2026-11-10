use dim_agent_capabilities::{
    host::ModelSelectionHost,
    methods::{Interruption, MethodCall, MethodDecl, RpcError, SessionMethods, params, reply},
    prompt_state::PromptSnapshot,
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, ConfigureOutcome, ConfigureUpdate, Names, SessionConfig};
use dim_agent_types::{ModelConfig, ModelId, ModelSelection};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(
        dim_agent_runtime::Feature::new("DeepChatNativeSettings")
            .session("DeepChatNativeSettings", |names| {
                Ok(Box::new(Settings::new(names)?))
            }),
    );
}
struct Settings {
    tree: Key<TreeCommands>,
    methods: Key<SessionMethods>,
    selection: Key<ModelSelectionHost>,
    creation: Key<SessionConfig>,
}
impl Settings {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tree: names.key()?,
            methods: names.key()?,
            selection: names.key()?,
            creation: names.key()?,
        })
    }
}
impl DynPlugin for Settings {
    fn name(&self) -> &str {
        "DeepChatNativeSettings"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.tree.erase(),
            self.methods.erase(),
            self.selection.erase(),
            self.creation.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tree = ctx.require_at(&self.tree)?;
            let methods = ctx.require_at(&self.methods)?;
            let selection = ctx.require_at(&self.selection)?;
            let creation = ctx.require_at(&self.creation)?;
            methods.register(
                ctx,
                "session.deepchat_native",
                vec![
                    MethodDecl::new(
                        "session.deepchat_native.identity",
                        false,
                        Interruption::Report,
                    ),
                    MethodDecl::new(
                        "session.deepchat_native.settings",
                        false,
                        Interruption::Report,
                    ),
                    MethodDecl::new(
                        "session.deepchat_native.configure",
                        true,
                        Interruption::Report,
                    ),
                ],
                Arc::new(move |call, cancel, _| {
                    let tree = tree.clone();
                    let selection = selection.clone();
                    let creation = creation.clone();
                    Box::pin(async move {
                        let MethodCall {
                            method,
                            params: value,
                            ..
                        } = call;
                        #[derive(Deserialize)]
                        #[serde(rename_all = "camelCase", deny_unknown_fields)]
                        struct Params {
                            #[serde(rename = "sessionId")]
                            _session_id: String,
                            branch_id: String,
                            #[serde(default)]
                            config: Option<ModelConfig>,
                            #[serde(default)]
                            replace: bool,
                            #[serde(default)]
                            expected_model: Option<ModelId>,
                            #[serde(default)]
                            limits: Option<Limits>,
                            #[serde(default)]
                            product_permission_mode: Option<String>,
                            #[serde(default)]
                            media_options: Option<Value>,
                        }
                        let p: Params = params(value)?;
                        let branch = tree.get(&p.branch_id)?;
                        if method.ends_with(".identity") {
                            return reply(json!({"cwd":creation.cwd,"tools":creation.tools}));
                        }
                        let current = branch
                            .get::<PromptSnapshot>()
                            .and_then(|state| state.configuration)
                            .ok_or_else(|| {
                                RpcError::invalid("No native model configuration is adopted")
                            })?;
                        if method.ends_with(".settings") {
                            return reply(current);
                        }
                        if p.expected_model.is_some_and(|target| {
                            target.provider_id != current.provider_id
                                || target.model_id != current.model_id
                        }) {
                            return Err(RpcError::service(
                                "configuration_superseded",
                                "Native model selection changed",
                            ));
                        }
                        let mut capabilities = current.capability_snapshot;
                        if let Some(limits) = p.limits {
                            if limits.context_window == 0 || limits.max_output_tokens == 0 {
                                return Err(RpcError::invalid(
                                    "Native model limits must be positive",
                                ));
                            }
                            let baseline = selection
                                .0
                                .resolve(
                                    Some(ModelId {
                                        provider_id: current.provider_id.clone(),
                                        model_id: current.model_id.clone(),
                                    }),
                                    None,
                                    cancel,
                                )
                                .await
                                .map_err(|_| {
                                    RpcError::service(
                                        "model_unavailable",
                                        "Cannot resolve native model limits",
                                    )
                                })?;
                            let mut snapshot = baseline.capability_snapshot.ok_or_else(|| {
                                RpcError::invalid("Native model limits are unavailable")
                            })?;
                            snapshot.capabilities.context_window = snapshot
                                .capabilities
                                .context_window
                                .min(limits.context_window);
                            snapshot.capabilities.max_output_tokens = snapshot
                                .capabilities
                                .max_output_tokens
                                .min(limits.max_output_tokens);
                            capabilities = Some(snapshot);
                        }
                        let patch = p.config.ok_or_else(|| {
                            RpcError::invalid("A model configuration patch is required")
                        })?;
                        let base = current.config.unwrap_or_default();
                        let base = if p.replace {
                            ModelConfig {
                                max_tokens: base.max_tokens,
                                ..Default::default()
                            }
                        } else {
                            base
                        };
                        let config = merge(base, patch)?;
                        let mut metadata = current.metadata;
                        if let Some(options) = p.media_options {
                            if !options.is_object() || options.to_string().len() > 64 * 1024 {
                                return Err(RpcError::invalid(
                                    "Invalid media conversation options",
                                ));
                            }
                            metadata
                                .get_or_insert_with(Default::default)
                                .extensions
                                .insert("deepchatMedia".into(), options);
                        }
                        if let Some(mode) = p.product_permission_mode {
                            if !["default", "auto_approve", "full_access"].contains(&mode.as_str())
                            {
                                return Err(RpcError::invalid("Invalid product permission mode"));
                            }
                            metadata
                                .get_or_insert_with(Default::default)
                                .extensions
                                .insert("deepchatPermissionMode".into(), json!(mode));
                        }
                        let outcome = branch
                            .configure(ConfigureUpdate {
                                model: Some(ModelSelection {
                                    provider_id: current.provider_id,
                                    model_id: current.model_id,
                                    capability_snapshot: capabilities,
                                    metadata,
                                    config: Some(config),
                                }),
                                ..Default::default()
                            })
                            .await?;
                        if outcome == ConfigureOutcome::Superseded {
                            return Err(RpcError::service(
                                "configuration_superseded",
                                "Native configuration was superseded",
                            ));
                        }
                        reply(json!({"adopted": true}))
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Limits {
    context_window: u64,
    max_output_tokens: u64,
}

/// Merge only fields understood by the pinned native ModelConfig.
pub fn merge(base: ModelConfig, patch: ModelConfig) -> Result<ModelConfig, RpcError> {
    validate(&patch)?;
    let mut value = serde_json::to_value(base)
        .map_err(|_| RpcError::invalid("Cannot encode model configuration"))?;
    let Value::Object(fields) = serde_json::to_value(patch)
        .map_err(|_| RpcError::invalid("Cannot encode model configuration"))?
    else {
        unreachable!()
    };
    for (name, field) in fields {
        value
            .as_object_mut()
            .expect("ModelConfig")
            .insert(name, field);
    }
    let merged = serde_json::from_value(value)
        .map_err(|_| RpcError::invalid("Invalid model configuration"))?;
    validate(&merged)?;
    Ok(merged)
}

pub fn validate(config: &ModelConfig) -> Result<(), RpcError> {
    if config
        .temperature
        .is_some_and(|value| !value.is_finite() || !(0.0..=2.0).contains(&value))
        || config
            .top_p
            .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        || config
            .max_tokens
            .is_some_and(|value| !value.is_finite() || value <= 0.0 || value.fract() != 0.0)
    {
        return Err(RpcError::invalid("Invalid generation parameter"));
    }
    Ok(())
}
