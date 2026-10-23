fn main() {
    // Passes DISCORD_CLIENT_ID from the shell or ../.env to discord.rs's option_env!.
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-env-changed=DISCORD_CLIENT_ID");
    let id = std::env::var("DISCORD_CLIENT_ID").ok().or_else(|| {
        std::fs::read_to_string("../.env").ok()?.lines().find_map(|l| l.trim().strip_prefix("DISCORD_CLIENT_ID=").map(|v| v.trim_matches(['"', '\'', ' ']).to_string()))
    });
    if let Some(id) = id {
        println!("cargo:rustc-env=DISCORD_CLIENT_ID={id}");
    }
    tauri_build::build()
}
