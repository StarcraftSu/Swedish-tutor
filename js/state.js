import { settings } from './settings.js';

// The app is always in exactly one of these states; the status badge, the
// main button and the hints under it follow it.
export const STATE = {
    IDLE: 'Ready',
    LISTENING: 'Listening...',
    PROCESSING: 'Thinking...',
    SPEAKING: 'Bot Speaking'
};

let current = STATE.IDLE;

export const getState = () => current;

export function setState(state, processingLabel = 'Thinking about your answer...') {
    current = state;
    const $ = (id) => document.getElementById(id);
    const trigger = $('voice-trigger');
    const triggerText = $('trigger-text');
    const procText = $('processing-text');
    const listenHint = $('listening-hint');

    $('status-badge').className = 'status-badge ' +
        (state === STATE.IDLE ? 'status-ready' :
         state === STATE.LISTENING ? 'status-listening' :
         state === STATE.PROCESSING ? 'status-processing' : 'status-speaking');
    $('status-text').innerText = state;

    if (state === STATE.LISTENING) {
        trigger.className = 'main-btn btn-stop listening';
        triggerText.innerText = 'Stop speaking';
        procText.classList.add('hidden');
        listenHint.textContent = settings.pauseMs > 0
            ? `Take your time — sends after ${(settings.pauseMs / 1000).toFixed(1).replace('.0', '')}s of silence, or press Stop.`
            : 'Take your time — sends only when you press Stop.';
        listenHint.classList.remove('hidden');
    } else if (state === STATE.PROCESSING) {
        procText.textContent = processingLabel;
        procText.classList.remove('hidden');
        listenHint.classList.add('hidden');
    } else {
        trigger.className = 'main-btn btn-start';
        triggerText.innerText = 'Start speaking';
        procText.classList.add('hidden');
        listenHint.classList.add('hidden');
    }
}
