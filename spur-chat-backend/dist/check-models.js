"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const groq_sdk_1 = require("groq-sdk");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const groq = new groq_sdk_1.Groq({ apiKey: process.env.GROQ_API_KEY });
async function checkModels() {
    console.log('Checking available Groq models...\n');
    const modelsToTest = [
        'llama-3.1-8b-instant',
        'llama-3.2-1b-preview',
        'llama-3.2-3b-preview',
        'llama-3.3-70b-versatile',
        'gemma2-9b-it',
        'mixtral-8x7b-32768',
        'qwen-2.5-32b',
        'llama3-70b-8192'
    ];
    for (const model of modelsToTest) {
        try {
            console.log(`Trying: ${model}`);
            const start = Date.now();
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a test assistant.' },
                    { role: 'user', content: 'Say "Hello" only.' }
                ],
                model,
                max_tokens: 5,
            });
            const time = Date.now() - start;
            console.log(` ${model}: SUCCESS (${time}ms) - "${chatCompletion.choices[0]?.message?.content}"\n`);
            return model;
        }
        catch (error) {
            const msg = error?.error?.message || error?.message || String(error);
            if (msg.includes('decommissioned'))
                console.log(` ${model}: DEPRECATED\n`);
            else if (error?.status === 404)
                console.log(`${model}: NOT FOUND\n`);
            else
                console.log(` ${model}: ERROR - ${msg}\n`);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    console.log(' No working models found from the test list.');
    return null;
}
checkModels().then(workingModel => {
    if (workingModel) {
        console.log(`\n RECOMMENDED MODEL: ${workingModel}`);
        console.log(` Update your server.ts with: model: '${workingModel}'`);
    }
    else {
        console.log('\n No working models found. Consider using OpenRouter or another provider.');
    }
});
