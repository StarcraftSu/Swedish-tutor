import { translationLang } from './settings.js';
import { STATE, getState, setState } from './state.js';
import { el, smallButton, appendToFlow, scrollFlowToEnd, clearFlow, buildSvLine } from './ui.js';
import { speakText, stopSpeaking } from './speech.js';
import { startListening } from './mic.js';
import { hasClient, askTutor, resetHistory } from './claude.js';
import { startRepeatExercise, exitRepeat } from './practice.js';
import { GREETING, RESTART, NO_SPEECH, REFUSED, NOT_UNDERSTOOD, DEMO_REPLIES, localize, pick } from './canned.js';
import { reportApiError } from './errors.js';

// The spoken conversation with Svea.

export function initChat() {
    // Keyboard fallback for when recognition just won't cooperate.
    const typeRow = document.getElementById('type-row');
    const typeInput = document.getElementById('type-input');
    const sendTyped = () => {
        const text = typeInput.value.trim();
        if (!text || getState() === STATE.PROCESSING) return;
        typeInput.value = '';
        stopSpeaking();
        addUserMessage(text); // typed — there is no recording
        runTurn(text);
    };
    document.getElementById('type-toggle').addEventListener('click', () => {
        document.getElementById('paste-row').classList.add('hidden');
        typeRow.classList.toggle('hidden');
        if (!typeRow.classList.contains('hidden')) typeInput.focus();
    });
    document.getElementById('type-send').addEventListener('click', sendTyped);
    typeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) sendTyped();
    });

    // Shown but not auto-spoken: Chrome blocks TTS before the first user
    // gesture, so it would silently fail anyway.
    addBotMessage(localize(GREETING), { speak: false });
}

export function resetConversation() {
    resetHistory();
    exitRepeat();
    clearFlow();
    addBotMessage(localize(RESTART), { speak: false });
}

// Sends one already-transcribed utterance to the tutor. Kept separate from
// showing the learner's bubble so a Retry doesn't need them to say it again.
export async function runTurn(text, alts = []) {
    if (getState() === STATE.PROCESSING) return;
    setState(STATE.PROCESSING);

    if (!hasClient()) {
        setTimeout(() => addBotMessage(localize(demoReply(text))), 600);
        return;
    }

    try {
        const { turn, failed } = await askTutor(text, alts);
        if (failed) {
            addBotMessage(localize(failed === 'refused' ? REFUSED : NOT_UNDERSTOOD));
            return;
        }
        if (turn.correction) addCorrectionCard(turn.correction);
        addBotMessage({ sv: turn.reply_sv, translation: turn.reply_translation, words: turn.words || [] });
    } catch (err) {
        reportApiError(err, () => runTurn(text, alts));
        setState(STATE.IDLE);
    }
}

// For the dev hook: as if the learner had said `text`.
export async function handleUserSpeech(text) {
    addUserMessage(text);
    await runTurn(text);
}

function demoReply(input) {
    const lower = input.toLowerCase();
    for (const entry of Object.values(DEMO_REPLIES)) {
        if (entry.keywords && entry.keywords.some(k => lower.includes(k))) return pick(entry.responses);
    }
    return pick(DEMO_REPLIES.default.responses);
}

// --- Speaking to Svea ---
let liveBubble = null;      // the learner's bubble while they are still speaking

export const chatListener = {
    live(text) {
        if (!liveBubble) {
            liveBubble = addUserMessage(text);
            liveBubble.div.classList.add('live');
        } else {
            liveBubble.bubble.textContent = text;
            scrollFlowToEnd();
        }
    },
    done(text, alts, heardNothing) {
        const msg = liveBubble;
        liveBubble = null;
        if (!text) {
            msg?.div.remove();
            if (heardNothing) addBotMessage(localize(NO_SPEECH), { speak: false });
            return null;
        }
        const final = msg || addUserMessage(text);
        final.div.classList.remove('live');
        final.bubble.textContent = text;
        runTurn(text, alts);
        return final.attachRecording;
    }
};

// --- Messages ---
function addUserMessage(text) {
    const div = el('div', 'message user');
    const bubble = el('div', 'bubble', text);
    const controls = el('div', 'controls-row');
    div.appendChild(bubble);
    div.appendChild(controls);
    appendToFlow(div);

    // The learner's REAL audio, not TTS — added once the recording is ready.
    const attachRecording = (blob) => {
        const url = URL.createObjectURL(blob);
        controls.appendChild(smallButton('▶ Play my recording', () => new Audio(url).play()));
    };
    return { div, bubble, attachRecording };
}

// Bot messages are bilingual: Swedish on top (each word tappable for its
// meaning), the translation underneath.
export function addBotMessage({ sv, translation = '', words = [] }, { speak = true } = {}) {
    const lang = translationLang();
    const div = el('div', 'message bot');
    const bubble = el('div', 'bubble');
    bubble.appendChild(buildSvLine(sv, words));
    if (translation) bubble.appendChild(el('div', 'en-line', translation));
    div.appendChild(bubble);

    const controls = el('div', 'controls-row');
    controls.appendChild(smallButton('🔊 Play', () => speakText(sv)));
    if (translation) controls.appendChild(smallButton(`🔊 ${lang.label}`, () => speakText(translation, lang.voice)));
    controls.appendChild(smallButton('🎤 Repeat', () => startRepeatExercise({ sv, translation })));
    div.appendChild(controls);
    appendToFlow(div);

    if (speak) speakText(sv);
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
    controls.appendChild(smallButton('🔊 Hear it', () => speakText(correction.corrected)));
    controls.appendChild(smallButton('🔄 Try again', () => {
        exitRepeat();
        startListening(chatListener);
    }));
    content.appendChild(controls);

    card.appendChild(content);
    appendToFlow(card);
}
