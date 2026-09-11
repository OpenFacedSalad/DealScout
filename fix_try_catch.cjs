const fs = require('fs');
let content = fs.readFileSync('api/_lib/geminiService.ts', 'utf8');

content = content.replace(/\} catch \{/g, `} catch (err) {\n        console.error("AI GENERATECONTENT ERROR:", err);`);

fs.writeFileSync('api/_lib/geminiService.ts', content);
