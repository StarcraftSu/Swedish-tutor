// User settings. They live only in this browser (localStorage); each API key
// is sent only to its own service.
const SETTINGS_KEY = 'svenskatutor_settings';

export const DEFAULT_SETTINGS = {
    apiKey: '', model: 'claude-opus-5-5', level: 'beginner',
    // Language of translations, word glosses and explanations.
    lang: 'en',
    voiceURI: '', rate: 0.95,
    // Optional human-quality Swedish TTS via ElevenLabs; falls back to browser TTS.
    elevenKey: '', elevenVoiceId: '21m00Tcm4TlvDq8ikWAM',
    // Silence (ms) before an utterance is considered finished; 0 = only on Stop.
    pauseMs: 3000
};

// `name` goes into the prompts, `label` onto buttons, `voice` picks the
// text-to-speech voice that reads a translation aloud.
export const TRANSLATION_LANGS = {
    en: { name: 'English', label: 'English', voice: 'en-US' },
    zh: { name: 'Simplified Chinese', label: '中文', voice: 'zh-CN' }
};

// Saved settings may still name a model choice that has since been replaced.
const MODEL_UPGRADES = {
    'claude-opus-5': 'claude-opus-5-5',
    'claude-sonnet-5': 'claude-sonnet-5-5',
    'claude-haiku-4-5': 'claude-haiku-5-5'
};

// Mutated in place (Object.assign) so every module sees the current values.
export const settings = loadSettings();

function loadSettings() {
    let loaded;
    try {
        loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
        loaded = { ...DEFAULT_SETTINGS };
    }
    loaded.model = MODEL_UPGRADES[loaded.model] || loaded.model;
    if (!TRANSLATION_LANGS[loaded.lang]) loaded.lang = DEFAULT_SETTINGS.lang;
    return loaded;
}

export function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* private mode etc. — settings just won't persist */ }
}

export const translationLang = () => TRANSLATION_LANGS[settings.lang] || TRANSLATION_LANGS.en;
