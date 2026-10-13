import { settings, saveSettings, DEFAULT_SETTINGS } from './settings.js';
import { voicesFor, voicesLoaded, speakText } from './speech.js';
import { initClient } from './claude.js';

// The ⚙️ Settings overlay, plus the banners that depend on settings.

const $ = (id) => document.getElementById(id);

// Re-creates the API client from the current settings; returns whether a
// real tutor is available (otherwise the app runs in canned demo mode).
export function refreshClient() {
    const ok = initClient();
    $('demo-banner').classList.toggle('hidden', ok);
    return ok;
}

export function onVoicesChanged() {
    if (voicesLoaded()) $('voice-banner').classList.toggle('hidden', voicesFor('sv-SE').length > 0);
    populateVoiceSelect();
}

function populateVoiceSelect() {
    const select = $('voice-select');
    const swedish = voicesFor('sv-SE');
    select.replaceChildren();
    if (swedish.length === 0) {
        select.appendChild(new Option('No Swedish voice found in this browser', ''));
        select.disabled = true;
        return;
    }
    select.disabled = false;
    select.appendChild(new Option('Auto (best available)', ''));
    for (const v of swedish) {
        select.appendChild(new Option(`${v.name} (${v.lang})`, v.voiceURI));
    }
    select.value = swedish.some(v => v.voiceURI === settings.voiceURI) ? settings.voiceURI : '';
}

export function openSettings() {
    $('api-key-input').value = settings.apiKey;
    $('model-select').value = settings.model;
    $('level-select').value = settings.level;
    $('lang-select').value = settings.lang;
    $('rate-select').value = String(settings.rate);
    $('pause-select').value = String(settings.pauseMs);
    $('eleven-key-input').value = settings.elevenKey;
    $('eleven-voice-input').value = settings.elevenVoiceId;
    populateVoiceSelect();
    $('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
    $('settings-overlay').classList.add('hidden');
}

// The voice fields as currently entered — used by Save and by the preview.
function voiceFields() {
    return {
        voiceURI: $('voice-select').value,
        rate: parseFloat($('rate-select').value) || DEFAULT_SETTINGS.rate,
        elevenKey: $('eleven-key-input').value.trim(),
        elevenVoiceId: $('eleven-voice-input').value.trim() || DEFAULT_SETTINGS.elevenVoiceId
    };
}

export function initSettingsPanel({ onSaved, onReset }) {
    $('settings-btn').addEventListener('click', openSettings);
    $('banner-settings-link').addEventListener('click', openSettings);
    $('settings-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeSettings();
    });

    $('save-settings-btn').addEventListener('click', () => {
        const pauseMs = parseInt($('pause-select').value, 10);
        Object.assign(settings, voiceFields(), {
            apiKey: $('api-key-input').value.trim(),
            model: $('model-select').value,
            level: $('level-select').value,
            lang: $('lang-select').value,
            pauseMs: Number.isNaN(pauseMs) ? DEFAULT_SETTINGS.pauseMs : pauseMs
        });
        saveSettings();
        closeSettings();
        onSaved(refreshClient());
    });

    // Preview the selected voice & speed without saving. speakText reads the
    // settings it needs synchronously, so they can be restored right away.
    $('test-voice-btn').addEventListener('click', () => {
        const saved = { ...settings };
        Object.assign(settings, voiceFields());
        speakText('Hej! Jag heter Svea. Vad roligt att träffas!');
        Object.assign(settings, saved);
    });

    $('reset-chat-btn').addEventListener('click', () => {
        closeSettings();
        onReset();
    });
}
