# Swedish-tutor

SvenskaTutor — a voice-based Swedish tutor you can actually talk to. Single-page app: speech recognition (Web Speech API, `sv-SE`) in, Claude replies out loud (speech synthesis), with real grammar corrections as you go.

## Run it

Serve `index.html` over HTTP(S) — the microphone requires a secure context, so either GitHub Pages or:

```bash
python3 -m http.server 8000
# open http://localhost:8000 in Chrome
```

Use **Chrome** (desktop) — it has the best Web Speech API support.

## Setup

1. Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com).
2. Open the app, click **⚙️ Settings**, paste the key, pick a model and your Swedish level.
3. Press **Start speaking** and talk.

The key is stored only in your browser's localStorage and sent only to `api.anthropic.com` (the app calls the API directly from the browser — fine for personal use; don't commit a key to the repo or share a deployed page with a key baked in).

Without a key the app falls back to a canned demo bot.

## Models

| Model | When |
|---|---|
| Claude Opus 5 (default) | Best conversations and corrections |
| Claude Sonnet 5 | Balanced |
| Claude Haiku 4.5 | Fastest, cheapest |

## Features

- Spoken conversation adapted to your level (beginner / intermediate / advanced)
- Grammar correction cards — the model flags at most one real error per turn, with the natural phrasing and a one-line explanation
- Replay of your **actual recording** (MediaRecorder), plus TTS playback of every bot line
- Swedish TTS voice detection — warns if your OS has no Swedish voice installed

## Notes

- Speech recognition audio is processed by the browser's speech service (Google's, in Chrome).
- If replies sound like an English voice reading Swedish, install a Swedish system voice (macOS: System Settings → Accessibility → Spoken Content → Manage voices).
