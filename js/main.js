import { settings } from './settings.js';
import { getState } from './state.js';
import { initVoices } from './speech.js';
import { initRecognition, startListening, getRecognition } from './mic.js';
import { initGloss, addSystemNote } from './ui.js';
import { showCostDetails } from './cost.js';
import { getHistory } from './claude.js';
import { initChat, chatListener, handleUserSpeech, resetConversation } from './chat.js';
import { isRepeating, repeatListener, startRepeatExercise, exitRepeat, requestPracticeSentence } from './practice.js';
import { initReader, runPaste } from './reader.js';
import { initSettingsPanel, openSettings, refreshClient, onVoicesChanged } from './settings-panel.js';

function init() {
    initRecognition();
    initVoices(onVoicesChanged);
    refreshClient();
    initGloss();
    initSettingsPanel({
        onSaved: (hasTutor) => addSystemNote(hasTutor
            ? `Settings saved — chatting with ${settings.model} (${settings.level}).`
            : 'Settings saved — no API key, running in demo mode.'),
        onReset: resetConversation
    });
    initChat();
    initReader();

    // The main button talks to Svea — or, while a listen-and-repeat
    // exercise is open, answers the exercise.
    document.getElementById('voice-trigger').addEventListener('click', () => {
        startListening(isRepeating() ? repeatListener : chatListener);
    });
    document.getElementById('practice-btn').addEventListener('click', requestPracticeSentence);
    document.getElementById('cost-chip').addEventListener('click', showCostDetails);

    if (!settings.apiKey) openSettings();
}

// Dev hook: lets automated tests drive the app without a microphone.
window.__tutor = {
    say: handleUserSpeech,
    paste: runPaste,
    getState,
    getHistory,
    _rec: getRecognition,
    _repeat: { start: startRepeatExercise, active: isRepeating, exit: exitRepeat }
};

init();
