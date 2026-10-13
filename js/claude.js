import { settings, translationLang } from './settings.js';
import {
    tutorSystemPrompt, TUTOR_OUTPUT_FORMAT, pasteSystemPrompt, PASTE_OUTPUT_FORMAT
} from './prompts.js';
import { recordUsage } from './cost.js';

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

let client = null;
let history = [];   // Anthropic MessageParam[] — the whole tutor conversation

// (Re)creates the client from the saved key; returns whether there is one.
export function initClient() {
    client = AnthropicSDK && settings.apiKey
        ? new AnthropicSDK({
            apiKey: settings.apiKey,
            dangerouslyAllowBrowser: true,
            // Absorb transient 429/5xx/529 blips (SDK default is 2 retries).
            maxRetries: 4
        })
        : null;
    return client !== null;
}

export const hasClient = () => client !== null;
export const getHistory = () => history;
export function resetHistory() { history = []; }

// Models that can rescue a rare safety decline via server-side fallback
// (Haiku has none).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

// Every Claude call goes through here.
// - Thinking is always on for these models; effort "low" keeps it short.
//   The tutor history replays the model's thinking blocks, which are only
//   valid while everything before them is unchanged. If the level or
//   translation language (and with it the system prompt) changes mid-chat,
//   or the model does, the stale blocks are dropped instead of failing.
// - Opus and Sonnet opt into server-side refusal fallbacks, so a rare
//   safety decline is retried on another model in the same call.
function createMessage(request) {
    const betas = ["thinking-binding-controls-2026-08-01"];
    const extra = {};
    if (FALLBACK_MODELS.has(request.model)) {
        betas.push("server-side-fallback-2026-07-01");
        extra.fallbacks = "default";
    }
    return client.beta.messages.create({
        ...request,
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        betas,
        ...extra
    });
}

// One tutor turn. The chat shows only the primary transcript, but the model
// also gets the recognizer's alternative hearings — invaluable for learner
// accents. Resolves to { turn } or { failed: 'refused' | 'unreadable' }.
export async function askTutor(userText, alts = []) {
    const content = alts.length
        ? `${userText}\n\n[speech recognition also heard: ${alts.map(a => `"${a}"`).join(' / ')}]`
        : userText;
    history.push({ role: "user", content });

    let response;
    try {
        response = await createMessage({
            model: settings.model,
            max_tokens: 4000,
            system: tutorSystemPrompt(settings.level, translationLang().name),
            messages: history,
            cache_control: { type: "ephemeral" },
            output_config: { effort: "low", format: TUTOR_OUTPUT_FORMAT }
        });
    } catch (err) {
        history.pop();
        throw err;
    }
    recordUsage(response);

    if (response.stop_reason === "refusal") {
        history.pop();
        return { failed: 'refused' };
    }
    // Keep the full content blocks (incl. thinking) so they can be echoed
    // back on the next turn, as the API expects.
    history.push({ role: "assistant", content: response.content });

    try {
        return { turn: JSON.parse(response.content.find(b => b.type === "text").text) };
    } catch {
        return { failed: 'unreadable' };
    }
}

// Splits pasted text into translated, glossed sentences. Stateless — it
// doesn't touch the tutor conversation. Resolves to { sentences } or
// { problem } with a message for the learner.
export async function explainText(text) {
    const response = await createMessage({
        model: settings.model,
        max_tokens: 16000,
        system: pasteSystemPrompt(translationLang().name),
        messages: [{ role: "user", content: `<text>\n${text}\n</text>` }],
        output_config: { effort: "low", format: PASTE_OUTPUT_FORMAT }
    });
    recordUsage(response);

    if (response.stop_reason === "refusal") {
        return { problem: "Claude declined to translate this text." };
    }
    if (response.stop_reason === "max_tokens") {
        return { problem: "That text was too long to translate in one go — try a shorter piece." };
    }
    try {
        const { sentences } = JSON.parse(response.content.find(b => b.type === "text").text);
        if (sentences.length > 0) return { sentences };
    } catch { /* fall through */ }
    return { problem: "Couldn't read the translation — try again." };
}

// What to tell the learner about a failed call: { message, retryable, auth }.
export function describeApiError(err) {
    const SDK = AnthropicSDK;
    if (SDK && err instanceof SDK.AuthenticationError) {
        return { auth: true, message: "Your API key was rejected — check it in Settings." };
    }
    if (SDK && err instanceof SDK.RateLimitError) {
        return { retryable: true, message: "Rate limited by the API — wait a moment and try again." };
    }
    if (SDK && err instanceof SDK.APIError && (err.status === 529 || err.status === 503)) {
        return { retryable: true, message: "The AI service is temporarily overloaded — it usually recovers in seconds. Retry, or switch model in ⚙️ Settings." };
    }
    if (SDK && err instanceof SDK.APIError) {
        return { retryable: true, message: `The tutor service returned an error (${err.status}).` };
    }
    return { retryable: true, message: "Could not reach the tutor service — check your connection." };
}
