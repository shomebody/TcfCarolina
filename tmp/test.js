const str = `{{Episode list
 |EpisodeNumber = 1
 |Title = The 16th Chef
 |OriginalAirDate = {{Start date|2024|3|27}}
 |ShortSummary =
*Valentine: New England Lobster Bake
*Soo: Fish & Chips
**'''Winner:''' Soo
**'''Eliminated:''' Valentine
}}
{{Episode list
 |EpisodeNumber = 3
 |Title = Plates Aplenty
 |ShortSummary =
*Soo: ...
*Alisha: ...
*Kaleena: ...
**'''Winners:''' Soo and Kaleena
**'''Eliminated:''' Alisha
}}`;

const episodeRegex = /\{\{Episode\s*list\b(?:\s*\|.*?(?=\n\s*(?:\||\}\})|$)|\s*[\s\S]*?)?\*+'''Winners?:'''?\s*([^\n]+)/gi;
let m;
while((m = episodeRegex.exec(str)) !== null) {
   console.log("Match:", m[1]);
}
