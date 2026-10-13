import { STATE, getState, setState } from './state.js';
import { el, smallButton, appendToFlow, addSystemNote, buildSvLine } from './ui.js';
import { speakText, stopSpeaking, speechGeneration } from './speech.js';
import { startListening, stopListening } from './mic.js';
import { hasClient, explainText } from './claude.js';
import { repeatListener, setRepeatTarget, getRepeatTarget, exitRepeat } from './practice.js';
import { reportApiError } from './errors.js';

// Paste, translate & shadow: Swedish copied from anywhere becomes a reader
// card — each sentence with its translation, tappable words, normal and slow
// playback, and shadowing (listen, then repeat it, word by word scored).

const PASTE_MAX_CHARS = 2000;

const $ = (id) => document.getElementById(id);

export function initReader() {
    const input = $('paste-input');
    $('paste-toggle').addEventListener('click', () => {
        if ($('paste-row').classList.contains('hidden')) openPasteRow();
        else $('paste-row').classList.add('hidden');
    });
    $('paste-send').addEventListener('click', () => runPaste(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            runPaste(input.value);
        }
    });

    // ⌘V / Ctrl+V anywhere on the page (outside a text field) translates
    // straight away.
    document.addEventListener('paste', (e) => {
        if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
        if (!$('settings-overlay').classList.contains('hidden')) return;
        const text = e.clipboardData?.getData('text/plain') || '';
        if (!text.trim()) return;
        e.preventDefault();
        runPaste(text);
    });
}

function openPasteRow(text) {
    $('type-row').classList.add('hidden');
    $('paste-row').classList.remove('hidden');
    if (text !== undefined) $('paste-input').value = text;
    $('paste-input').focus();
}

function closePasteRow() {
    $('paste-input').value = '';
    $('paste-row').classList.add('hidden');
}

export async function runPaste(raw) {
    const text = raw.trim();
    if (!text) return;
    // Busy, or too long: keep the text in the box rather than drop it.
    if (getState() === STATE.PROCESSING || getState() === STATE.LISTENING) {
        openPasteRow(text);
        return;
    }
    if (text.length > PASTE_MAX_CHARS) {
        openPasteRow(text);
        addSystemNote(`That's ${text.length.toLocaleString()} characters — paste up to ${PASTE_MAX_CHARS.toLocaleString()} (a few paragraphs) at a time.`);
        return;
    }
    stopSpeaking();
    exitRepeat();
    closePasteRow();

    if (!hasClient()) {
        addReaderCard(splitSentences(text).map(sv => ({ sv })));
        addSystemNote('No API key, so no translation — you can still listen and shadow. Add a key in ⚙️ Settings for translations.');
        return;
    }

    setState(STATE.PROCESSING, 'Translating...');
    try {
        const { sentences, problem } = await explainText(text);
        if (sentences) addReaderCard(sentences);
        else addSystemNote(problem);
    } catch (err) {
        reportApiError(err, () => runPaste(text));
    } finally {
        if (getState() === STATE.PROCESSING) setState(STATE.IDLE);
    }
}

function splitSentences(text) {
    const segmenter = new Intl.Segmenter('sv', { granularity: 'sentence' });
    return [...segmenter.segment(text)]
        .map(s => s.segment.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

// sentences: [{ sv, translation?, words?, note? }]
function addReaderCard(sentences) {
    const card = el('div', 'reader-card');
    const head = el('div', 'reader-head');
    head.appendChild(el('span', 'reader-label', 'Translate'));
    const items = [];

    if (sentences.length > 1) {
        const headControls = el('div', 'controls-row');
        headControls.appendChild(smallButton('▶ Play all', () => playAll(items)));
        headControls.appendChild(smallButton('🎤 Shadow all', () => shadowSentence(items[0])));
        head.appendChild(headControls);
    }
    card.appendChild(head);

    sentences.forEach((s, i) => {
        const row = el('div', 'reader-sentence');
        row.appendChild(buildSvLine(s.sv, s.words));
        if (s.translation) row.appendChild(el('div', 'en-line', s.translation));
        if (s.note) row.appendChild(el('div', 'reader-note', '💡 ' + s.note));

        const item = {
            sv: s.sv,
            row,
            liveLine: el('div', 'attempt-live'),
            attemptsEl: el('div', 'attempts'),
            next: i + 1 < sentences.length ? () => shadowSentence(items[i + 1]) : null
        };
        const controls = el('div', 'controls-row');
        controls.appendChild(smallButton('🔊 Play', () => speakText(s.sv)));
        controls.appendChild(smallButton('🐢 Slow', () => speakText(s.sv, 'sv-SE', { slow: true })));
        controls.appendChild(smallButton('🎤 Shadow', () => shadowSentence(item)));
        row.appendChild(controls);
        row.appendChild(item.liveLine);
        row.appendChild(item.attemptsEl);

        items.push(item);
        card.appendChild(row);
    });

    appendToFlow(card);
    card.scrollIntoView({ block: 'start' });
}

// Shadowing one sentence: play it, then listen as soon as it has finished.
async function shadowSentence(item) {
    if (getState() === STATE.PROCESSING) return;
    if (getState() === STATE.LISTENING) {
        stopListening(); // finishes the attempt in progress
        return;
    }
    const target = {
        sv: item.sv,
        attemptsEl: item.attemptsEl,
        liveLine: item.liveLine,
        next: item.next,
        inline: true,
        onExit: () => item.row.classList.remove('shadowing')
    };
    setRepeatTarget(target);
    item.liveLine.textContent = '';
    item.row.classList.add('shadowing');
    item.row.scrollIntoView({ block: 'nearest' });

    const finished = await speakText(item.sv);
    if (finished && getRepeatTarget() === target && getState() === STATE.IDLE) {
        startListening(repeatListener);
    }
}

async function playAll(items) {
    if (getState() === STATE.PROCESSING || getState() === STATE.LISTENING) return;
    exitRepeat();
    for (const item of items) {
        item.row.classList.add('playing');
        item.row.scrollIntoView({ block: 'nearest' });
        const done = speakText(item.sv);
        const generation = speechGeneration();
        const finished = await done;
        item.row.classList.remove('playing');
        if (!finished) return;
        await new Promise(r => setTimeout(r, 350));
        // Stop if anything else started meanwhile (other playback, the mic).
        if (speechGeneration() !== generation || getState() !== STATE.IDLE) return;
    }
}
