import { describeApiError } from './claude.js';
import { addSystemNote } from './ui.js';
import { openSettings } from './settings-panel.js';

// Tells the learner what went wrong with a Claude call, with a Retry button
// when retrying could help.
export function reportApiError(err, retry = null) {
    console.error(err);
    const { message, retryable, auth } = describeApiError(err);
    addSystemNote(message, retryable ? retry : null);
    if (auth) openSettings();
}
