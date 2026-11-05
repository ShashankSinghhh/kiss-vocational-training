# Translation review (F16, BRQ-16.1)

All Odia (`or/`) and Hindi (`hi/`) strings were **machine-drafted** in Sprint 12 so the whole
portal can be used in either language. They have not been checked by a native speaker yet.
Please review them before the portal is used with students and families.

## What to check

- **Meaning**: the sentence says the same as English (see `en/<file>.json`, same key).
- **Tone**: students' messages stay warm and encouraging, especially `intervention.json`
  (`student.*`), `opportunities.json` (`mine.*`) and `notifications.json`.
- **Words people actually use** at KISS: e.g. "batch", "trainer", "certificate", "passport".
  English loan words are used on purpose where they are the everyday word (ID, PDF, CSV, QR,
  email); change them if a local word is clearer.
- **Placeholders** like `{{name}}` must stay exactly as they are; you may move them within the
  sentence. `pnpm --filter @vtmp/web i18n:check` fails if one is lost or renamed.
- **Plurals**: keys ending in `_one` / `_other` are singular and plural forms.

## Standard terms

Use one word per idea everywhere so screens read the same. Change a term in every file at once
(search the folder), not in one place.

| English        | Hindi (`hi`)   | Odia (`or`)      | Note                                            |
| -------------- | -------------- | ---------------- | ----------------------------------------------- |
| course         | पाठ्यक्रम      | ପାଠ୍ୟକ୍ରମ        | not कोर्स                                       |
| student        | विद्यार्थी     | ଛାତ୍ରଛାତ୍ରୀ      |                                                 |
| trainer        | प्रशिक्षक      | ପ୍ରଶିକ୍ଷକ        |                                                 |
| user (account) | उपयोगकर्ता     | ବ୍ୟବହାରକାରୀ      | not ଉପଯୋଗକର୍ତ୍ତା                                |
| enrollment     | नामांकन        | ନାମଲେଖା          |                                                 |
| application    | आवेदन          | ଆବେଦନ            |                                                 |
| session        | सत्र           | ଅଧିବେଶନ          | Odia: please confirm; ସେସନ୍ may be more natural |
| attendance     | उपस्थिति       | ଉପସ୍ଥିତି         |                                                 |
| assessment     | मूल्यांकन      | ମୂଲ୍ୟାଙ୍କନ       |                                                 |
| certificate    | प्रमाणपत्र     | ପ୍ରମାଣପତ୍ର       |                                                 |
| deactivate     | निष्क्रिय करें | ନିଷ୍କ୍ରିୟ କରନ୍ତୁ |                                                 |

## Priority order

1. Student-facing: `common`, `auth`, `dashboard`, `courses`, `enrollment`, `training`,
   `competency` (`gaps`, `level`), `passport`, `completion` (`mine`), `opportunities` (`mine`),
   `intervention` (`student`), `notifications`, `verify`, `errors`, `profile`.
2. Trainer and admin screens: everything else.

## How to submit corrections

Edit the JSON file directly (keep keys unchanged) or send a list of `file → key → new text` to
the team. Mark this table when a file is reviewed.

| File               | Odia reviewed by | Hindi reviewed by |
| ------------------ | ---------------- | ----------------- |
| common.json        |                  |                   |
| auth.json          |                  |                   |
| dashboard.json     |                  |                   |
| courses.json       |                  |                   |
| enrollment.json    |                  |                   |
| training.json      |                  |                   |
| competency.json    |                  |                   |
| passport.json      |                  |                   |
| completion.json    |                  |                   |
| opportunities.json |                  |                   |
| intervention.json  |                  |                   |
| notifications.json |                  |                   |
| verify.json        |                  |                   |
| errors.json        |                  |                   |
| profile.json       |                  |                   |
| batches.json       |                  |                   |
| users.json         |                  |                   |
| reports.json       |                  |                   |
| evidence.json      |                  |                   |
| scheduling.json    |                  |                   |
| audit.json         |                  |                   |
