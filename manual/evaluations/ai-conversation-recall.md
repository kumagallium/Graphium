# Asking another AI about past conversations <Badge type="info" text="Measured 2026-11-19 · v0.147.1" />

**Question.** After bringing conversations with Claude Code into Graphium, can a different AI, connected through the [MCP server](/mcp-server), answer "how did I decide this, and why?" and point back to the original conversation? And does making Knowledge from the conversations help, compared with searching their text?

**Short answer.**

- With search alone, the AI's answers covered 35 of 40 expected points (88%). With Knowledge made from the conversations, they covered 38 of 40 (95%).
- In all three conditions, every answer to a question the records could answer named the original conversation (14 of 14), and all 4 questions the records could not answer were answered "not in the records".
- The gap between search alone and Knowledge is 3 points on 3 questions, from one run each. Read it as a rough guide ([Limits](#limits)).
- The AI never opened a topic with the tool made for it (`get_topic`). I changed the search results to say how to open a topic, and it was then used on 3 of the 14 questions. The expected points covered stayed the same (38 of 40). Statements that disagree with the records went from 2 to 1, which one run each cannot tell apart from chance.

## What was measured

| | |
|---|---|
| Records | 10 of my own conversations about building Graphium, about 86,000 characters in all. Conversations that mention other people or organizations were left out, and names were masked before the AI could read them |
| What the AI could read | A separate vault holding only these 10 conversations, through the read-only tools of the MCP server. Shell and web search were turned off, and no other tool was used in any run |
| The AI | Codex CLI with `gpt-6-astra`, reasoning effort medium |
| Questions | 18, written by a separate agent: 9 about one conversation, 5 that need 2 or 3 conversations, 4 whose answer is not in the records |
| Expected points | 40 across the 14 answerable questions |
| Scoring | A separate agent scored all 54 answers in shuffled order, without being told the condition, and checked them against the records |

An example of the kind of question, made up in baking words: "When we chose the share of whole wheat, what did I settle on, and why?"

## Conditions

| Condition | What is in the vault | Search results |
|---|---|---|
| A. Search only | The 10 conversations | As in the find step |
| B. With Knowledge | The 10 conversations, 80 claims and 12 topics made from them (3 topics draw on more than one conversation) | As in the find step |
| C. With Knowledge, after the change | Same as B | Search says how to open a topic, and that conversation text is found with `search_media` |

## Results

| | A. Search only | B. With Knowledge | C. After the change |
|---|---|---|---|
| Expected points covered | 35 / 40 (88%) | 38 / 40 (95%) | 38 / 40 (95%) |
| One conversation | 21 / 25 | 23 / 25 | 23 / 25 |
| Across conversations | 14 / 15 | 15 / 15 | 15 / 15 |
| Named the original conversation | 14 / 14 | 14 / 14 | 14 / 14 |
| "Not in the records" when it was not | 4 / 4 | 4 / 4 | 4 / 4 |
| Statements that disagree with the records | 1 | 2 | 1 |
| The AI's idea presented as my decision | 0 | 0 | 0 |
| Average time per question (three questions ran at a time) | 36 s | 34 s | 35 s |
| Average input tokens per question | 126,658 | 122,509 | 123,931 |

How the AI read the records:

| | A | B | C |
|---|---|---|---|
| `get_source_text` (reading a conversation) | 51 | 39 | 46 |
| `search_media` | 52 | 33 | 37 |
| `search_notes` | 37 | 40 | 35 |
| `get_note` | 0 | 10 | 2 |
| `get_topic` | 0 | 0 | 6 |
| Answerable questions where it opened a Knowledge page | — | 4 / 14 | 4 / 14 |

The counts include calls that failed (4 `get_source_text` calls in A, 1 in C). In A the AI also called `list_folders` once.

The AI opened the original conversation on all 14 answerable questions in every condition. Knowledge pages were an extra way in, not a replacement for reading the conversation.

## What I decided

- **Keep both.** Searching the text of conversations already answers most questions and leads back to the source. Knowledge stays an action you choose.
- **Keep the change to the search results.** It costs one line per topic, and topics are now opened with the tool that also returns their sources.

## Limits {#limits}

- **Small.** Ten conversations on one subject is an easy setting. With many more records, finding the right conversation gets harder, and this measurement says nothing about that.
- **One run each.** Each question was asked once per condition, with one model. A difference of 3 points can come from run-to-run variation.
- **The questions come from the same conversations.** An agent wrote them after reading the records, so they may be easier to answer than questions asked months later.
- **Some expected points rest on the AI's proposal.** When I answered only "go with that", the content of the decision was taken from the AI's line just before.
- **Scoring is not fully blind.** An answer that mentions a Knowledge page can give away its condition.

The raw questions and answers are kept privately, because they come from my own conversations.
