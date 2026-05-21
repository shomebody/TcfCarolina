const fs = require('fs');
async function run() {
   const url = 'https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=Top_Chef:_Carolinas&format=json&origin=*&redirects=1';
   const res = await fetch(url);
   const data = await res.json();
   const pages = data.query.pages;
   const pageId = Object.keys(pages)[0];
   const content = pages[pageId].revisions[0].slots.main['*'];
   console.log("Found LCK?", content.includes("Last Chance Kitchen"));
   
   const lckMatch = content.match(/==\s*'{0,3}Last Chance Kitchen'{0,3}\s*==([\s\S]*?(?:==|$))/i);
   console.log("Regex match?", !!lckMatch);
   if (lckMatch) {
      console.log("Text snippet:", lckMatch[1].substring(0, 100));
      const blocks = lckMatch[1].split(/\{\{\s*Episode list/i).slice(1);
      console.log("Blocks found:", blocks.length);
   } else {
      // Find where it's located
      const idx = content.indexOf("Last Chance Kitchen");
      console.log("Context around LCK:", content.substring(idx - 50, idx + 50));
   }
}
run();
