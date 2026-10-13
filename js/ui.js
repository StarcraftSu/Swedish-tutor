import { speakText } from './speech.js';

// Small DOM helpers shared by every part of the conversation view. All
// user and model text goes in via textContent — it is never parsed as HTML.

export function el(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
}

export function smallButton(label, onClick) {
    const btn = el('button', 'btn-small', label);
    btn.addEventListener('click', onClick);
    return btn;
}

const flow = () => document.getElementById('conversation-flow');

export function appendToFlow(node) {
    flow().appendChild(node);
    scrollFlowToEnd();
}

export function scrollFlowToEnd() {
    const f = flow();
    f.scrollTop = f.scrollHeight;
}

export const clearFlow = () => flow().replaceChildren();

// The translation line(s) under a Swedish sentence: English, plus Chinese
// when that setting is on.
export function appendTranslations(parent, { en, zh }) {
    if (en) parent.appendChild(el('div', 'en-line', en));
    if (zh) parent.appendChild(el('div', 'zh-line', zh));
}

export function addSystemNote(text, retry) {
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
    return note;
}

// Shows the Swedish exactly as written (punctuation included) and makes each
// glossed word or expression tappable. Gloss entries ({sv, en}) are
// matched in order; one that can't be found close to where the previous one
// ended is skipped rather than allowed to swallow a chunk of the text.
export function buildSvLine(sv, words = []) {
    const line = el('div', 'sv-line');
    let cursor = 0;
    for (const w of words) {
        const m = findWord(sv, w.sv, cursor);
        if (!m) continue;
        const gap = sv.slice(cursor, m.index);
        if ((gap.match(/[\p{L}\p{N}]+/gu) || []).length > 2) continue;
        if (gap) line.appendChild(document.createTextNode(gap));
        const span = el('span', 'w', m.text);
        span.addEventListener('click', (e) => {
            e.stopPropagation();
            showGloss(span, m.text, w.en);
        });
        line.appendChild(span);
        cursor = m.index + m.text.length;
    }
    if (cursor < sv.length) line.appendChild(document.createTextNode(sv.slice(cursor)));
    return line;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word, case-insensitive search for `word` in `text` from `from` on.
function findWord(text, word, from) {
    const parts = word.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (parts.length === 0) return null;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    re.lastIndex = from;
    const m = re.exec(text);
    return m ? { index: m.index, text: m[0] } : null;
}

// --- Word gloss popover ---
let glossPop = null;

export function initGloss() {
    document.addEventListener('click', hideGloss);
    flow().addEventListener('scroll', hideGloss);
}

function showGloss(anchor, sv, en) {
    hideGloss();
    glossPop = el('div', 'gloss-pop');
    glossPop.appendChild(el('span', 'gloss-sv', sv));
    glossPop.appendChild(document.createTextNode(' = '));
    glossPop.appendChild(el('span', 'gloss-en', en));
    const hear = smallButton('🔊', (e) => { e.stopPropagation(); speakText(sv); });
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
