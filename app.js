// The official Anthropic SDK, loaded as an ES module. If the CDN is
// unreachable the app still boots in canned demo mode.
let AnthropicSDK = null;
try {
    ({ default: AnthropicSDK } = await import(
        "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.122.0/+esm"
    ));
} catch (e) {
    console.error("Failed to load Anthropic SDK", e);
}

// --- Configuration & State ---
const STATE = {
    IDLE: 'Ready',
    LISTENING: 'Listening...',
    PROCESSING: 'Thinking...',
    SPEAKING: 'Bot Speaking'
};

const SETTINGS_KEY = 'svenskatutor_settings';
const DEFAULT_SETTINGS = {
    apiKey: '', model: 'claude-opus-5', level: 'beginner',
    voiceURI: '', rate: 0.95,
    // Optional human-quality TTS via ElevenLabs; falls back to browser TTS.
    elevenKey: '', elevenVoiceId: '21m00Tcm4TlvDq8ikWAM',
    // Silence (ms) before an utterance is considered finished; 0 = only on Stop.
    pauseMs: 3000
};

let currentState = STATE.IDLE;
let recognition = null;
const synth = window.speechSynthesis;
let swedishVoices = [];      // all sv-* voices, best first
let englishVoices = [];      // all en-* voices, best first

let settings = loadSettings();
let client = null;
let history = [];           // Anthropic MessageParam[] — full conversation
let recorder = null;        // MediaRecorder for the learner's real audio
let recorderChunks = [];
let attachAudioTarget = null; // callback receiving the finished Blob

const LEVEL_GUIDES = {
    beginner: "The learner is a BEGINNER: use very simple, common words and short sentences, mostly present tense.",
    intermediate: "The learner is INTERMEDIATE: use everyday vocabulary and natural sentences; past and future tense are fine.",
    advanced: "The learner is ADVANCED: speak natural, idiomatic Swedish."
};

function systemPrompt() {
    return `You are Svea, a warm and encouraging Swedish tutor having a SPOKEN conversation with a learner. Their messages come from speech recognition; your Swedish reply is read aloud by text-to-speech and shown together with your English translation.

${LEVEL_GUIDES[settings.level] || LEVEL_GUIDES.beginner}

Rules:
- "reply_sv" is what you say out loud: 1-3 short conversational Swedish sentences. No lists, no markdown, no emojis, no English inside it.
- "reply_en" is a natural English translation of reply_sv. If the learner asked a question about Swedish or seems lost, append your brief English explanation here after the translation.
- "words" glosses reply_sv word by word, in order, covering the whole reply: each entry is {sv, en} where sv is the word as written in reply_sv (keep punctuation off) and en is its contextual English meaning. Keep multi-word fixed expressions (e.g. "vad kul", "ska vi") as a single entry when they translate as a unit.
- Be a conversation partner, not a lecturer: react to what they said and usually end with one simple follow-up question.
- Vary topics naturally (weather, food, family, work, hobbies, weekend plans...). If the conversation stalls, suggest a new topic.
- The transcript may contain speech-recognition mistakes. Interpret charitably, never scold, and do not correct things that are probably transcription artifacts rather than the learner's own error.
- If the learner's Swedish contains a real grammar or word-choice error worth learning from, fill in "correction": original = their exact words (a short fragment), corrected = the natural way to say it, explanation = one short English sentence on why. Otherwise "correction" must be null. At most one correction per turn - pick the most instructive, skip trivial ones.`;
}

// Structured output: guarantees every turn parses into a bilingual reply,
// a word-by-word gloss, and an optional correction.
const TUTOR_OUTPUT_FORMAT = {
    type: "json_schema",
    schema: {
        type: "object",
        properties: {
            reply_sv: { type: "string" },
            reply_en: { type: "string" },
            words: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        sv: { type: "string" },
                        en: { type: "string" }
                    },
                    required: ["sv", "en"],
                    additionalProperties: false
                }
            },
            correction: {
                anyOf: [
                    { type: "null" },
                    {
                        type: "object",
                        properties: {
                            original: { type: "string" },
                            corrected: { type: "string" },
                            explanation: { type: "string" }
                        },
                        required: ["original", "corrected", "explanation"],
                        additionalProperties: false
                    }
                ]
            }
        },
        required: ["reply_sv", "reply_en", "words", "correction"],
        additionalProperties: false
    }
};

// Canned fallback so the page still demos without an API key.
const DEMO_BOT = {
    greetings: {
        keywords: ['hej', 'hallå', 'hello', 'hi'],
        responses: [
            { sv: "Hej! Hur mår du idag?", en: "Hi! How are you today?",
              words: [{ sv: "Hej", en: "hi" }, { sv: "hur", en: "how" }, { sv: "mår", en: "feel" }, { sv: "du", en: "you" }, { sv: "idag", en: "today" }] },
            { sv: "Vad kul att se dig!", en: "How nice to see you!",
              words: [{ sv: "Vad kul", en: "how nice" }, { sv: "att", en: "to" }, { sv: "se", en: "see" }, { sv: "dig", en: "you" }] }
        ]
    },
    default: {
        responses: [
            { sv: "Intressant! Berätta mer om det.", en: "Interesting! Tell me more about it.",
              words: [{ sv: "Intressant", en: "interesting" }, { sv: "berätta", en: "tell" }, { sv: "mer", en: "more" }, { sv: "om", en: "about" }, { sv: "det", en: "it" }] },
            { sv: "Jag förstår. Kan du förklara det lite mer på svenska?", en: "I understand. Can you explain it a bit more in Swedish?",
              words: [{ sv: "Jag", en: "I" }, { sv: "förstår", en: "understand" }, { sv: "kan", en: "can" }, { sv: "du", en: "you" }, { sv: "förklara", en: "explain" }, { sv: "det", en: "it" }, { sv: "lite mer", en: "a bit more" }, { sv: "på", en: "in" }, { sv: "svenska", en: "Swedish" }] }
        ]
    }
};

// --- Settings ---
function loadSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* private mode etc. — settings just won't persist */ }
}

function initClient() {
    if (AnthropicSDK && settings.apiKey) {
        client = new AnthropicSDK({
            apiKey: settings.apiKey,
            dangerouslyAllowBrowser: true,
            // Absorb transient 429/5xx/529 blips (SDK default is 2 retries).
            maxRetries: 4
        });
    } else {
        client = null;
    }
    document.getElementById('demo-banner').classList.toggle('hidden', !!client);
}

// --- Initialization ---
function init() {
    setupSpeechRecognition();
    synth.onvoiceschanged = loadVoices;
    loadVoices();
    initClient();
    wireUi();

    // Greeting is shown but not auto-spoken: Chrome blocks TTS before
    // the first user gesture, so it would silently fail anyway.
    addBotMessage({
        sv: "Hej! Jag är Svea, din svensklärare. Tryck på knappen och prata med mig!",
        en: "Hi! I'm Svea, your Swedish teacher. Press the button and talk to me!",
        words: [
            { sv: "Hej", en: "hi" }, { sv: "jag", en: "I" }, { sv: "är", en: "am" },
            { sv: "Svea", en: "Svea" }, { sv: "din", en: "your" }, { sv: "svensklärare", en: "Swedish teacher" },
            { sv: "tryck", en: "press" }, { sv: "på", en: "on" }, { sv: "knappen", en: "the button" },
            { sv: "och", en: "and" }, { sv: "prata", en: "talk" }, { sv: "med", en: "with" }, { sv: "mig", en: "me" }
        ]
    }, { speak: false });

    if (!settings.apiKey) openSettings();
}

// Quality heuristic: OS "enhanced/premium/natural" voices and Google's
// network voices sound far better than the default "compact" ones.
// macOS ships old novelty/legacy voices (Fred, Albert, Ralph, ...) that can
// end up as the default and sound terrible — penalize them hard.
const BAD_VOICE_NAMES = /compact|fred|albert|ralph|junior|kathy|whisper|zarvox|trinoids|boing|bubbles|cellos|organ|bells|bad news|good news|jester|wobble|superstar|bahh|deranged|hysterical/;

function voiceScore(v, preferredLang) {
    const n = v.name.toLowerCase();
    let s = 0;
    if (v.lang === preferredLang) s += 4;
    if (/premium|enhanced|natural|neural|siri/.test(n)) s += 3;
    if (/google/.test(n)) s += 2;
    if (!v.localService) s += 1;
    if (BAD_VOICE_NAMES.test(n)) s -= 10;
    return s;
}

function loadVoices() {
    const voices = synth.getVoices();
    swedishVoices = voices
        .filter(v => v.lang.toLowerCase().startsWith('sv'))
        .sort((a, b) => voiceScore(b, 'sv-SE') - voiceScore(a, 'sv-SE'));
    englishVoices = voices
        .filter(v => v.lang.toLowerCase().startsWith('en'))
        .sort((a, b) => voiceScore(b, 'en-US') - voiceScore(a, 'en-US'));
    if (voices.length > 0) {
        document.getElementById('voice-banner').classList.toggle('hidden', swedishVoices.length > 0);
    }
    populateVoiceSelect();
}

function pickEnglishVoice() {
    return englishVoices[0] || null;
}

function pickSwedishVoice() {
    if (settings.voiceURI) {
        const chosen = swedishVoices.find(v => v.voiceURI === settings.voiceURI);
        if (chosen) return chosen;
    }
    return swedishVoices[0] || null;
}

function populateVoiceSelect() {
    const select = document.getElementById('voice-select');
    if (!select) return;
    select.replaceChildren();
    if (swedishVoices.length === 0) {
        select.appendChild(new Option('No Swedish voice found in this browser', ''));
        select.disabled = true;
        return;
    }
    select.disabled = false;
    select.appendChild(new Option('Auto (best available)', ''));
    for (const v of swedishVoices) {
        select.appendChild(new Option(`${v.name} (${v.lang})`, v.voiceURI));
    }
    select.value = settings.voiceURI && swedishVoices.some(v => v.voiceURI === settings.voiceURI)
        ? settings.voiceURI
        : '';
}

// Continuous listening: the browser's own endpointing cuts learners off at
// the first thinking-pause, so we accumulate results ourselves and only send
// after `settings.pauseMs` of silence (or when the learner presses Stop).
let liveFinal = '';
let liveInterim = '';
let liveBubble = null;      // { div, bubble, controls } while speaking
let silenceTimer = null;

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = 'sv-SE';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
        liveFinal = '';
        liveInterim = '';
        updateState(STATE.LISTENING);
        // Longer initial window: give the learner time to start talking.
        if (settings.pauseMs > 0) armSilenceTimer(Math.max(8000, settings.pauseMs));
    };

    recognition.onresult = (event) => {
        liveInterim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) liveFinal += r[0].transcript;
            else liveInterim += r[0].transcript;
        }
        updateLiveBubble();
        armSilenceTimer();
    };

    recognition.onend = () => {
        clearTimeout(silenceTimer);
        const text = (liveFinal + ' ' + liveInterim).replace(/\s+/g, ' ').trim();
        liveFinal = '';
        liveInterim = '';
        if (currentState === STATE.LISTENING) updateState(STATE.IDLE);

        if (text) {
            finalizeLiveBubble(text);
            stopRecorder();
            runTurn(text);
        } else {
            discardLiveBubble();
            attachAudioTarget = null;
            stopRecorder();
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech error", event.error);
        if (event.error === 'no-speech') {
            addBotMessage({ sv: "Jag hörde ingenting. Försök igen!", en: "I didn't hear anything. Try again!" }, { speak: false });
        } else if (event.error === 'not-allowed') {
            addSystemNote("Microphone access was denied — allow it in the browser to practice speaking.");
        }
        // onend fires after onerror and handles state + any partial text.
    };
}

function armSilenceTimer(ms = settings.pauseMs) {
    clearTimeout(silenceTimer);
    if (settings.pauseMs > 0) {
        silenceTimer = setTimeout(() => {
            try { recognition.stop(); } catch { /* already stopped */ }
        }, ms);
    }
}

// --- Core Logic ---
function updateState(state) {
    currentState = state;
    const badge = document.getElementById('status-badge');
    const text = document.getElementById('status-text');
    const trigger = document.getElementById('voice-trigger');
    const triggerText = document.getElementById('trigger-text');
    const procText = document.getElementById('processing-text');

    badge.className = 'status-badge ' +
        (state === STATE.IDLE ? 'status-ready' :
         state === STATE.LISTENING ? 'status-listening' :
         state === STATE.PROCESSING ? 'status-processing' : 'status-speaking');

    text.innerText = state;

    const listenHint = document.getElementById('listening-hint');
    if (state === STATE.LISTENING) {
        trigger.className = 'main-btn btn-stop listening';
        triggerText.innerText = 'Stop speaking';
        procText.classList.add('hidden');
        listenHint.textContent = settings.pauseMs > 0
            ? `Take your time — sends after ${(settings.pauseMs / 1000).toFixed(1).replace('.0', '')}s of silence, or press Stop.`
            : 'Take your time — sends only when you press Stop.';
        listenHint.classList.remove('hidden');
    } else if (state === STATE.PROCESSING) {
        procText.classList.remove('hidden');
        listenHint.classList.add('hidden');
    } else {
        trigger.className = 'main-btn btn-start';
        triggerText.innerText = 'Start speaking';
        procText.classList.add('hidden');
        listenHint.classList.add('hidden');
    }
}

async function handleUserSpeech(text) {
    addUserMessage(text);
    await runTurn(text);
}

// Sends one already-transcribed utterance to the tutor. Kept separate from
// handleUserSpeech so error notes can offer a Retry that doesn't require
// the learner to say the sentence again.
async function runTurn(text) {
    if (currentState === STATE.PROCESSING) return;
    updateState(STATE.PROCESSING);

    if (!client) {
        // Canned demo mode
        setTimeout(() => {
            addBotMessage(demoReply(text));
        }, 600);
        return;
    }

    try {
        const turn = await askTutor(text);
        if (turn.correction) addCorrectionCard(turn.correction);
        addBotMessage({ sv: turn.reply_sv, en: turn.reply_en, words: turn.words || [] });
    } catch (err) {
        handleApiError(err, text);
        updateState(STATE.IDLE);
    }
}

async function askTutor(userText) {
    history.push({ role: "user", content: userText });

    const request = {
        model: settings.model,
        max_tokens: 2000,
        system: systemPrompt(),
        messages: history,
        cache_control: { type: "ephemeral" },
        output_config: { effort: "low", format: TUTOR_OUTPUT_FORMAT }
    };

    let response;
    try {
        // On Opus 5, opt into server-side refusal fallbacks so a rare
        // safety decline is retried on another model in the same call.
        if (settings.model === "claude-opus-5") {
            response = await client.beta.messages.create({
                ...request,
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default"
            });
        } else {
            response = await client.messages.create(request);
        }
    } catch (err) {
        history.pop();
        throw err;
    }

    if (response.stop_reason === "refusal") {
        history.pop();
        return {
            reply_sv: "Förlåt, det där kan jag inte prata om. Ska vi byta ämne?",
            reply_en: "Sorry, I can't talk about that. Shall we change topic?",
            words: [],
            correction: null
        };
    }

    // Keep the full content blocks (incl. thinking) so they can be
    // echoed back on the next turn, as the API expects.
    history.push({ role: "assistant", content: response.content });

    const textBlock = response.content.find(b => b.type === "text");
    try {
        return JSON.parse(textBlock.text);
    } catch {
        return {
            reply_sv: textBlock ? textBlock.text : "Ursäkta, kan du säga det igen?",
            reply_en: textBlock ? "" : "Sorry, can you say that again?",
            words: [],
            correction: null
        };
    }
}

function handleApiError(err, retryText) {
    console.error(err);
    const retry = retryText ? () => runTurn(retryText) : null;
    if (AnthropicSDK && err instanceof AnthropicSDK.AuthenticationError) {
        addSystemNote("Your API key was rejected — check it in Settings.");
        openSettings();
    } else if (AnthropicSDK && err instanceof AnthropicSDK.RateLimitError) {
        addSystemNote("Rate limited by the API — wait a moment and try again.", retry);
    } else if (AnthropicSDK && err instanceof AnthropicSDK.APIError && (err.status === 529 || err.status === 503)) {
        addSystemNote("The AI service is temporarily overloaded — it usually recovers in seconds. Retry, or switch model in ⚙️ Settings.", retry);
    } else if (AnthropicSDK && err instanceof AnthropicSDK.APIError) {
        addSystemNote(`The tutor service returned an error (${err.status}).`, retry);
    } else {
        addSystemNote("Could not reach the tutor service — check your connection.", retry);
    }
}

function demoReply(input) {
    const lower = input.toLowerCase();
    for (const key of Object.keys(DEMO_BOT)) {
        const entry = DEMO_BOT[key];
        if (entry.keywords && entry.keywords.some(k => lower.includes(k))) {
            return pick(entry.responses);
        }
    }
    return pick(DEMO_BOT.default.responses);
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// --- UI Components (built with textContent — user/model text is never
// parsed as HTML, and apostrophes can't break handlers) ---
function el(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
}

function smallButton(label, onClick) {
    const btn = el('button', 'btn-small', label);
    btn.addEventListener('click', onClick);
    return btn;
}

function appendToFlow(node) {
    const flow = document.getElementById('conversation-flow');
    flow.appendChild(node);
    flow.scrollTop = flow.scrollHeight;
}

function addSystemNote(text, retry) {
    const note = el('div', 'system-note', text);
    if (retry) {
        const btn = smallButton('🔄 Retry', () => {
            btn.disabled = true;
            retry();
        });
        btn.style.margin = '0.4rem auto 0';
        note.appendChild(btn);
    }
    appendToFlow(note);
}

function addUserMessage(text) {
    const div = el('div', 'message user');
    const bubble = el('div', 'bubble', text);
    div.appendChild(bubble);
    const controls = el('div', 'controls-row');
    div.appendChild(controls);
    appendToFlow(div);

    // The play button appears once the MediaRecorder blob is ready —
    // this is the learner's REAL audio, not TTS.
    attachAudioTarget = (blob) => {
        const url = URL.createObjectURL(blob);
        controls.appendChild(smallButton('▶ Play my recording', () => new Audio(url).play()));
    };
    return { div, bubble, controls };
}

// Live transcript bubble shown while the learner is still speaking.
function updateLiveBubble() {
    const text = (liveFinal + ' ' + liveInterim).replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!liveBubble) {
        const div = el('div', 'message user live');
        const bubble = el('div', 'bubble', text);
        div.appendChild(bubble);
        const controls = el('div', 'controls-row');
        div.appendChild(controls);
        appendToFlow(div);
        liveBubble = { div, bubble, controls };
    } else {
        liveBubble.bubble.textContent = text;
        const flow = document.getElementById('conversation-flow');
        flow.scrollTop = flow.scrollHeight;
    }
}

function finalizeLiveBubble(text) {
    if (!liveBubble) {
        addUserMessage(text);
        return;
    }
    const { div, bubble, controls } = liveBubble;
    liveBubble = null;
    div.classList.remove('live');
    bubble.textContent = text;
    attachAudioTarget = (blob) => {
        const url = URL.createObjectURL(blob);
        controls.appendChild(smallButton('▶ Play my recording', () => new Audio(url).play()));
    };
}

function discardLiveBubble() {
    if (liveBubble) {
        liveBubble.div.remove();
        liveBubble = null;
    }
}

// Bot messages are bilingual: Swedish on top (each word tappable for its
// English gloss), English translation underneath.
function addBotMessage(msg, { speak = true } = {}) {
    const { sv, en = '', words = [] } = typeof msg === 'string' ? { sv: msg } : msg;

    const div = el('div', 'message bot');
    const bubble = el('div', 'bubble');

    const svLine = el('div', 'sv-line');
    if (words.length > 0) {
        words.forEach((w, i) => {
            if (i > 0) svLine.appendChild(document.createTextNode(' '));
            const span = el('span', 'w', w.sv);
            span.addEventListener('click', (e) => {
                e.stopPropagation();
                showGloss(span, w.sv, w.en);
            });
            svLine.appendChild(span);
        });
    } else {
        svLine.textContent = sv;
    }
    bubble.appendChild(svLine);
    if (en) bubble.appendChild(el('div', 'en-line', en));
    div.appendChild(bubble);

    const controls = el('div', 'controls-row');
    controls.appendChild(smallButton('🔊 Play', () => speakText(sv, 'sv')));
    if (en) controls.appendChild(smallButton('🔊 English', () => speakText(en, 'en')));
    div.appendChild(controls);
    appendToFlow(div);

    if (speak) speakText(sv, 'sv');
}

// --- Word gloss popover ---
let glossPop = null;

function showGloss(anchor, sv, en) {
    hideGloss();
    glossPop = el('div', 'gloss-pop');
    glossPop.appendChild(el('span', 'gloss-sv', sv));
    glossPop.appendChild(document.createTextNode(' = '));
    glossPop.appendChild(el('span', 'gloss-en', en));
    const hear = smallButton('🔊', (e) => { e.stopPropagation(); speakText(sv, 'sv'); });
    hear.classList.add('gloss-hear');
    glossPop.appendChild(hear);
    document.body.appendChild(glossPop);

    const r = anchor.getBoundingClientRect();
    const p = glossPop.getBoundingClientRect();
    let left = r.left + r.width / 2 - p.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
    let top = r.top - p.height - 8;
    if (top < 8) top = r.bottom + 8;
    glossPop.style.left = `${left}px`;
    glossPop.style.top = `${top}px`;

    anchor.classList.add('w-active');
    glossPop._anchor = anchor;
}

function hideGloss() {
    if (glossPop) {
        glossPop._anchor?.classList.remove('w-active');
        glossPop.remove();
        glossPop = null;
    }
}

document.addEventListener('click', hideGloss);
document.getElementById('conversation-flow').addEventListener('scroll', hideGloss);

function addCorrectionCard(correction) {
    const card = el('div', 'correction-card');
    card.appendChild(el('div', 'correction-label', 'Grammar'));

    const content = el('div', 'correction-content');

    const saidLine = el('div', null, 'You said: ');
    saidLine.appendChild(el('span', 'highlight', `"${correction.original}"`));
    content.appendChild(saidLine);

    const betterLine = el('div', null, 'More natural: ');
    betterLine.appendChild(el('span', 'highlight-good', `"${correction.corrected}"`));
    content.appendChild(betterLine);

    content.appendChild(el('div', 'correction-explanation', correction.explanation));

    const controls = el('div', 'controls-row');
    controls.appendChild(smallButton('🔊 Hear it', () => speakText(correction.corrected, 'sv')));
    controls.appendChild(smallButton('🔄 Try again', startListening));
    content.appendChild(controls);

    card.appendChild(content);
    appendToFlow(card);
}

// --- Audio Actions ---
let currentAudio = null;          // premium-TTS playback in progress
const ttsCache = new Map();       // text -> object URL, so replays aren't re-billed

function stopSpeaking() {
    synth.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (currentState === STATE.SPEAKING) updateState(STATE.IDLE);
}

async function speakText(text, lang) {
    stopSpeaking();
    updateState(STATE.SPEAKING);

    if (settings.elevenKey) {
        try {
            await speakWithElevenLabs(text);
            return;
        } catch (err) {
            console.error('ElevenLabs TTS failed, falling back to browser voice', err);
        }
    }
    speakWithBrowser(text, lang);
}

async function speakWithElevenLabs(text) {
    let url = ttsCache.get(text);
    if (!url) {
        const resp = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.elevenVoiceId)}`,
            {
                method: 'POST',
                headers: { 'xi-api-key': settings.elevenKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
            }
        );
        if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}`);
        url = URL.createObjectURL(await resp.blob());
        ttsCache.set(text, url);
    }
    const audio = new Audio(url);
    audio.playbackRate = settings.rate || 0.95;
    currentAudio = audio;
    audio.onended = audio.onerror = () => {
        if (currentAudio === audio && currentState === STATE.SPEAKING) updateState(STATE.IDLE);
    };
    await audio.play();
}

function speakWithBrowser(text, lang) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'sv' ? 'sv-SE' : 'en-US';
    if (lang === 'sv') {
        const voice = pickSwedishVoice();
        if (voice) utterance.voice = voice;
        utterance.rate = settings.rate || 0.95;
    } else {
        const voice = pickEnglishVoice();
        if (voice) utterance.voice = voice;
    }

    // Only fall back to IDLE if nothing else (e.g. listening) took over.
    utterance.onend = utterance.onerror = () => {
        if (currentState === STATE.SPEAKING) updateState(STATE.IDLE);
    };
    synth.speak(utterance);
}

async function startRecorder() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recorderChunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => { if (e.data.size > 0) recorderChunks.push(e.data); };
        recorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(recorderChunks, { type: recorder.mimeType || 'audio/webm' });
            if (blob.size > 0 && attachAudioTarget) attachAudioTarget(blob);
            attachAudioTarget = null;
        };
        recorder.start();
    } catch {
        recorder = null; // no recording — the rest still works
    }
}

function stopRecorder() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
}

function startListening() {
    if (!recognition) {
        alert("Your browser does not support Speech Recognition. Please use Chrome.");
        return;
    }
    if (currentState === STATE.LISTENING) {
        recognition.stop();
        return;
    }
    if (currentState === STATE.PROCESSING) return;

    // Never listen while the bot is talking — the mic would hear it.
    stopSpeaking();

    attachAudioTarget = null;
    startRecorder().finally(() => {
        try { recognition.start(); } catch { /* already started */ }
    });
}

// --- Settings UI ---
function openSettings() {
    document.getElementById('api-key-input').value = settings.apiKey;
    document.getElementById('model-select').value = settings.model;
    document.getElementById('level-select').value = settings.level;
    document.getElementById('rate-select').value = String(settings.rate);
    document.getElementById('pause-select').value = String(settings.pauseMs);
    document.getElementById('eleven-key-input').value = settings.elevenKey;
    document.getElementById('eleven-voice-input').value = settings.elevenVoiceId;
    populateVoiceSelect();
    document.getElementById('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
    document.getElementById('settings-overlay').classList.add('hidden');
}

function wireUi() {
    document.getElementById('voice-trigger').addEventListener('click', startListening);
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    document.getElementById('banner-settings-link').addEventListener('click', openSettings);

    document.getElementById('settings-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeSettings();
    });

    document.getElementById('save-settings-btn').addEventListener('click', () => {
        settings.apiKey = document.getElementById('api-key-input').value.trim();
        settings.model = document.getElementById('model-select').value;
        settings.level = document.getElementById('level-select').value;
        settings.voiceURI = document.getElementById('voice-select').value;
        settings.rate = parseFloat(document.getElementById('rate-select').value) || 0.95;
        settings.elevenKey = document.getElementById('eleven-key-input').value.trim();
        settings.elevenVoiceId = document.getElementById('eleven-voice-input').value.trim()
            || DEFAULT_SETTINGS.elevenVoiceId;
        settings.pauseMs = parseInt(document.getElementById('pause-select').value, 10);
        if (Number.isNaN(settings.pauseMs)) settings.pauseMs = DEFAULT_SETTINGS.pauseMs;
        ttsCache.clear();
        saveSettings();
        initClient();
        closeSettings();
        addSystemNote(client
            ? `Settings saved — chatting with ${settings.model} (${settings.level}).`
            : 'Settings saved — no API key, running in demo mode.');
    });

    // Preview the currently selected voice & speed without saving.
    document.getElementById('test-voice-btn').addEventListener('click', async () => {
        const saved = { ...settings };
        settings.voiceURI = document.getElementById('voice-select').value;
        settings.rate = parseFloat(document.getElementById('rate-select').value) || 0.95;
        settings.elevenKey = document.getElementById('eleven-key-input').value.trim();
        settings.elevenVoiceId = document.getElementById('eleven-voice-input').value.trim()
            || DEFAULT_SETTINGS.elevenVoiceId;
        try {
            await speakText('Hej! Jag heter Svea. Vad roligt att träffas!', 'sv');
        } finally {
            Object.assign(settings, saved);
        }
    });

    document.getElementById('reset-chat-btn').addEventListener('click', () => {
        history = [];
        document.getElementById('conversation-flow').replaceChildren();
        closeSettings();
        addBotMessage({
            sv: "Vi börjar om! Hej igen — vad vill du prata om?",
            en: "Let's start over! Hi again — what do you want to talk about?"
        }, { speak: false });
    });
}

// Dev hook: lets automated tests inject "speech" without a microphone.
window.__tutor = {
    say: handleUserSpeech,
    getState: () => currentState,
    getHistory: () => history,
    _rec: () => recognition
};

// Start the app
init();
