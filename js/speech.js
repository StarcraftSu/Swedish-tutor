import { settings } from './settings.js';
import { STATE, getState, setState } from './state.js';

// Text-to-speech: the browser's voices, or ElevenLabs for Swedish when a key
// is set (falling back to the browser voice if that call fails).

const synth = window.speechSynthesis;
let voices = [];

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

// Calls onChange whenever the browser's voice list (re)loads.
export function initVoices(onChange) {
    const load = () => {
        voices = synth.getVoices();
        onChange();
    };
    synth.onvoiceschanged = load;
    load();
}

export const voicesLoaded = () => voices.length > 0;

// Voices for a language tag such as 'sv-SE', best first.
export function voicesFor(tag) {
    const prefix = tag.slice(0, 2).toLowerCase();
    return voices
        .filter(v => v.lang.toLowerCase().startsWith(prefix))
        .sort((a, b) => voiceScore(b, tag) - voiceScore(a, tag));
}

function pickVoice(tag) {
    const candidates = voicesFor(tag);
    if (tag === 'sv-SE' && settings.voiceURI) {
        const chosen = candidates.find(v => v.voiceURI === settings.voiceURI);
        if (chosen) return chosen;
    }
    return candidates[0] || null;
}

let currentAudio = null;          // ElevenLabs playback in progress
let currentUtterance = null;      // held so Chrome doesn't GC it and drop onend
const ttsCache = new Map();       // voice|text -> object URL, so replays aren't re-billed
let speechSeq = 0;                // bumped whenever playback is stopped or replaced
let finishPlayback = null;        // resolves the pending speakText() promise

// Changes whenever playback is stopped or replaced — lets a sequence of
// sentences notice that something else took over.
export const speechGeneration = () => speechSeq;

export function stopSpeaking() {
    speechSeq++;
    synth.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    endPlayback(false);
    if (getState() === STATE.SPEAKING) setState(STATE.IDLE);
}

function endPlayback(completed) {
    const resolve = finishPlayback;
    finishPlayback = null;
    if (resolve) resolve(completed);
}

// Speaks `text` (Swedish unless another language tag is given). Resolves
// true once it has been spoken to the end, false if playback was stopped,
// replaced by other speech, or failed.
export function speakText(text, lang = 'sv-SE', { slow = false } = {}) {
    stopSpeaking();
    setState(STATE.SPEAKING);
    const seq = speechSeq;
    const done = new Promise((resolve) => { finishPlayback = resolve; });
    const finish = (completed) => {
        if (seq !== speechSeq) return; // already stopped or superseded
        if (getState() === STATE.SPEAKING) setState(STATE.IDLE);
        endPlayback(completed);
    };

    // Everything that depends on settings is read now, before any await, so
    // the voice preview can restore its temporary settings right away.
    const swedish = lang === 'sv-SE';
    const rate = swedish ? (settings.rate || 0.95) * (slow ? 0.75 : 1) : 1;
    const voice = pickVoice(lang);
    // ElevenLabs reads only the Swedish; translations use the browser voice
    // and don't eat into the character quota.
    const eleven = swedish && settings.elevenKey
        ? { key: settings.elevenKey, voiceId: settings.elevenVoiceId }
        : null;

    (async () => {
        if (eleven) {
            try {
                await speakWithElevenLabs(text, eleven, rate, seq, finish);
                return;
            } catch (err) {
                console.error('ElevenLabs TTS failed, falling back to browser voice', err);
                if (seq !== speechSeq) return;
            }
        }
        speakWithBrowser(text, lang, voice, rate, finish);
    })();
    return done;
}

async function speakWithElevenLabs(text, eleven, rate, seq, finish) {
    const cacheKey = `${eleven.voiceId}|${text}`;
    let url = ttsCache.get(cacheKey);
    if (!url) {
        const resp = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(eleven.voiceId)}`,
            {
                method: 'POST',
                headers: { 'xi-api-key': eleven.key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
            }
        );
        if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}`);
        url = URL.createObjectURL(await resp.blob());
        ttsCache.set(cacheKey, url);
    }
    if (seq !== speechSeq) return; // stopped while the audio was downloading
    const audio = new Audio(url);
    audio.playbackRate = rate;
    currentAudio = audio;
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    await audio.play();
}

function speakWithBrowser(text, lang, voice, rate, finish) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    currentUtterance = utterance;
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    synth.speak(utterance);
}
