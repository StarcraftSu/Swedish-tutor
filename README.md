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
2. Open the app, click **⚙️ Settings**, paste the key, pick a model, your Swedish level, and whether to show a Chinese (中文) translation alongside the English.
3. Press **Start speaking** and talk.

The key is stored only in your browser's localStorage and sent only to `api.anthropic.com` (the app calls the API directly from the browser — fine for personal use; don't commit a key to the repo or share a deployed page with a key baked in).

Without a key the app falls back to a canned demo bot.

## Models

| Model | When |
|---|---|
| Claude Opus 5.5 (default) | Best conversations and corrections |
| Claude Sonnet 5.5 | Balanced |
| Claude Haiku 5.5 | Fastest, by far the cheapest — plenty for translating pasted text |

A saved Opus 5 / Sonnet 5 / Haiku 4.5 choice is moved to its 5.5 successor automatically.

## Voice quality

Replies are spoken with your OS/browser voice by default. Two upgrades, in order of effort:

1. **Better system voice (free):** on macOS install an Enhanced/Premium Swedish voice (System Settings → Accessibility → Spoken Content → System voice → Manage Voices → Swedish), restart Chrome, then pick it in ⚙️ Settings. There's also a speech-speed setting.
2. **Human-quality voice (ElevenLabs):** paste an ElevenLabs API key in ⚙️ Settings (free tier ~10k chars/month at elevenlabs.io). Optionally pick a native Swedish voice from their Voice Library and paste its voice ID. Only Swedish goes through ElevenLabs (translations use the browser voice, saving quota). Falls back to the browser voice automatically if a call fails; repeated playback of the same line is cached and not re-billed.

## Features

- **Paste, translate & shadow** — copy Swedish from anywhere and press ⌘V / Ctrl+V on the page (or use the 📋 box). It comes back sentence by sentence: translation, tap-any-word glosses (with dictionary forms), a 💡 note on idioms or tricky grammar, 🔊 normal and 🐢 slow playback, ▶ Play all, and 🎤 Shadow — the sentence is played, the mic opens as soon as it ends, and your attempt is scored word by word, with **Next sentence →** to work through the whole text. Paste a single word to get dictionary info (en/ett, plural, verb forms); paste English or Chinese to get it in Swedish. Up to 2,000 characters at a time; without an API key you still get listening and shadowing.
- Spoken conversation adapted to your level (beginner / intermediate / advanced)
- Bilingual replies: Swedish on top, English translation underneath (optionally plus 中文 — English always stays, it maps onto Swedish much more closely) — tap any Swedish word to see (and hear) its English meaning in context
- Listen & repeat pronunciation practice: the 🎯 button asks Svea for a sentence at your level (every reply also has a 🎤 Repeat button); say it back and each word is marked green (recognized), yellow (close — appeared in an alternative hearing) or red (didn't come through), with your own recording to compare against the TTS. Listening stops as soon as every word has come through, instead of waiting out the silence timer
- Thinking-pause control: your sentence is only sent after a configurable silence (default 3s, or "only when I press Stop"), with a live transcript while you speak — pausing mid-sentence won't cut you off
- Accent-tolerant: the recognizer's alternative hearings are passed to the tutor, which is instructed to work out what you meant rather than react to garbled text; a ⌨️ keyboard fallback lets you type when speech fails
- Grammar correction cards — the model flags at most one real error per turn, with the natural phrasing and a one-line explanation
- Replay of your **actual recording** (MediaRecorder), plus TTS playback of every bot line
- Swedish TTS voice detection — warns if your OS has no Swedish voice installed
- Live cost counter in the header: exact API spend this session (from the API's own token usage, including cache discounts); click it for token details and the all-time total on this browser, with a reset

## Code layout

No build step — `index.html` loads `js/main.js` as an ES module.

| File | What it does |
|---|---|
| `js/main.js` | Boot and wiring of the main controls; `window.__tutor` dev hook |
| `js/settings.js` / `js/settings-panel.js` | Stored settings, model upgrades / the ⚙️ panel and banners |
| `js/state.js` | Ready / Listening / Thinking / Speaking and the UI that follows it |
| `js/claude.js`, `js/prompts.js` | Anthropic SDK calls (tutor turn, text explanation) / system prompts and output schemas |
| `js/speech.js` | Text-to-speech (browser voices, ElevenLabs); `speakText` resolves when playback ends |
| `js/mic.js` | Speech recognition + recording; whoever listens passes a handler for the result |
| `js/chat.js` | The conversation with Svea |
| `js/practice.js` | Listen & repeat scoring and the 🎯 practice card |
| `js/reader.js` | Paste, translate & shadow |
| `js/ui.js`, `js/cost.js`, `js/canned.js`, `js/errors.js` | DOM helpers and word glosses, cost counter, fixed bot lines, API error notes |

## Notes

- Speech recognition audio is processed by the browser's speech service (Google's, in Chrome).
- If replies sound like an English voice reading Swedish, install a Swedish system voice (macOS: System Settings → Accessibility → Spoken Content → Manage voices).
