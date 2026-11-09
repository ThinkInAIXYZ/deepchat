mod facts;
mod inputs;
mod migration;
mod media;
mod models;
mod permissions;
mod product_tools;
mod queue;
mod secrets;
mod settings;
mod storage;
static GATEWAY: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();

fn install(builder: &mut dim_agent_runtime::AgentBuilder) {
    dim_session_title::install(builder);
    dim_agent_scheduler::install(builder);
    dim_goal::install(builder);
    media::install(builder);
    dim_modality::install_with(
        builder,
        dim_modality::InstallOptions {
            ocr_helper: std::env::current_exe().ok(),
            ..Default::default()
        },
    );
    settings::install(builder);
    permissions::install(builder);
    product_tools::install(builder);
    models::install(builder);
    secrets::install(builder);
    inputs::install(builder);
    migration::install(builder);
    queue::install(builder);
    storage::install(builder);
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
    while let Some(arg) = args.next() {
        if arg == "--deepchat-gateway" {
            gateway = args.next();
            if gateway.is_none() {
                std::process::exit(2);
            }
        } else {
            forwarded.push(arg);
        }
    }
    let _ = GATEWAY.set(gateway);
    if let Err(error) = dim_app_server::cli::process_entry(forwarded, None, install) {
        eprintln!("dim host failed: {error}");
        std::process::exit(1);
    }
}
