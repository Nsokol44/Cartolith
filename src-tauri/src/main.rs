// Cartolith desktop shell.
//
// This Rust binary is intentionally tiny: its only job is to
//   1. find a free local port,
//   2. launch the bundled Python/FastAPI backend (PyInstaller sidecar) on
//      that port,
//   3. tell the frontend (running in the native webview) which port to
//      talk to, and
//   4. make sure the backend process is killed when the window closes,
//      so students never end up with an orphaned background process.
//
// All of Cartolith's actual functionality (data processing, geospatial
// tools, etc.) lives unchanged in backend/main.py.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;

use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds the handle to the running backend sidecar process so we can kill
/// it on shutdown, and the port it's listening on so the frontend can ask
/// for it.
struct BackendState {
    child: Mutex<Option<CommandChild>>,
    port: Mutex<u16>,
}

/// Ask the OS for an ephemeral free TCP port on localhost.
///
/// There's a small unavoidable race between closing this listener and the
/// sidecar binding the same port, but it's the same approach the original
/// launcher.py used and is reliable in practice for a single-user local
/// desktop app.
fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind a temporary socket to find a free port")
        .local_addr()
        .expect("failed to read local socket address")
        .port()
}

/// Exposed to the frontend via `invoke("get_backend_port")` so it knows
/// which port the sidecar ended up on.
#[tauri::command]
fn get_backend_port(state: State<BackendState>) -> u16 {
    *state.port.lock().unwrap()
}

fn main() {
    let port = find_free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState {
            child: Mutex::new(None),
            port: Mutex::new(port),
        })
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .setup(move |app| {
            let shell = app.shell();
            let sidecar = shell
                .sidecar("cartolith-backend")
                .expect("failed to create sidecar command for cartolith-backend");

            let (mut rx, child) = sidecar
                .args(["--port", &port.to_string()])
                .spawn()
                .expect(
                    "failed to spawn the Cartolith backend. \
                     Make sure the app was built with the desktop-tauri workflow \
                     (the backend sidecar binary must be bundled).",
                );

            app.state::<BackendState>()
                .child
                .lock()
                .unwrap()
                .replace(child);

            // Forward backend stdout/stderr into this process's own logs so
            // `RUST_LOG`/console output during development shows backend
            // errors too (e.g. missing GDAL data files).
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[backend] error: {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[backend] exited: {:?}", payload);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the backend the moment the (only) window is closed, so
            // nothing lingers in the background after a student quits.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<BackendState>();
                if let Some(mut child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Cartolith application");
}
