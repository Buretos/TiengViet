use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Read;

#[tauri::command]
async fn fetch_gtts(text: String, lang: String) -> Result<String, String> {
  if text.trim().is_empty() {
    return Err("empty text".into());
  }
  let tl = if lang == "vi" { "vi" } else { "ru" };
  let google_url = format!(
    "https://translate.google.com/translate_tts?ie=UTF-8&tl={}&client=tw-ob&q={}",
    tl,
    urlencoding::encode(&text)
  );

  // ureq blocks; запускаем в blocking-пуле tokio
  tauri::async_runtime::spawn_blocking(move || {
    let agent = ureq::AgentBuilder::new()
      .timeout(std::time::Duration::from_secs(20))
      .build();

    let resp = agent
      .get(&google_url)
      .set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      )
      .set("Referer", "https://translate.google.com/")
      .set("Accept", "audio/mpeg,audio/*;q=0.9,*/*;q=0.5")
      .set("Accept-Language", "en-US,en;q=0.9,vi;q=0.8,ru;q=0.7")
      .call()
      .map_err(|e| format!("http: {}", e))?;

    let mut bytes: Vec<u8> = Vec::with_capacity(64 * 1024);
    resp
      .into_reader()
      .read_to_end(&mut bytes)
      .map_err(|e| format!("read: {}", e))?;

    if bytes.is_empty() {
      return Err("empty body".to_string());
    }
    Ok(STANDARD.encode(&bytes))
  })
  .await
  .map_err(|e| format!("join: {}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![fetch_gtts])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
