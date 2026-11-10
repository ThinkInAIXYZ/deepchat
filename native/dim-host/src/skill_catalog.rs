//! Immutable, Session-owned product skill catalogs. Native read handles discovery
//! and pagination; the context carries only the current catalog's file pointer.
use dim_agent_capabilities::{
    host::SessionFilesHost,
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, Feature, SessionIdentity};
use rutis::{
    Ctx,
    host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub fn install(builder: &mut AgentBuilder) {
    builder.require_feature(Feature::new("DeepChatSkillCatalog").session(
        "DeepChatSkillCatalog",
        |names| {
            Ok(Box::new(Catalog {
                methods: names.key()?,
                tree: names.key()?,
                files: names.key()?,
                identity: names.key()?,
            }))
        },
    ));
}
struct Catalog {
    methods: Key<SessionMethods>,
    tree: Key<TreeCommands>,
    files: Key<SessionFilesHost>,
    identity: Key<SessionIdentity>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Publish {
    session_id: String,
    branch_id: String,
    content: String,
}
fn invalid() -> RpcError {
    RpcError::invalid("Invalid product skill catalog")
}
impl DynPlugin for Catalog {
    fn name(&self) -> &str {
        "DeepChatSkillCatalog"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![
            self.methods.erase(),
            self.tree.erase(),
            self.files.erase(),
            self.identity.erase(),
        ]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let (tree, files, identity) = (
                ctx.require_at(&self.tree)?,
                ctx.require_at(&self.files)?,
                ctx.require_at(&self.identity)?,
            );
            ctx.require_at(&self.methods)?.register(
                ctx,
                "session.deepchat_skills",
                vec![MethodDecl::new(
                    "session.deepchat_skills.catalog",
                    true,
                    Interruption::Report,
                )],
                Arc::new(move |call, cancel, _| {
                    let (tree, files, identity) = (tree.clone(), files.clone(), identity.clone());
                    Box::pin(async move {
                        let input: Publish = params(call.params)?;
                        if input.session_id != identity.session_id
                            || input.content.len() > 4 * 1024 * 1024
                        {
                            return Err(invalid());
                        }
                        let catalog: Value =
                            serde_json::from_str(&input.content).map_err(|_| invalid())?;
                        let entries = catalog.as_array().ok_or_else(invalid)?;
                        if entries.iter().any(|entry| {
                            entry.as_object().is_none_or(|object| {
                                object.len() != 4
                                    || ["name", "description", "path", "skillRoot"]
                                        .iter()
                                        .any(|field| !entry[*field].is_string())
                            })
                        }) {
                            return Err(invalid());
                        }
                        let hash = format!("{:x}", Sha256::digest(input.content.as_bytes()));
                        let name = format!("skills-{}.json", &hash[..40]);
                        let branch = tree.get(&input.branch_id)?;
                        let metadata = branch.service::<crate::inputs::DeepChatInputMetadata>()?;
                        let _lane = metadata.lane.lock().await;
                        crate::inputs::ensure_active(&metadata).await?;
                        let previous = crate::facts::events(
                            &metadata.timeline,
                            crate::facts::and(vec![
                                crate::facts::extension("skill-catalog"),
                                crate::facts::equal("data.catalogHash", json!(hash)),
                            ]),
                        )
                        .await?;
                        if let Some(event) = previous.last() {
                            let event =
                                serde_json::to_value(event.as_ref()).map_err(|_| invalid())?;
                            let id = event["data"]["fileId"].as_str().ok_or_else(invalid)?;
                            let owned = files
                                .0
                                .owned_paths(input.session_id)
                                .await
                                .map_err(|_| invalid())?;
                            let root = owned
                                .into_iter()
                                .find(|path| {
                                    path.file_name().and_then(|name| name.to_str()) == Some(id)
                                })
                                .ok_or_else(invalid)?;
                            return reply(
                                json!({"path":root.join(name),"catalogHash":hash,"fileId":id}),
                            );
                        }
                        if cancel.is_cancelled() {
                            return Err(RpcError::invalid("Skill catalog publication cancelled"));
                        }
                        let file = files
                            .0
                            .put(input.session_id, name, input.content.into_bytes(), cancel)
                            .await
                            .map_err(|_| invalid())?;
                        let data =
                            json!({"fileId":file.file_id,"catalogHash":hash,"bytes":file.bytes});
                        let event = metadata.timeline.append(
                            dim_agent_types::EventKind::Extension(
                                dim_agent_types::ExtensionEvent::new(
                                    "deepchat",
                                    "skill-catalog",
                                    data,
                                )
                                .map_err(RpcError::invalid)?,
                            )
                            .into(),
                        )?;
                        crate::facts::published(&metadata.timeline, event.sequence).await?;
                        reply(json!({"path":file.path,"catalogHash":hash,"fileId":file.file_id}))
                    })
                }),
            )?;
            Ok(Effect::Done)
        })
    }
}
