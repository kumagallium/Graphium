# Using Graphium as a lab notebook

A record of something you tried can come back with a question: "since when did this result exist?" It comes up in peer review, research-integrity checks, agreements between collaborators, and when explaining prior use for a patent. It is not only research: recipe and product trials and design work run into the same question.

Paper lab notebooks answered it by dating each page, binding the pages, and making it hard to tear one out. An electronic lab notebook (ELN) does the same job on screen.

This page sets out how far Graphium goes for that use. In short: **you can use it as a research record that you can later show as evidence.** It is **not a regulated electronic lab notebook.**

## What it does and does not do

| What a lab notebook needs | Graphium | Feature |
|---|---|---|
| Records are kept with dates | Yes | Every save stays in the history ([History and versions](/notes-and-editor#history-and-versions)) |
| How something was made is kept | Yes | Steps, inputs and results are linked as provenance (PROV) ([Labels & provenance](/labels-and-provenance)) |
| Milestones can be kept | Yes | **Save version** ([details](/notes-and-editor#version-snapshots)) |
| Changes are detectable | Yes | **Seal as evidence** burns a hash of the content into a seal file ([details](/notes-and-editor#seal-as-evidence)) |
| A third party can check "this existed before this date" | Yes | A sealed point gets two outside timestamp proofs. The exported zip can be checked without Graphium |
| Proves who wrote it | No | The name is self-declared ([Settings](/settings) → **Sharing** → **Your name**). There is no electronic signature or identity check |
| Records cannot be deleted | No | The files on your computer can be deleted by their owner. Deleting a seal in the middle shows up as a gap in the chain, but deleting the most recent seal does not |
| A witness signs off | No | There is nothing like the "witnessed by" signature in a paper notebook |
| Nothing is missing | Partly | Only the points you seal get outside timestamps. Days you do not seal have none |
| Regulatory compliance (21 CFR Part 11, GLP and so on) | No | Audit trail, electronic signature and access-control requirements are not met, and Graphium does not claim them |

"Proof" here means only **"this content existed before this time."** It does not cover whether the content is correct, whether you came up with it yourself, or whether an AI generated it.

## A suggested routine

1. **Write as usual.** Putting procedures in step blocks and labelling inputs and results makes it easier to explain how you got there later.
2. **Save points at milestones.** When a run is done, when a result comes in, or before you show it to someone, press `⌘⇧S` (`Ctrl+Shift+S` on Windows). A name makes it easier to find later.
3. **Seal the points you may need as evidence.** Press the lock button (**Seal as evidence**) on that row of the history. Only a hash of the content leaves your computer; the text and media are not sent.
4. **Keep the exported zip somewhere else too,** such as a lab NAS or an external disk. Sealed records are files on your computer, so keep a copy in case the computer fails.
5. **Check now and then.** **Check the seal** compares the records with the timestamp proofs inside the app.

Nothing is sent anywhere until you seal. If you do not use Graphium this way, nothing changes as long as you do not press the button.

## Where it fits and where it does not

**Where it fits**

- You want your own or your team's research records kept in a form that can show "this existed before this date"
- You want to hand a record of a point in time to someone before submitting a paper or starting a collaboration
- You want material at hand to explain the timing of an idea or how a prototype came about

**Where it does not**

- Records submitted to regulators, such as drug or medical-device development (Part 11, GLP, GMP)
- Your institution prescribes a specific ELN or an approval procedure (such as a supervisor's countersignature)
- You need to prove the writer's identity

If your institution has rules for research records, those rules come first. Sealing in Graphium does not replace them. Whether it meets what those rules ask for is a question for the people responsible at your institution.

## About the timestamp proofs

A sealed point gets two timestamp proofs of different kinds. Both come from free public services, and neither needs an account or an API key.

| | Proof that arrives at once | Proof confirmed in a few hours |
|---|---|---|
| Service | [FreeTSA](https://freetsa.org/) (an RFC 3161 time-stamping authority) | [OpenTimestamps](https://opentimestamps.org/) (anchored in Bitcoin) |
| What you trust | The authority's signature | The Bitcoin block chain |
| How to check | `openssl ts -verify` | `ots verify`, or opentimestamps.org |

Two proofs are used so that the record does not rest on a single operator. If one service stops, the other proof remains. The steps for checking are in [What is in the evidence zip, and how to check it without Graphium](/notes-and-editor#seal-as-evidence).

::: warning The web app does not add timestamp proofs
Public timestamp services do not accept requests straight from a browser. In the web app you can still seal, and changes are still detectable, but no timestamp proofs are added. Use the [desktop app](/desktop-app) when you need evidence of the time.
:::

## What comes next

I think the biggest gap today is that days you forget to seal get no timestamp proof. Sealing the day's notes together, a signature by the writer, and a countersignature by a collaborator are ideas I am still looking at.
