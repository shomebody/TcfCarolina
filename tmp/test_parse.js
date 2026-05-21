const wikitext = `==''Last Chance Kitchen''==
{{main|Top Chef#Last Chance Kitchen}}

{| class="wikitable plainrowheaders" style="width:99%"
! No.
! Title
! Original air date
|-
{{Episode list
 |EpisodeNumber = 1
 |Title = Back to Basics
 |OriginalAirDate = {{Start date|2026|3|30}}
 |ShortSummary =
'''Challenge:''' Nana and Brittany had 30 minutes to create redemption-worthy dishes that represent themselves on a plate.
*Nana: Pan Seared Salmon with Tomato Salad & Curry Sauce
*Brittany: Pan Seared Halibut with Grilled Corn & Tomato [[Panzanella]]
**'''Winner:''' Nana
**'''Eliminated:''' Brittany
 |LineColor = #4D0070
}}
`;

const lckMatch = wikitext.match(/==\s*'{0,3}Last Chance Kitchen'{0,3}\s*==([\s\S]*?(?:==|$))/i);
console.log("Match:", lckMatch ? "Yes" : "No");
if (lckMatch) {
   console.log("Blocks:", lckMatch[1]);
   
   const lckText = lckMatch[1];
   const lckBlocks = lckText.split(/\{\{\s*Episode list/i).slice(1);
   console.log("Found LCK Blocks:", lckBlocks.length);
}
