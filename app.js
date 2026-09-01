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
const DEFAULT_SETTINGS = { apiKey: '', model: 'claude-opus-5', level: 'beginner' };

let currentState = STATE.IDLE;
let recognition = null;
const synth = window.speechSynthesis;
let swedishVoice = null;

let settings = loadSettings();
let client = null;
let history = [];           // Anthropic MessageParam[] — full conversation
let recorder = null;        // MediaRecorder for the learner's real audio
let recorderChunks = [];
let attachAudioTarget = null; // callback receiving the finished Blob

const LEVEL_GUIDES = {
    beginner: "The learner is a BEGINNER: use very simple, common words and short sentences, mostly present tense. After a hard Swedish word, you may add a short English gloss in parentheses.",
    intermediate: "The learner is INTERMEDIATE: use everyday vocabulary and natural sentences; past and future tense are fine. Only use English when they ask or are clearly stuck.",
    advanced: "The learner is ADVANCED: speak natural, idiomatic Swedish. Avoid English unless explicitly asked."
};

function systemPrompt() {
    return `You are Svea, a warm and encouraging Swedish tutor having a SPOKEN conversation with a learner. Their messages come from speech recognition and your reply is read aloud by text-to-speech.

${LEVEL_GUIDES[settings.level] || LEVEL_GUIDES.beginner}

Rules:
- "reply" is what you say out loud: 1-3 short conversational sentences. No lists, no markdown, no emojis.
- Stay in Swedish by default (reply_lang "sv"). If the learner asks for a translation or is clearly lost, help briefly in English (reply_lang "en"), then invite them back to Swedish.
- Be a conversation partner, not a lecturer: react to what they said and usually end with one simple follow-up question.
- Vary topics naturally (weather, food, family, work, hobbies, weekend plans...). If the conversation stalls, suggest a new topic.
- The transcript may contain speech-recognition mistakes. Interpret charitably, never scold, and do not correct things that are probably transcription artifacts rather than the learner's own error.
- If the learner's Swedish contains a real grammar or word-choice error worth learning from, fill in "correction": original = their exact words (a short fragment), corrected = the natural way to say it, explanation = one short English sentence on why. Otherwise "correction" must be null. At most one correction per turn - pick the most instructive, skip trivial ones.`;
}

// Structured output: guarantees every turn parses into reply + optional correction.
const TUTOR_OUTPUT_FORMAT = {
    type: "json_schema",
    schema: {
        type: "object",
        properties: {
            reply: { type: "string" },
            reply_lang: { type: "string", enum: ["sv", "en"] },
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
        required: ["reply", "reply_lang", "correction"],
        additionalProperties: false
    }
};

// Canned fallback so the page still demos without an API key.
const DEMO_BOT = {
    greetings: {
        keywords: ['hej', 'hallå', 'hello', 'hi'],
        responses: ["Hej! Hur mår du idag?", "Hallå! Vad kul att se dig. Hur går det med svenskan?"],
        lang: 'sv'
    },
    default: {
        responses: ["Intressant! Berätta mer om det.", "Jag förstår. Kan du förklara det lite mer på svenska?"],
        lang: 'sv'
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
    addBotMessage(
        "Hej! Jag är Svea, din svensklärare. Tryck på knappen och prata med mig! (Hi! I'm Svea, your Swedish teacher. Press the button and talk to me!)",
        'sv',
        { speak: false }
    );

    if (!settings.apiKey) openSettings();
}

function loadVoices() {
    const voices = synth.getVoices();
    swedishVoice = voices.find(v => v.lang.startsWith('sv')) || null;
    if (voices.length > 0) {
        document.getElementById('voice-banner').classList.toggle('hidden', !!swedishVoice);
    }
}

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = 'sv-SE';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => updateState(STATE.LISTENING);
    recognition.onend = () => {
        stopRecorder();
        if (currentState === STATE.LISTENING) updateState(STATE.IDLE);
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        handleUserSpeech(transcript);
    };

    recognition.onerror = (event) => {
        console.error("Speech error", event.error);
        stopRecorder();
        updateState(STATE.IDLE);
        if (event.error === 'no-speech') {
            addBotMessage("Jag hörde ingenting. Försök igen!", 'sv', { speak: false });
        } else if (event.error === 'not-allowed') {
            addSystemNote("Microphone access was denied — allow it in the browser to practice speaking.");
        }
    };
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

    if (state === STATE.LISTENING) {
        trigger.className = 'main-btn btn-stop listening';
        triggerText.innerText = 'Stop speaking';
        procText.classList.add('hidden');
    } else if (state === STATE.PROCESSING) {
        procText.classList.remove('hidden');
    } else {
        trigger.className = 'main-btn btn-start';
        triggerText.innerText = 'Start speaking';
        procText.classList.add('hidden');
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
            const r = demoReply(text);
            addBotMessage(r.text, r.lang);
        }, 600);
        return;
    }

    try {
        const turn = await askTutor(text);
        if (turn.correction) addCorrectionCard(turn.correction);
        addBotMessage(turn.reply, turn.reply_lang);
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
            reply: "Förlåt, det där kan jag inte prata om. Ska vi byta ämne?",
            reply_lang: "sv",
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
        return { reply: textBlock ? textBlock.text : "Ursäkta, kan du säga det igen?", reply_lang: "sv", correction: null };
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
            return { text: pick(entry.responses), lang: entry.lang };
        }
    }
    return { text: pick(DEMO_BOT.default.responses), lang: DEMO_BOT.default.lang };
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
    div.appendChild(el('div', 'bubble', text));
    const controls = el('div', 'controls-row');
    div.appendChild(controls);
    appendToFlow(div);

    // The play button appears once the MediaRecorder blob is ready —
    // this is the learner's REAL audio, not TTS.
    attachAudioTarget = (blob) => {
        const url = URL.createObjectURL(blob);
        controls.appendChild(smallButton('▶ Play my recording', () => new Audio(url).play()));
    };
}

function addBotMessage(text, lang = 'sv', { speak = true } = {}) {
    const div = el('div', 'message bot');
    div.appendChild(el('div', 'bubble', text));
    const controls = el('div', 'controls-row');
    controls.appendChild(smallButton('🔊 Play', () => speakText(text, lang)));
    div.appendChild(controls);
    appendToFlow(div);

    if (speak) speakText(text, lang);
}

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
function speakText(text, lang) {
    synth.cancel();
    updateState(STATE.SPEAKING);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'sv' ? 'sv-SE' : 'en-US';
    if (lang === 'sv' && swedishVoice) utterance.voice = swedishVoice;

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
    synth.cancel();
    if (currentState === STATE.SPEAKING) updateState(STATE.IDLE);

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
        saveSettings();
        initClient();
        closeSettings();
        addSystemNote(client
            ? `Settings saved — chatting with ${settings.model} (${settings.level}).`
            : 'Settings saved — no API key, running in demo mode.');
    });

    document.getElementById('reset-chat-btn').addEventListener('click', () => {
        history = [];
        document.getElementById('conversation-flow').replaceChildren();
        closeSettings();
        addBotMessage("Vi börjar om! Hej igen — vad vill du prata om?", 'sv', { speak: false });
    });
}

// Dev hook: lets automated tests inject "speech" without a microphone.
window.__tutor = {
    say: handleUserSpeech,
    getState: () => currentState,
    getHistory: () => history
};

// Start the app
init();
