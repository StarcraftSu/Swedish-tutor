import { settings } from './settings.js';
import { el, smallButton, appendToFlow } from './ui.js';

// Live API cost, computed from each response's own token usage.

// USD per million tokens; cache writes bill at 1.25x input, cache reads at
// `cacheRead`. Haiku 5.5's rate is for prompts under 100K tokens, which every
// request here is. The older models are what a refusal fallback may answer with.
const PRICING = {
    'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
    'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
    'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
    'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
    'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2 },
    'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5 }
};
const USAGE_KEY = 'svenskatutor_usage';

const freshUsage = () => ({ cost: 0, inTok: 0, outTok: 0, turns: 0, since: new Date().toISOString().slice(0, 10) });

let sessionUsage = freshUsage();
let allTimeUsage = loadAllTimeUsage();

function loadAllTimeUsage() {
    try {
        const u = JSON.parse(localStorage.getItem(USAGE_KEY) || 'null');
        if (u && typeof u.cost === 'number') return u;
    } catch { /* fall through */ }
    return freshUsage();
}

function saveAllTimeUsage() {
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(allTimeUsage)); } catch { /* ok */ }
}

export function recordUsage(response) {
    const u = response.usage;
    if (!u) return;
    const price = PRICING[response.model] || PRICING[settings.model] || PRICING['claude-opus-5-5'];
    const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const outTok = u.output_tokens || 0;
    const cost = (
        (u.input_tokens || 0) * price.in +
        (u.cache_creation_input_tokens || 0) * price.in * 1.25 +
        (u.cache_read_input_tokens || 0) * price.cacheRead +
        outTok * price.out
    ) / 1e6;

    for (const usage of [sessionUsage, allTimeUsage]) {
        usage.cost += cost;
        usage.inTok += inTok;
        usage.outTok += outTok;
        usage.turns += 1;
    }
    saveAllTimeUsage();
    updateCostChip();
}

function fmtCost(c) {
    return '$' + (c < 0.1 ? c.toFixed(3) : c.toFixed(2));
}

function updateCostChip() {
    const chip = document.getElementById('cost-chip');
    chip.textContent = fmtCost(sessionUsage.cost);
    chip.classList.toggle('hidden', sessionUsage.turns === 0);
}

export function showCostDetails() {
    const note = el('div', 'system-note',
        `This session: ${fmtCost(sessionUsage.cost)} — ${sessionUsage.turns} requests, ` +
        `${sessionUsage.inTok.toLocaleString()} tokens in / ${sessionUsage.outTok.toLocaleString()} out. ` +
        `All time on this browser: ${fmtCost(allTimeUsage.cost)} since ${allTimeUsage.since} ` +
        `(${allTimeUsage.turns} requests).`);
    const resetBtn = smallButton('Reset all-time counter', () => {
        allTimeUsage = freshUsage();
        saveAllTimeUsage();
        resetBtn.disabled = true;
    });
    resetBtn.style.margin = '0.4rem auto 0';
    note.appendChild(resetBtn);
    appendToFlow(note);
}
