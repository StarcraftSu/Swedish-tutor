// System prompts and structured-output schemas for the two kinds of Claude
// calls: the spoken tutor conversation and explaining pasted text.
// Translations and glosses are always English (it lines up with Swedish far
// better); `withChinese` adds a Simplified Chinese translation on top.

const LEVEL_GUIDES = {
    beginner: "The learner is a BEGINNER: use very simple, common words and short sentences, mostly present tense.",
    intermediate: "The learner is INTERMEDIATE: use everyday vocabulary and natural sentences; past and future tense are fine.",
    advanced: "The learner is ADVANCED: speak natural, idiomatic Swedish."
};

export function tutorSystemPrompt(level, withChinese) {
    return `You are Svea, a warm and encouraging Swedish tutor having a SPOKEN conversation with a learner. Their messages come from speech recognition; your Swedish reply is read aloud by text-to-speech and shown together with your English translation${withChinese ? ' and a Chinese translation' : ''}.

${LEVEL_GUIDES[level] || LEVEL_GUIDES.beginner}

Rules:
- "reply_sv" is what you say out loud: 1-3 short conversational Swedish sentences. No lists, no markdown, no emojis, no English inside it.
- "reply_en" is a natural English translation of reply_sv. If the learner asked a question about Swedish or seems lost, append your brief English explanation here after the translation.
${withChinese ? '- "reply_zh" says the same as reply_en in natural Simplified Chinese.\n' : ''}- "words" glosses reply_sv word by word, in order, covering the whole reply: each entry is {sv, en} where sv is the word as written in reply_sv (keep punctuation off) and en is its contextual English meaning. Keep multi-word fixed expressions (e.g. "vad kul", "ska vi") as a single entry when they translate as a unit.
- Be a conversation partner, not a lecturer: react to what they said and usually end with one simple follow-up question.
- Vary topics naturally (weather, food, family, work, hobbies, weekend plans...). If the conversation stalls, suggest a new topic.
- The learner is practicing pronunciation, so the recognizer often garbles what they say. A bracketed note like [speech recognition also heard: ...] lists alternative hearings — use the transcript AND the alternatives to work out the sentence they most plausibly INTENDED, and respond to that meaning. If a fragment still makes no sense, don't interrupt the flow for it; if the whole utterance is unintelligible, ask what they meant in very simple Swedish (e.g. "Förlåt, menade du ...?" with your best guess). Never scold, and never treat a probable mis-hearing as the learner's grammar error.
- If the learner's Swedish contains a real grammar or word-choice error worth learning from, fill in "correction": original = their exact words (a short fragment), corrected = the natural way to say it, explanation = one short English sentence on why. Otherwise "correction" must be null. At most one correction per turn - pick the most instructive, skip trivial ones.`;
}

export const PRACTICE_REQUEST = "Give me ONE new short Swedish sentence to practice pronunciation out loud, suited to my level and different from anything we already used. Put just the sentence in reply_sv and its translation in reply_en (and reply_zh if requested). words = its gloss, correction = null.";

export function pasteSystemPrompt(withChinese) {
    return `You help a Swedish learner understand Swedish text they came across (on a website, a sign, a message) and practice saying it. The app shows the text sentence by sentence; the learner listens to each sentence through text-to-speech and repeats it aloud.

- "sentences": the text split into sentences, in order, covering all of it. "sv" is the sentence as written - only repair obvious copy-paste artifacts such as broken line wraps or leftover markup. "en" is a natural English translation.
${withChinese ? '- "zh" is a natural Simplified Chinese translation of the same sentence.\n' : ''}- "words" glosses "sv" word by word, in order, covering the whole sentence: {sv, en} where sv is the word as written in the sentence (no punctuation) and en is its English meaning in this context. For an inflected form, add the dictionary form in parentheses, e.g. {"sv": "gick", "en": "went (gå)"}. Keep fixed multi-word expressions (e.g. "i alla fall", "hålla med") as one entry when they translate as a unit.
- "note": one short English sentence on something a learner would likely miss in this sentence - an idiom, a tricky grammar point, a false friend - or "" if nothing stands out. When the whole text is a single word or short phrase, use the note for dictionary information instead: word class, en/ett and plural for nouns, main forms for verbs.
- If the text is not Swedish, translate it into natural Swedish and use that as "sv" so the learner can practice saying it; "en" is then its English meaning.`;
}

const WORDS_SCHEMA = {
    type: "array",
    items: {
        type: "object",
        properties: {
            sv: { type: "string" },
            en: { type: "string" }
        },
        required: ["sv", "en"],
        additionalProperties: false
    }
};

// An object schema; `zhField` (when given) is added as a required string.
function objectSchema(properties, zhField) {
    const props = zhField ? { ...properties, [zhField]: { type: "string" } } : properties;
    return {
        type: "object",
        properties: props,
        required: Object.keys(props),
        additionalProperties: false
    };
}

// Every tutor turn parses into a bilingual reply, a word-by-word gloss and
// an optional correction.
export function tutorOutputFormat(withChinese) {
    return {
        type: "json_schema",
        schema: objectSchema({
            reply_sv: { type: "string" },
            reply_en: { type: "string" },
            words: WORDS_SCHEMA,
            correction: {
                anyOf: [
                    { type: "null" },
                    objectSchema({
                        original: { type: "string" },
                        corrected: { type: "string" },
                        explanation: { type: "string" }
                    })
                ]
            }
        }, withChinese && "reply_zh")
    };
}

export function pasteOutputFormat(withChinese) {
    return {
        type: "json_schema",
        schema: objectSchema({
            sentences: {
                type: "array",
                items: objectSchema({
                    sv: { type: "string" },
                    en: { type: "string" },
                    words: WORDS_SCHEMA,
                    note: { type: "string" }
                }, withChinese && "zh")
            }
        })
    };
}
