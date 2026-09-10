const fs = require('fs');
let code = fs.readFileSync('server/geminiService.ts', 'utf8');

const target = `    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });`;

const replacement = `    let response;
    let retries = 3;
    const modelsToTry = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'];
    for (let i = 0; i < retries; i++) {
      try {
        response = await ai.models.generateContent({
          model: modelsToTry[i % modelsToTry.length],
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: i > 0 ? 0.4 : 0.1,
          },
        });
        break;
      } catch (err) {
        console.error(\`[GeminiService] Attempt \${i + 1} failed with model \${modelsToTry[i % modelsToTry.length]}: \${err.message}\`);
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s before retry
      }
    }`;

code = code.replace(target, replacement);
fs.writeFileSync('server/geminiService.ts', code);
