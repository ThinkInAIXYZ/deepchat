//! Full committed Timeline reads, including product extension facts.
use dim_agent_capabilities::{
    methods::{Interruption, MethodDecl, RpcError, SessionMethods, params, reply},
    timeline_tree::TreeCommands,
};
use dim_agent_runtime::{
    AgentBuilder, Feature, Names, QueryComparison, QueryFilter, QueryOperand, QueryOutput,
    QueryPage, QuerySelect, QuerySpec, TimelineKey, TimelineQuery, TimelineQueryScope,
    TimelineReadScope, TimelineReadSegment,
};
use dim_app_server::{methods::ManagementMethods, storage::SessionStore};
use rutis::Ctx;
use rutis::host::{BoxFuture, CtxHost, DynPlugin, Effect, Key, TypeKey};
use serde::Deserialize;
use serde_json::json;
use std::{num::NonZeroU64, sync::Arc};

pub fn install(builder: &mut AgentBuilder) {
    builder.plugin(|names| {
        Ok(Box::new(StoredReads {
            methods: names.key()?,
        }))
    });
    builder.require_feature(
        Feature::new("DeepChatNativeStorage").session("DeepChatNativeStorage", |names| {
            Ok(Box::new(Storage::new(names)?))
        }),
    );
}
struct Storage {
    tree: Key<TreeCommands>,
    methods: Key<SessionMethods>,
}
impl Storage {
    fn new(names: &Names<'_>) -> rutis::Result<Self> {
        Ok(Self {
            tree: names.key()?,
            methods: names.key()?,
        })
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct History {
    session_id: String,
    branch_id: String,
    #[serde(default)]
    after: serde_json::Value,
    through: Option<serde_json::Value>,
    at_least: Option<serde_json::Value>,
    limit: u64,
}

struct StoredReads {
    methods: Key<ManagementMethods>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Lookup {
    session_id: String,
    branch_id: String,
    submission_id: String,
}

impl DynPlugin for StoredReads {
    fn name(&self) -> &str {
        "DeepChatStoredReads"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.methods.erase(), TypeKey::of::<SessionStore>()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            // This is dim's public storage owner, not a second connection to its SQLite file.
            let store = ctx.require::<SessionStore>()?.timeline_store();
            ctx.require_at(&self.methods)?.register(ctx,"deepchat.native_storage",vec![
            MethodDecl::new("deepchat.native_storage.history",false,Interruption::Report),
            MethodDecl::new("deepchat.native_storage.lookup",false,Interruption::Report),
        ],Arc::new(move|call,cancel,_|{
            let store=store.clone();Box::pin(async move{
                let lookup=call.method.ends_with(".lookup");
                let (key,after,through,limit,submission)=if lookup {
                    let p:Lookup=params(call.params)?;
                    if p.submission_id.is_empty(){return Err(RpcError::invalid("Missing submission identity"));}
                    (TimelineKey{session_id:p.session_id,branch_id:p.branch_id},0,None,2,Some(p.submission_id))
                } else {
                    let p:History=params(call.params)?;
                    if !(1..=200).contains(&p.limit){return Err(RpcError::invalid("History requires a limit between 1 and 200"));}
                    if p.through.is_some() && p.at_least.is_some(){return Err(RpcError::invalid("atLeast and through are mutually exclusive"));}
                    let key=TimelineKey{session_id:p.session_id,branch_id:p.branch_id};
                    let head=store.head(&key).await?;
                    if p.at_least.as_ref().map(cursor).transpose()?.is_some_and(|bound|bound>head){return Err(RpcError::invalid("Timeline cursor exceeds the stored head"));}
                    let after=if p.after.is_null(){0}else{cursor(&p.after)?};
                    (key,after,p.through.as_ref().map(cursor).transpose()?,p.limit,None)
                };
                let head=store.head(&key).await?;
                let through=through.unwrap_or(head);
                if after>through || through>head{return Err(RpcError::invalid("Timeline cursor exceeds the stored head"));}
                store.batch_end(&key,through).await?;
                if through==0{return reply(if lookup{json!({"status":"unknown"})}else{json!({"through":0,"events":[]})});}
                let scope=TimelineReadScope{key:key.clone(),through,segments:vec![TimelineReadSegment{branch_id:key.branch_id.clone(),from:1,through,stored_through:through,tail:vec![]}]};
                let filter=if let Some(submission)=submission {
                    crate::facts::and(vec![crate::facts::equal("kind",json!("input/message")),crate::facts::equal("data.submission_id",json!(submission))])
                } else {json!({"op":"compare","left":{"kind":"field","path":"position.sequence"},"comparison":"gt","right":{"kind":"value","value":after}})};
                let query:QuerySpec=serde_json::from_value(json!({"filter":filter,"select":{"kind":"events"}})).map_err(|_|RpcError::invalid("Invalid stored history query"))?;
                let page=QueryPage{limit:NonZeroU64::new(limit).expect("positive history limit"),after:None};
                let found=tokio::select!{_=cancel.cancelled()=>return Err(RpcError::interrupted()), result=store.query(&scope,&query,Some(&page))=>result?};
                let QueryOutput::Events{events}=found.result else{return Err(RpcError::service("storage_failed","Stored history did not return events"));};
                if lookup {
                    if events.len()>1{return Err(RpcError::service("ambiguous_submission","Several inputs use this submission identity"));}
                    reply(events.first().map(|entry|json!({"status":"accepted","inputId":entry.event.id,"sequence":entry.event.sequence})).unwrap_or_else(||json!({"status":"unknown"})))
                } else {reply(json!({"through":through,"events":events.into_iter().map(|entry|entry.event).collect::<Vec<_>>()}))}
            })
        }))?;
            Ok(Effect::Done)
        })
    }
}
fn cursor(value: &serde_json::Value) -> Result<u64, RpcError> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .ok_or_else(|| RpcError::invalid("Invalid Timeline cursor"))
}
impl DynPlugin for Storage {
    fn name(&self) -> &str {
        "DeepChatNativeStorage"
    }
    fn injects(&self) -> Vec<TypeKey> {
        vec![self.tree.erase(), self.methods.erase()]
    }
    fn apply<'a>(&'a self, ctx: &'a Ctx) -> BoxFuture<'a, rutis::Result<Effect>> {
        Box::pin(async move {
            let tree = ctx.require_at(&self.tree)?;
            ctx.require_at(&self.methods)?.register(ctx, "session.deepchat_native_storage", vec![
                MethodDecl::new("session.deepchat_native_storage.history", false, Interruption::Report)
            ], Arc::new(move |call, _cancel, _| {
                let tree = tree.clone();
                Box::pin(async move {
                    let p: History = params(call.params)?;
                    if !(1..=200).contains(&p.limit) { return Err(RpcError::invalid("History requires a limit between 1 and 200")); }
                    let after = if p.after.is_null() { 0 } else { cursor(&p.after)? };
                    let branch = tree.get(&p.branch_id)?;
                    if p.at_least.is_some() && p.through.is_some() { return Err(RpcError::invalid("atLeast and through are mutually exclusive")); }
                    if p.at_least.as_ref().map(cursor).transpose()?.is_some_and(|bound| bound > branch.sequence()) {
                        return Err(RpcError::invalid("Timeline cursor exceeds the published head"));
                    }
                    let through = p.through.as_ref().map(cursor).transpose()?.unwrap_or_else(|| branch.sequence());
                    if after > through || through > branch.sequence() { return Err(RpcError::invalid("Timeline cursor exceeds the published head")); }
                    let query = TimelineQuery {
                        scope: TimelineQueryScope::Branch, through: Some(through), from: None,
                        include_publishing: false,
                        query: QuerySpec {
                            filter: Some(QueryFilter::Compare {
                                left: QueryOperand::Field { path: "position.sequence".into() },
                                comparison: QueryComparison::Gt,
                                right: QueryOperand::Value { value: json!(after) },
                            }),
                            select: QuerySelect::Events, group_by: vec![], pick: None, order_by: vec![],
                        },
                        page: Some(QueryPage { limit: NonZeroU64::new(p.limit).expect("validated history limit"), after: None }),
                    };
                    let found = branch.query(query).await?;
                    let QueryOutput::Events { events } = found.result else { return Err(RpcError::service("storage_failed", "Native history did not return events")); };
                    reply(json!({"through":through, "events":events.into_iter().map(|entry| entry.event).collect::<Vec<_>>()}))
                })
            }))?;
            Ok(Effect::Done)
        })
    }
}
