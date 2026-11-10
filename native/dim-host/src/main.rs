mod archive;
mod archive_files;
mod archive_outputs;
mod archive_rebase;
mod archive_timeline;
mod archive_transfer;
mod context;
mod embeddings;
mod facts;
mod gateway;
mod inputs;
mod legacy_queue;
mod media;
mod media_inputs;
mod memory;
mod migration;
mod model_stream;
mod models;
mod payload;
mod permissions;
mod profile;
mod product_tools;
mod queue;
mod scopes;
mod secrets;
mod settings;
mod storage;
mod video_compat;
static CONTEXT_ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
static GATEWAY: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
static PAYLOAD_ROOT: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

fn install(builder: &mut dim_agent_runtime::AgentBuilder) {
    archive::install(builder);
    dim_session_title::install(builder);
    dim_agent_scheduler::install(builder);
    dim_goal::install(builder);
    media::install(builder);
    media::install_tasks(
        builder,
        dim_modality::InstallOptions {
            ocr_helper: std::env::current_exe().ok(),
            ..Default::default()
        },
    );
    context::install(builder);
    media_inputs::install(builder);
    settings::install(builder);
    permissions::install(builder);
    product_tools::install(builder);
    models::install(builder);
    embeddings::install(builder);
    secrets::install(builder);
    inputs::install(builder);
    migration::install(builder);
    queue::install(builder);
    storage::install(builder);
    memory::install(builder);
    scopes::install(builder);
    profile::install(builder);
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("ocr-helper") {
        std::process::exit(dim_ocr::helper_main(
            std::env::args_os().skip(2),
            &mut std::io::stdout(),
            &mut std::io::stderr(),
        ));
    }
    if std::env::args().nth(1).as_deref() != Some("app-server") {
        eprintln!("The DeepChat dim host requires app-server");
        std::process::exit(2);
    }
    let mut args = std::env::args().skip(2);
    let mut forwarded = Vec::new();
    let mut gateway = None;
    let mut context_enabled = false;
    while let Some(arg) = args.next() {
        if arg == "--deepchat-gateway" {
            gateway = args.next();
            if gateway.is_none() {
                std::process::exit(2);
            }
        } else if arg == "--deepchat-context" {
            context_enabled = true;
        } else {
            forwarded.push(arg);
        }
    }
    let _ = CONTEXT_ENABLED.set(context_enabled);
    let _ = GATEWAY.set(gateway);
    if let Some(pair) = forwarded.windows(2).find(|pair| pair[0] == "--home") {
        let _ = PAYLOAD_ROOT.set(std::path::PathBuf::from(&pair[1]).join("deepchat-payloads"));
    }
    if let Err(error) = dim_app_server::cli::process_entry(forwarded, None, install) {
        eprintln!("dim host failed: {error}");
        std::process::exit(1);
    }
}
