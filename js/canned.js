import { settings } from './settings.js';

// Fixed Swedish lines: the greeting and a few stock replies, plus the demo
// bot and practice sentences used when there is no API key. Each has English
// and Chinese translations; words are [swedish, english] glosses.

export const GREETING = {
    sv: "Hej! Jag är Svea, din svensklärare. Tryck på knappen och prata med mig!",
    en: "Hi! I'm Svea, your Swedish teacher. Press the button and talk to me!",
    zh: "你好！我是 Svea，你的瑞典语老师。按下按钮，和我说话吧！",
    words: [
        ["Hej", "hi"], ["jag", "I"], ["är", "am"], ["Svea", "Svea"], ["din", "your"],
        ["svensklärare", "Swedish teacher"], ["tryck på", "press"], ["knappen", "the button"],
        ["och", "and"], ["prata", "talk"], ["med", "with"], ["mig", "me"]
    ]
};

export const RESTART = {
    sv: "Vi börjar om! Hej igen — vad vill du prata om?",
    en: "Let's start over! Hi again — what do you want to talk about?",
    zh: "我们重新开始！又见面了——你想聊什么？"
};

export const NO_SPEECH = {
    sv: "Jag hörde ingenting. Försök igen!",
    en: "I didn't hear anything. Try again!",
    zh: "我什么也没听到。再试一次！"
};

export const REFUSED = {
    sv: "Förlåt, det där kan jag inte prata om. Ska vi byta ämne?",
    en: "Sorry, I can't talk about that. Shall we change topic?",
    zh: "抱歉，这个我不能聊。我们换个话题吧？"
};

export const NOT_UNDERSTOOD = {
    sv: "Ursäkta, kan du säga det igen?",
    en: "Sorry, can you say that again?",
    zh: "不好意思，你能再说一遍吗？"
};

export const DEMO_REPLIES = {
    greetings: {
        keywords: ['hej', 'hallå', 'hello', 'hi'],
        responses: [
            { sv: "Hej! Hur mår du idag?", en: "Hi! How are you today?", zh: "你好！你今天怎么样？",
              words: [["Hej", "hi"], ["hur", "how"], ["mår", "feel"], ["du", "you"], ["idag", "today"]] },
            { sv: "Vad kul att se dig!", en: "How nice to see you!", zh: "见到你真高兴！",
              words: [["Vad kul", "how nice"], ["att", "to"], ["se", "see"], ["dig", "you"]] }
        ]
    },
    default: {
        responses: [
            { sv: "Intressant! Berätta mer om det.", en: "Interesting! Tell me more about it.", zh: "有意思！多跟我说说。",
              words: [["Intressant", "interesting"], ["berätta", "tell"], ["mer", "more"], ["om", "about"], ["det", "it"]] },
            { sv: "Jag förstår. Kan du förklara det lite mer på svenska?", en: "I understand. Can you explain it a bit more in Swedish?", zh: "我明白了。你能用瑞典语再多解释一点吗？",
              words: [["Jag", "I"], ["förstår", "understand"], ["kan", "can"], ["du", "you"], ["förklara", "explain"], ["det", "it"], ["lite mer", "a bit more"], ["på", "in"], ["svenska", "Swedish"]] }
        ]
    }
};

export const PRACTICE_SENTENCES = [
    { sv: "Jag skulle vilja ha en kaffe, tack.", en: "I would like a coffee, please.", zh: "我想要一杯咖啡，谢谢。" },
    { sv: "Var ligger närmaste tunnelbanestation?", en: "Where is the nearest metro station?", zh: "最近的地铁站在哪里？" },
    { sv: "Kan du prata lite långsammare?", en: "Can you speak a little more slowly?", zh: "你能说慢一点吗？" },
    { sv: "Hur mycket kostar den här?", en: "How much does this one cost?", zh: "这个多少钱？" },
    { sv: "Jag lär mig svenska på jobbet.", en: "I am learning Swedish at work.", zh: "我在工作中学瑞典语。" }
];

// A canned line as a message; the Chinese only when that setting is on.
export function localize(line) {
    return {
        sv: line.sv,
        en: line.en,
        zh: settings.alsoChinese ? line.zh : '',
        words: (line.words || []).map(([sv, en]) => ({ sv, en }))
    };
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
