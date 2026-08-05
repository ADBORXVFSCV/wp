const mod = require('@google/generative-ai');
console.log('top keys', Object.keys(mod));
console.log('has default', !!mod.default);
console.log('default keys', mod.default ? Object.keys(mod.default) : undefined);
console.log('GoogleGenerativeAI', !!mod.GoogleGenerativeAI);
console.log('typeof default', typeof mod.default);
console.log('typeof GoogleGenerativeAI', typeof mod.GoogleGenerativeAI);
