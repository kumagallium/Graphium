# Does the plan's grounding check catch planted mistakes? <Badge type="info" text="Measured 2026-11-06 · v0.123.0" />

**What we checked.** Whether an experiment plan is a good idea is only known once you run it. So instead of judging it, Graphium checks what each item of the plan rests on ([Where the plan comes from](/ai-chat-and-ask#where-the-plan-comes-from)). We measured whether this check really catches mistakes in a plan, by planting mistakes on purpose, and whether the items it raises on an unmodified plan are real.

**In short.** Claude Opus 5 and Copilot's `gpt-5.6-luna` raised all 15 planted mistakes as a conflict or as having no source. The items they raised on unmodified plans were almost all really absent from both the cited notes and the answer. `gpt-oss-120b` caught 13 of 15, but in one check it raised 8 false alarms, marking conditions written in the answer as having no source. The measurement is small; read it as a tendency.

## How we measured

| | |
|---|---|
| Answers | Two chat answers proposing the next experiment, built on procedure notes extracted from paper PDFs (the same open-access papers as [From papers to the next experiment's plan](/evaluations/papers-to-procedures)) |
| Plans | From each answer, a plan by each of three models (Claude Opus 5, `gpt-5.6-luna`, `gpt-oss-120b`): six plans |
| Planted mistakes | For five of the six plans, versions with the common procedure rewritten (the sixth was checked in its original form only): (1) the temperature of a fixed (not varied) condition raised by 600 °C (in all five, preheating 500 → 1100 °C), (2) a material with a purity that is in neither the notes nor the answer (the same material in all five), (3) the calcination atmosphere changed (three plans) or a hold time multiplied by 10 (two plans). A mistake counts as caught when an item containing the rewritten value or material is raised as a conflict or as having no source |
| Checkers | The same three models, once each on the 6 original and 15 planted versions (63 checks) |
| False alarms | The 21 items raised as a conflict or with no source on the original plans were checked by a separate AI reviewer against the full notes and answer |

## Were the planted mistakes caught?

| Checker | Fixed-condition value | Added material | Atmosphere / time | Total |
|---|---|---|---|---|
| Claude Opus 5 | 5/5 | 5/5 | 5/5 | **15/15** |
| Copilot gpt-5.6-luna | 5/5 | 5/5 | 5/5 | **15/15** |
| gpt-oss-120b | 3/5 | 5/5 | 5/5 | 13/15 |

The denominator is the number of planted plans (five). The two that `gpt-oss-120b` missed were the rewritten preheating temperature, labelled as proposed by the answer: it treated a value changed in the plan as one the answer had changed. On the same plans, Claude and `gpt-5.6-luna` raised that procedure line as a conflict. The three atmosphere changes `gpt-oss-120b` caught were all labelled as having no source rather than as a conflict, and on one original plan it had marked the same condition as having no source too. They may not have been caught for the right reason.

## Items raised on plans with nothing planted

| Checker | Raised | Really absent or conflicting | Partly right | False alarm |
|---|---|---|---|---|
| Claude Opus 5 | 6 | 6 | 0 | 0 |
| Copilot gpt-5.6-luna | 6 | 5 | 1 | 0 |
| gpt-oss-120b | 9 | 1 | 0 | 8 |

Even without planting, the plans had items with no source: whether to stir, the calcination atmosphere, furnace cooling, a mortar — details neither the papers nor the answer gave, filled in while building the plan. In one case a purity that the paper gave for one starting material was put on another, and Claude and `gpt-5.6-luna` raised it. The cause was the answer's table, which wrote the purities of two materials together. All 12 items Claude and `gpt-5.6-luna` raised came from plans built on the second answer. The first answer spelled out the procedure in detail, so nothing had to be filled in.

All 8 false alarms from `gpt-oss-120b` came from a single check, and were conditions written in the answer (the kind of mortar, the heating rate, the magnetic field) marked as having no source. The answer was not cut off (it stays under the 12,000-character limit); the model missed them. In its other five checks `gpt-oss-120b` raised a single item, and did not raise most of the filled-in details that Claude and `gpt-5.6-luna` raised.

## Cost

One check took about 10,000–15,000 input tokens and 3,000–5,000 output tokens, with a median of 25–41 seconds (the longest took 94 seconds). Making a plan note takes that much longer before it opens.

## Hindsight check (trial)

To get closer to judging whether a plan is good, we also tried comparing the AI's proposals with what the paper's authors actually did next. We collected papers by the first and last authors from 1–5 years later on OpenAlex. From their titles and abstracts, Claude Opus 5 picked the follow-ups and wrote down what they varied, as the answer key (5 of the 7 papers had follow-ups). We then showed the models only the original paper, asked for 3 things to vary next, and had Claude Opus 5 judge whether each matched the key.

| Shown | Top proposal hits | Any of 3 hits |
|---|---|---|
| The extracted procedure note | 0.77 | 0.90 |
| Title and abstract only | 0.73 | 0.90 |

(3 models × 5 papers × 2 runs, 30 each)

Both nearly always hit, so there was no difference. We think the answer key is too broad: one paper had 10 follow-ups, and with dopant, composition, calcination temperature and added measurements together, the most had 40 varied dimensions. Any plausible proposal is likely to hit one of them (we did not compare against random proposals). To judge plans this way the key needs rebuilding: only the main variable of one follow-up, more papers, and a key and judge from a model other than the proposers. As it stands, it cannot be used to evaluate plans.

## Limits

- Six plans, five of them planted, each checked once. The rewritten value was the same preheating temperature in all five, and the added material was the same too, so there are effectively three kinds of planted mistake.
- Misses on the original plans (real mistakes the check did not raise) were not counted; the false-alarm review only covers the items that were raised.
- The check does not judge whether a plan is good. A well-grounded plan can still be a poor experiment.

## Decision

- The check runs with the model selected in the chat when the plan note is made. With a Claude-class model or Copilot's `gpt-5.6-luna`, the raised items can be taken as things to check.
- With `gpt-oss-120b`, false alarms and misses stood out in this measurement; compare the raised items with the answer.
- The hindsight check is on hold until the answer key is rebuilt.
