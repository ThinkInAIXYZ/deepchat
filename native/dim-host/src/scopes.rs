//! Public native owner metadata and the branch that owns one model request.
//! The desktop never opens dim's private database or infers parentage from model input.
use dim_agent_capabilities::{
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{AgentBuilder, Feature, QueryOutput, TimelineQuery};
use dim_agent_types::{ContentBlock, EventKind, InputBlock};
use dim_app_server::{
    methods::ManagementMethods,
    storage::{MetadataError, SessionStore, Title, TitleSource},
};
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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SeedTitle {
    session_id: String,
    title: Title,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenameTitle {
    session_id: String,
    title: String,
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
                MethodDecl::new("deepchat.native_scope.describe",false,Interruption::Report),
                MethodDecl::new("deepchat.native_scope.rename_title",true,Interruption::Report),
                MethodDecl::new("deepchat.native_scope.seed_title",true,Interruption::Report)
            ],Arc::new(move|call,cancel,_| {
                let owner=owner.clone();Box::pin(async move {
                    if call.method.ends_with(".rename_title") {
                        let rename:RenameTitle=params(call.params)?;
                        let text=rename.title.trim();
                        if rename.session_id.is_empty() || text.is_empty() || text.len()>64*1024
                            || text.chars().any(|c|c.is_control() || matches!(c,'\u{2028}'|'\u{2029}')) {
                            return Err(RpcError::invalid("Invalid desktop title"));
                        }
                        // Preserve the desktop's existing manual-name contract independently of
                        // SessionTitle's shared length setting, using the public owner writer.
                        owner.creation_record(&rename.session_id).await?;
                        for _ in 0..=3 {
                            if cancel.is_cancelled() { return Err(RpcError::interrupted()); }
                            let stored=owner.metadata(&rename.session_id).await
                                .map_err(|_|RpcError::service("storage_failed","Cannot read native title"))?;
                            match owner.set_title(&rename.session_id,stored.revision,Some(Title{
                                text:text.to_owned(),source:TitleSource::Manual
                            })).await {
                                Ok(revision)=>return reply(json!({"revision":revision.to_string()})),
                                Err(MetadataError::Conflict)=>{},
                                Err(_)=>return Err(RpcError::service("storage_failed","Cannot rename native title")),
                            }
                        }
                        return Err(RpcError::service("title_conflict","Native title changed during rename"));
                    }
                    if call.method.ends_with(".seed_title") {
                        let seed:SeedTitle=params(call.params)?;
                        if seed.session_id.is_empty() || seed.title.text.trim().is_empty()
                            || seed.title.text.len()>64*1024 {
                            return Err(RpcError::invalid("Invalid migrated title"));
                        }
                        // The owner CAS makes recovery idempotent. Migration never overwrites
                        // an existing title, including a concurrently generated or manual one.
                        owner.creation_record(&seed.session_id).await?;
                        let stored=owner.metadata(&seed.session_id).await
                            .map_err(|_|RpcError::service("scope_unavailable","Native title metadata is unavailable"))?;
                        if stored.revision == 0 {
                            match owner.set_title(&seed.session_id,0,Some(seed.title)).await {
                                Ok(_) | Err(MetadataError::Conflict) => {},
                                Err(_) => return Err(RpcError::service("storage_failed","Cannot preserve migrated title")),
                            }
                        }
                        return reply(json!({}));
                    }
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
                            "titleRevision":metadata.revision.to_string(),
                            "ownedPaths":owner.owned_paths(&address.session_id).await?}))
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
    #[serde(default)]
    include_input: bool,
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
                                let content=accepted_content(&tree,&branch.id,&frame.turn_id,event.event.sequence,false).await?;
                                let prompt=content.iter().filter_map(|block|match block {ContentBlock::Text{text}=>Some(text.as_str()), _=>None}).collect::<Vec<_>>().join("\n");
                                let media_input=if frame.include_input {
                                    let content=accepted_content(&tree,&branch.id,&frame.turn_id,event.event.sequence,true).await?;
                                    Some(super::payload::encode(&json!({
                                    "sessionId":frame.session_id,"branchId":branch.id,"requestId":frame.request_id,
                                    "turnId":frame.turn_id,"through":event.event.sequence.to_string(),"content":content
                                })).await?) } else {None};
                                found=Some(json!({"mediaInput":media_input,"branchId":branch.id,"through":page.through.to_string(),"sequence":event.event.sequence.to_string(),
                                    "inputQuery":prompt.chars().take(16_384).collect::<String>(),
                                    "hookPromptTooLarge":prompt.len()>1024*1024,
                                    "hookPrompt":if prompt.len()<=1024*1024{Some(prompt)}else{None}}));
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

/// Read the current turn's consumed operator input at the request's fixed prefix.
/// Queued inputs, runtime envelopes and keyed environment/state blocks cannot become hook input.
async fn accepted_content(
    tree: &TreeCommands,
    branch: &str,
    turn: &str,
    through: u64,
    all: bool,
) -> Result<Vec<ContentBlock>, RpcError> {
    let latest = |filter| {
        serde_json::from_value::<TimelineQuery>(json!({
        "scope":"branch","through":through,"include_publishing":true,
        "query":{"filter":filter,"order_by":[{"key":{"kind":"position"},"direction":"descending"}],"select":{"kind":"events"}},
        "page":{"limit":1}
    })).map_err(|_|RpcError::invalid("Invalid accepted input query"))
    };
    let start = tree
        .query(
            branch.to_owned(),
            latest(super::facts::and(vec![
                super::facts::equal("kind", json!("turn/start")),
                super::facts::equal("data.turn_id", json!(turn)),
            ]))?,
        )
        .await?;
    let QueryOutput::Events { events } = start.result else {
        return Err(RpcError::invalid("Missing turn input source"));
    };
    let start = events
        .first()
        .ok_or_else(|| RpcError::invalid("Missing turn input boundary"))?
        .event
        .sequence;
    // Resolve consumed facts in the public branch prefix first. An EXISTS
    // relation can otherwise see a later consumption beyond this request cut.
    let mut consumed_query = latest(super::facts::and(vec![
        super::facts::equal("kind", json!("input/consumed")),
        json!({"op":"compare","left":super::facts::field("position.sequence"),"comparison":"gt","right":{"kind":"value","value":start}}),
    ]))?;
    consumed_query
        .page
        .as_mut()
        .expect("paged consumed query")
        .limit = std::num::NonZeroU64::new(128).unwrap();
    let mut consumed_ids = Vec::new();
    loop {
        let page = tree
            .query(branch.to_owned(), consumed_query.clone())
            .await?;
        let QueryOutput::Events { events } = page.result else {
            return Err(RpcError::invalid("Missing consumed input result"));
        };
        for event in events {
            if let EventKind::InputConsumed(data) = &event.event.kind {
                consumed_ids.push(data.input_id.clone());
            }
            if consumed_ids.len() > 4096 {
                return Err(RpcError::invalid("Consumed input batch exceeds its bound"));
            }
        }
        let Some(next) = page.next else {
            break;
        };
        consumed_query
            .page
            .as_mut()
            .expect("paged consumed query")
            .after = Some(next);
    }
    if consumed_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = latest(super::facts::and(vec![
        super::facts::equal("kind", json!("input/message")),
        json!({"op":"or","conditions":[
            {"op":"present","value":super::facts::field("data.user")},
            {"op":"any","field":"data.blocks","condition":{"op":"and","conditions":[
                {"op":"not","condition":{"op":"present","value":{"kind":"element","path":"key"}}},
                {"op":"not","condition":{"op":"prefix","value":{"kind":"element","path":"text"},"prefix":"<dim-state "}},
                {"op":"not","condition":{"op":"prefix","value":{"kind":"element","path":"text"},"prefix":"<dim-rule "}}
            ]}}
        ]}),
        super::facts::one_of("id", json!(consumed_ids)),
    ]))?;
    query.page.as_mut().expect("paged input query").limit =
        std::num::NonZeroU64::new(if all { 128 } else { 1 }).unwrap();
    let mut found = Vec::new();
    loop {
        let page = tree.query(branch.to_owned(), query.clone()).await?;
        let QueryOutput::Events { events } = page.result else {
            return Err(RpcError::invalid("Missing accepted input result"));
        };
        for event in events {
            let EventKind::InputMessage(input) = &event.event.kind else {
                return Err(RpcError::invalid("Invalid accepted input source"));
            };
            let content = if let Some(user) = &input.user {
                user.content.clone()
            } else {
                input
                    .blocks
                    .iter()
                    .filter_map(|block| match block {
                        InputBlock::Raw {
                            text, key: None, ..
                        } if !dim_agent_capabilities::context_block::is_state_or_rule(text) => {
                            Some(ContentBlock::Text { text: text.clone() })
                        }
                        _ => None,
                    })
                    .collect()
            };
            found.push(content);
            if found.len() > 4096 {
                return Err(RpcError::invalid("Accepted input batch exceeds its bound"));
            }
        }
        if !all {
            break;
        }
        let Some(next) = page.next else {
            break;
        };
        query.page.as_mut().expect("paged input query").after = Some(next);
    }
    found.reverse();
    Ok(found.into_iter().flatten().collect())
}
