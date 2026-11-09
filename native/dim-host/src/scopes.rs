//! Public native owner metadata and the branch that owns one model request.
//! The desktop never opens dim's private database or infers parentage from model input.
use dim_agent_capabilities::{
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, Feature, QueryOutput, TimelineQuery};
use dim_app_server::{methods::ManagementMethods, storage::SessionStore};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

pub(crate) fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| {
        Ok(Box::new(StoredScope {
            methods: names.key()?,
        }))
    });
    builder.require_feature(Feature::new("DeepChatNativeScope").session(
        "DeepChatNativeScope",
        |names| {
            Ok(Box::new(FrameScope {
                methods: names.key()?,
                tree: names.key()?,
            }))
        },
    ));
}
struct StoredScope {
    methods: Key<ManagementMethods>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Address {
    session_id: String,
}
impl DynPlugin for StoredScope {
    fn name(&self) -> &str {
        "DeepChatStoredScope"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.methods.erase(), TypeKey::of::<SessionStore>()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let owner = ctx.require::<SessionStore>()?;
            ctx.require_at(&self.methods)?.register(ctx,"deepchat.native_scope",vec![
                MethodDecl::new("deepchat.native_scope.describe",false,Interruption::Report)
            ],Arc::new(move|call,cancel,_| {
                let owner=owner.clone();Box::pin(async move {
                    let address:Address=params(call.params)?;
                    if address.session_id.is_empty(){return Err(RpcError::invalid("Missing native scope"));}
                    let read=async {
                        let (origin,parent)=owner.creation_record(&address.session_id).await?;
                        let config=owner.timeline_store().session_config(&address.session_id).await?
                            .ok_or_else(||RpcError::closed())?;
                        let metadata=owner.metadata(&address.session_id).await
                            .map_err(|_|RpcError::service("scope_unavailable","Native title metadata is unavailable"))?;
                        reply(json!({"sessionId":address.session_id,"origin":origin,"parentSessionId":parent,
                            "cwd":config.cwd,"model":{"providerId":config.model.provider_id,"modelId":config.model.model_id},"role":config.collaboration_role,
                            "tools":config.tools,"title":metadata.title,
                            "titleRevision":metadata.revision.to_string()}))
                    };
                    tokio::select!{_=cancel.cancelled()=>Err(RpcError::interrupted()),result=read=>result}
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
struct FrameScope {
    methods: Key<SessionMethods>,
    tree: Key<TreeCommands>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    session_id: String,
    request_id: String,
    turn_id: String,
}
impl DynPlugin for FrameScope {
    fn name(&self) -> &str {
        "DeepChatFrameScope"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.methods.erase(), self.tree.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tree = ctx.require_at(&self.tree)?;
            ctx.require_at(&self.methods)?.register(ctx,"session.deepchat_scope",vec![
                MethodDecl::new("session.deepchat_scope.frame",false,Interruption::Report)
            ],Arc::new(move|call,cancel,_| {
                let tree=tree.clone();Box::pin(async move {
                    let frame:Frame=params(call.params)?;
                    if frame.session_id.is_empty()||frame.request_id.is_empty()||frame.turn_id.is_empty(){
                        return Err(RpcError::invalid("Missing native model request identity"));
                    }
                    let mut found=None;
                    for branch in tree.list() {
                        let query:TimelineQuery=serde_json::from_value(json!({
                            "scope":"branch","include_publishing":true,
                            "query":{"filter":super::facts::equal("kind",json!("step/model-start")),
                                "order_by":[{"key":{"kind":"position"},"direction":"descending"}],"select":{"kind":"events"}},
                            "page":{"limit":1}
                        })).map_err(|_|RpcError::invalid("Invalid native frame query"))?;
                        let page=tokio::select!{_=cancel.cancelled()=>return Err(RpcError::interrupted()),
                            result=tree.query(branch.id.clone(),query)=>result?};
                        let QueryOutput::Events{events}=page.result else {return Err(RpcError::service("scope_unavailable","Native frame query did not return events"));};
                        if let Some(event)=events.first() {
                            let value=serde_json::to_value(&event.event).map_err(|_|RpcError::invalid("Invalid native frame"))?;
                            if event.position.branch_id==branch.id && value["data"]["request_id"]==frame.request_id&&value["data"]["turn_id"]==frame.turn_id {
                                if found.is_some(){return Err(RpcError::service("ambiguous_scope","Native request belongs to several branches"));}
                                found=Some(json!({"branchId":branch.id,"through":page.through.to_string(),"sequence":event.event.sequence.to_string()}));
                            }
                        }
                    }
                    found.ok_or_else(||RpcError::service("scope_unavailable","Native request is no longer current"))
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
