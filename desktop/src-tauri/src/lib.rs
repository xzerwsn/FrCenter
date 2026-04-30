use std::{
    collections::HashMap,
    sync::Mutex,
};

use tauri::{
    ipc::{Channel, Response},
    State, WebviewWindow,
};

const RECENT_MESSAGE_LIMIT: usize = 50;
const CHANNEL_CHUNK_BYTES: usize = 768;

#[derive(Default)]
struct RecentMessagesState {
    messages_by_chat: Mutex<HashMap<String, Vec<String>>>,
}

#[tauri::command]
async fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
async fn toggle_maximize_window(window: WebviewWindow) -> Result<bool, String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
async fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
async fn cache_recent_messages(
    state: State<'_, RecentMessagesState>,
    chat_id: String,
    messages_json: String,
) -> Result<(), String> {
    let messages = serde_json::from_str::<Vec<serde_json::Value>>(&messages_json)
        .map_err(|error| format!("invalid message cache payload: {error}"))?;
    let trimmed = if messages.len() > RECENT_MESSAGE_LIMIT {
        messages[messages.len() - RECENT_MESSAGE_LIMIT..].to_vec()
    } else {
        messages
    };
    let serialized = trimmed
        .into_iter()
        .map(|message| serde_json::to_string(&message).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;

    state
        .messages_by_chat
        .lock()
        .map_err(|_| "recent message cache is unavailable".to_string())?
        .insert(chat_id, serialized);
    Ok(())
}

#[tauri::command]
async fn get_cached_messages(
    state: State<'_, RecentMessagesState>,
    chat_id: String,
) -> Result<Option<String>, String> {
    let cache = state
        .messages_by_chat
        .lock()
        .map_err(|_| "recent message cache is unavailable".to_string())?;
    Ok(cache.get(&chat_id).map(|messages| format!("[{}]", messages.join(","))))
}

#[tauri::command]
async fn stream_cached_messages(
    state: State<'_, RecentMessagesState>,
    chat_id: String,
    channel: Channel<Response>,
) -> Result<bool, String> {
    let payload = {
        let cache = state
            .messages_by_chat
            .lock()
            .map_err(|_| "recent message cache is unavailable".to_string())?;
        cache
            .get(&chat_id)
            .map(|messages| format!("[{}]", messages.join(",")).into_bytes())
    };

    let Some(payload) = payload else {
        return Ok(false);
    };

    for chunk in payload.chunks(CHANNEL_CHUNK_BYTES) {
        channel
            .send(Response::new(chunk.to_vec()))
            .map_err(|error| error.to_string())?;
    }

    Ok(true)
}

#[tauri::command]
async fn clear_recent_messages(state: State<'_, RecentMessagesState>) -> Result<(), String> {
    state
        .messages_by_chat
        .lock()
        .map_err(|_| "recent message cache is unavailable".to_string())?
        .clear();
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(RecentMessagesState::default())
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize_window,
            close_window,
            cache_recent_messages,
            get_cached_messages,
            stream_cached_messages,
            clear_recent_messages
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("failed to run FrCenter");
}
