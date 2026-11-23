# Do hints from my own notes help voice input spell technical words? <Badge type="info" text="Measured 2026-11-22 · v0.154" />

**Question.** Voice input turns speech into text on the computer with whisper. Chemical formulas and acronyms often came out as something else, and Japanese technical words came out in hiragana, so the search did not find them. whisper copies the spelling of words it is given as a hint. If Graphium picks hint words from my own notes, does that fix it — without me writing anything in Settings?

**Short answer.** For chemical formulas and acronyms, yes: hints picked from the titles and headings of my notes raised the share of those words spelled correctly from 7 of 26 to 15 of 26, the same as giving the exact answers. All 13 such words in the test were among the terms picked (the hint holds about 25); a word used in too few notes to make the list was not measured. For Japanese technical words, no: the words picked by frequency were mostly common ones, and they did not help (8 of 26 → 9 of 26); two of the expected words were among them and still came out as a word that sounds the same. Giving the right Japanese words did help (18 of 26), but I did not find a way to pick them automatically. **Decision:** voice input passes the Latin-script terms from the note titles and headings, ranked by how many notes use them, separated by spaces, with the Frequent terms setting at the end. Japanese words that keep coming out in hiragana are left to the Frequent terms setting.

## How I measured it

| | |
|---|---|
| Machine | Apple M1 Max, macOS 27.2 |
| Model | whisper large-v3-turbo (q5_0), the voice notes default, through the same engine as the app |
| Speech | 12 short search questions, most mixing a chemical formula or acronym with a Japanese technical word (2 have only Japanese words, 1 only acronyms), read aloud by two of macOS's Japanese voices (`say`), 24 recordings in all. **This is synthesized speech, not a person.** It sometimes mispronounced the formulas |
| Hint sources | The titles and headings of my notes (about 3,400). Language Japanese, and also Auto |
| Scoring | Whether each expected word appears in the text, ignoring upper and lower case (the search does the same). 52 words in all: 26 Latin-script, 26 Japanese |

The questions and the words come from my own research notes, so they are not shown here.

## Results

| Hint | Words found | Latin-script words | Japanese words | Every word in the question |
|---|---|---|---|---|
| None | 15/52 | 7/26 | 8/26 | 4/24 |
| Latin-script terms from the notes, comma-separated | 22/52 | 12/26 | 10/26 | 5/24 |
| **Latin-script terms from the notes, space-separated** | **24/52** | **15/26** | 9/26 | **6/24** |
| The same, followed by a short Japanese sentence | 19/52 | 10/26 | 9/26 | 6/24 |
| Latin-script terms and frequent Japanese words, alternating, comma-separated | 20/52 | 11/26 | 9/26 | 5/24 |
| Two passes: words that look like the first result, then again | 18/52 | 13/26 | 5/26 | 4/24 |
| The exact expected words (upper bound) | 33/52 | 15/26 | 18/26 | 10/24 |

With the language set to Auto, no hint gave 15/52 and the space-separated hint 23/52: about the same as Japanese. One recording came out in English with Auto, with and without the hint.

## What I learned

- **Hints work on Latin-script terms.** A formula misheard as a jumble of capitals came out spelled as in my notes once the term was in the hint (upper and lower case not always).
- **whisper copies the separator too.** With commas between the hint words, commas appeared in the output and one formula came out as single letters separated by commas. Spaces did not do this.
- **Listing Japanese words breaks the output.** In the two-pass run the Japanese words in the hint were separated by spaces, and the output split a word into separate characters the same way. Japanese words found by sharing characters with a misheard word were also mostly unrelated.
- **A hint of Latin-script terms only sometimes pulled Japanese speech into romaji.** By eye, at least 3 of 24 recordings had a Japanese phrase or a katakana word written in Latin letters.

## Limits

- 24 recordings is small. A difference of 2 or 3 words is within noise; only the gap between no hint and a hint of Latin-script terms (7 → 15 of 26) is large.
- The speech is synthesized. A person speaking, a different microphone or a noisy room may give different results, and the synthesized voices mispronounced some formulas in a way a person would not.
- Only terms near the top of the list reach the model (160 characters, about 25 terms). A formula that appears in only a few notes is left out.
- The Frequent terms setting placed at the end was not measured (it was empty). The setting is comma-separated, and commas in a hint showed up in the output.
- Only the large-v3-turbo model was measured; small and base were not.
- The hint is built from one person's notes. A collection with few Latin-script terms gets little from it.
