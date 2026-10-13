import { el, smallButton, appendToFlow, addSystemNote } from './ui.js';
import { speakText, stopSpeaking } from './speech.js';
import { startListening } from './mic.js';
import { STATE, getState, setState } from './state.js';
import { hasClient, askTutor } from './claude.js';
import { PRACTICE_REQUEST } from './prompts.js';
import { PRACTICE_SENTENCES, localize, pick } from './canned.js';
import { reportApiError } from './errors.js';

// Listen & repeat: the learner says a known sentence and each word is marked
// green (recognized), yellow (close — only in an alternative hearing) or
// red (didn't come through).

// The exercise the microphone's next result is scored against, or null:
// { sv, attemptsEl, liveLine, onExit, next?, inline? }
let target = null;

export const isRepeating = () => target !== null;
export const getRepeatTarget = () => target;

export function setRepeatTarget(t) {
    exitRepeat();
    target = t;
}

export function exitRepeat() {
    if (target) {
        target.onExit();
        target = null;
    }
}

const normToken = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export function scoreAgainstTarget(targetText, heard, alts = []) {
    const tokens = targetText.split(/\s+/).filter(Boolean);
    const t = tokens.map(normToken);
    const h = heard.split(/\s+/).map(normToken).filter(Boolean);

    // Longest-common-subsequence alignment between target and heard words.
    const dp = Array.from({ length: t.length + 1 }, () => new Array(h.length + 1).fill(0));
    for (let i = t.length - 1; i >= 0; i--) {
        for (let j = h.length - 1; j >= 0; j--) {
            dp[i][j] = t[i] === h[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const status = new Array(t.length).fill('miss');
    let i = 0, j = 0;
    while (i < t.length && j < h.length) {
        if (t[i] === h[j]) { status[i] = 'hit'; i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    const altWords = new Set(alts.flatMap(a => a.split(/\s+/).map(normToken)));
    for (let k = 0; k < t.length; k++) {
        if (status[k] === 'miss' && altWords.has(t[k])) status[k] = 'partial';
    }
    const hits = status.filter(s => s === 'hit').length;
    const partials = status.filter(s => s === 'partial').length;
    return { tokens, status, hits, partials, total: t.length };
}

export const repeatListener = {
    live(text) {
        if (target) target.liveLine.textContent = '🎙 ' + text;
    },
    isComplete(text) {
        if (!target) return false;
        const { hits, total } = scoreAgainstTarget(target.sv, text);
        return total > 0 && hits === total;
    },
    done(text, alts, heardNothing) {
        if (!target) return null;
        if (!text) {
            target.liveLine.textContent = heardNothing ? "🎙 Didn't hear anything — try again." : '';
            return null;
        }
        return showAttempt(text, alts);
    }
};

// Adds the scored attempt under the exercise; returns the callback that
// attaches the learner's recording once it is ready.
function showAttempt(heard, alts) {
    const rt = target;
    rt.liveLine.textContent = '';
    const { tokens, status, hits, partials, total } = scoreAgainstTarget(rt.sv, heard, alts);

    const row = el('div', 'attempt-row');
    const line = el('div', 'attempt-target');
    tokens.forEach((tok, i) => {
        if (i > 0) line.appendChild(document.createTextNode(' '));
        line.appendChild(el('span', 'rw-' + status[i], tok));
    });
    row.appendChild(line);
    const score = `${hits}/${total} words clear` + (partials ? `, ${partials} close` : '');
    row.appendChild(el('div', 'attempt-heard', `Heard: "${heard}" — ${score}`));

    const controls = el('div', 'controls-row');
    controls.appendChild(smallButton('🎤 Try again', () => startListening(repeatListener)));
    if (rt.next) controls.appendChild(smallButton('Next sentence →', rt.next));
    if (rt.inline) controls.appendChild(smallButton('✓ Done', exitRepeat));
    row.appendChild(controls);
    rt.attemptsEl.appendChild(row);
    row.scrollIntoView({ block: 'nearest' });

    return (blob) => {
        const url = URL.createObjectURL(blob);
        controls.insertBefore(smallButton('▶ My attempt', () => new Audio(url).play()), controls.firstChild);
    };
}

// A practice card of its own at the end of the conversation.
export function startRepeatExercise({ sv, translation }) {
    stopSpeaking();

    const card = el('div', 'repeat-card');
    card.appendChild(el('div', 'repeat-label', 'Repeat'));
    const content = el('div', 'repeat-content');
    content.appendChild(el('div', 'repeat-sentence', sv));
    if (translation) content.appendChild(el('div', 'en-line', translation));

    const controls = el('div', 'controls-row');
    controls.appendChild(smallButton('🔊 Listen', () => speakText(sv)));
    controls.appendChild(smallButton('🐢 Slow', () => speakText(sv, 'sv-SE', { slow: true })));
    controls.appendChild(smallButton('🎤 Repeat it', () => startListening(repeatListener)));
    controls.appendChild(smallButton('✕ Done', exitRepeat));
    content.appendChild(controls);

    const liveLine = el('div', 'attempt-live');
    const attemptsEl = el('div', 'attempts');
    content.appendChild(liveLine);
    content.appendChild(attemptsEl);
    card.appendChild(content);
    appendToFlow(card);

    setRepeatTarget({ sv, attemptsEl, liveLine, onExit: () => card.classList.add('repeat-done') });
    speakText(sv);
}

// 🎯 button: ask the tutor for one fresh sentence to practice.
export async function requestPracticeSentence() {
    if (getState() === STATE.PROCESSING || getState() === STATE.LISTENING) return;
    if (!hasClient()) {
        startRepeatExercise(localize(pick(PRACTICE_SENTENCES)));
        return;
    }
    setState(STATE.PROCESSING, 'Finding a sentence for you...');
    try {
        const { turn } = await askTutor(PRACTICE_REQUEST);
        if (turn) startRepeatExercise({ sv: turn.reply_sv, translation: turn.reply_translation });
        else addSystemNote("Couldn't get a practice sentence — try again.");
    } catch (err) {
        reportApiError(err, requestPracticeSentence);
    } finally {
        if (getState() === STATE.PROCESSING) setState(STATE.IDLE);
    }
}
