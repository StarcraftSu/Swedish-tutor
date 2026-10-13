import { settings } from './settings.js';
import { STATE, getState, setState } from './state.js';
import { stopSpeaking } from './speech.js';
import { addSystemNote } from './ui.js';

// Speech recognition (sv-SE) plus a recording of the learner's real voice.
//
// Continuous listening: the browser's own endpointing cuts learners off at
// the first thinking-pause, so results are accumulated here and the
// utterance only ends after `settings.pauseMs` of silence (or on Stop).
//
// Whoever starts listening passes a handler:
//   live(text)                      transcript so far, while speaking
//   isComplete(text)    (optional)  true once nothing more is expected
//   done(text, alts, heardNothing)  the final transcript ('' if none) and
//                                   alternative hearings; may return a
//                                   callback that receives the recording

let recognition = null;
let handler = null;
let finalText = '';
let alt2 = '';              // 2nd/3rd-best hearings, per final segment
let alt3 = '';
let interim = '';
let silenceTimer = null;
let heardNothing = false;

export const getRecognition = () => recognition;

export function initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = 'sv-SE';
    recognition.interimResults = true;
    recognition.continuous = true;
    // Learner accents confuse the recognizer; alternative hearings are
    // passed along so the tutor can work out what was meant.
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
        finalText = alt2 = alt3 = interim = '';
        heardNothing = false;
        setState(STATE.LISTENING);
        // Longer initial window: give the learner time to start talking.
        if (settings.pauseMs > 0) armSilenceTimer(Math.max(8000, settings.pauseMs));
    };

    recognition.onresult = (event) => {
        interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) {
                finalText += r[0].transcript;
                alt2 += (r[1] ? r[1].transcript : r[0].transcript);
                alt3 += (r[2] ? r[2].transcript : r[0].transcript);
            } else {
                interim += r[0].transcript;
            }
        }
        const text = clean(finalText + ' ' + interim);
        if (text) handler?.live(text);
        // Nothing left to wait for (e.g. a repeated sentence came through whole).
        armSilenceTimer(handler?.isComplete?.(text) ? 700 : settings.pauseMs);
    };

    recognition.onerror = (event) => {
        console.error("Speech error", event.error);
        if (event.error === 'no-speech') {
            heardNothing = true;
        } else if (event.error === 'not-allowed') {
            addSystemNote("Microphone access was denied — allow it in the browser to practice speaking.");
        }
        // onend fires after onerror and handles state + any partial text.
    };

    recognition.onend = () => {
        clearTimeout(silenceTimer);
        const text = clean(finalText + ' ' + interim);
        const alts = [clean(alt2), clean(alt3)]
            .filter(a => a && a.toLowerCase() !== text.toLowerCase())
            .filter((a, i, arr) => arr.indexOf(a) === i);
        finalText = alt2 = alt3 = interim = '';
        if (getState() === STATE.LISTENING) setState(STATE.IDLE);

        const h = handler;
        handler = null;
        const onRecording = h ? h.done(text, alts, heardNothing) : null;
        stopRecorder(onRecording);
    };
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

function armSilenceTimer(ms) {
    clearTimeout(silenceTimer);
    if (settings.pauseMs > 0) {
        silenceTimer = setTimeout(() => {
            try { recognition.stop(); } catch { /* already stopped */ }
        }, ms);
    }
}

// Starts listening for `h` — or, if already listening, stops (Stop button).
export function startListening(h) {
    if (!recognition) {
        alert("Your browser does not support Speech Recognition. Please use Chrome.");
        return;
    }
    if (getState() === STATE.LISTENING) {
        recognition.stop();
        return;
    }
    if (getState() === STATE.PROCESSING) return;

    // Never listen while the bot is talking — the mic would hear it.
    stopSpeaking();
    handler = h;
    startRecorder().finally(() => {
        try { recognition.start(); } catch { /* already started */ }
    });
}

export function stopListening() {
    if (recognition && getState() === STATE.LISTENING) recognition.stop();
}

// --- The learner's real audio (MediaRecorder), for playback next to the TTS ---
let recorder = null;

async function startRecorder() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        const rec = new MediaRecorder(stream);
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
            if (blob.size > 0 && rec.onRecording) rec.onRecording(blob);
        };
        recorder = rec;
        rec.start();
    } catch {
        recorder = null; // no recording — the rest still works
    }
}

function stopRecorder(onRecording) {
    if (recorder && recorder.state !== 'inactive') {
        recorder.onRecording = onRecording;
        recorder.stop();
    }
    recorder = null;
}
