const fs = require('fs');
let code = fs.readFileSync('server/geminiService.ts', 'utf8');

const oldStr = '    const currentDate = new Date().toISOString().split(\'T\')[0];';
const replaceStr = `    const currentDate = new Date().toISOString().split('T')[0];

    const webSnippets = [];
    for (const s of stores.slice(0, 3)) {
       const snippet = await searchWebScraper(\`\${s.name} \${city} \${state} weekly ad circular deals\`);
       if (snippet) webSnippets.push(\`--- Search Results for \${s.name} ---\\n\${snippet}\`);
    }
    const karnSnippet = await searchWebScraper(\`Karns Quality Foods Mechanicsburg PA weekly ad circular chicken wings price\`);
    if (karnSnippet) webSnippets.push(\`--- Search Results for Karns Chicken Wings ---\\n\${karnSnippet}\`);
    const combinedSnippets = webSnippets.join('\\n\\n');`;

code = code.replace(oldStr, replaceStr);

const promptOld = 'Search the live web for the current weekly grocery circulars, flyers, and advertised specials for supermarkets near ${city}, ${state} ${zipCode} active as of ${currentDate}.';
const promptNew = 'Based on the following live web search snippets for current weekly grocery circulars, flyers, and advertised specials for supermarkets near ${city}, ${state} ${zipCode} active as of ${currentDate}:\\n\\n${combinedSnippets}\\n\\n';
code = code.replace(promptOld, promptNew);

const instrOld = '1. Search specifically for live weekly ad flyers for these chains in ${city}, ${state} (e.g., Karns Foods circular, ALDI Finds & weekly produce, Giant Food Stores weekly circular, Weis weekly specials).';
const instrNew = '1. Extract authentic advertised items, sales, and butcher shop specials from the search snippets provided.';
code = code.replace(instrOld, instrNew);

const aiCallOld = `    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });`;
const aiCallNew = `    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });`;
code = code.replace(aiCallOld, aiCallNew);

fs.writeFileSync('server/geminiService.ts', code);
