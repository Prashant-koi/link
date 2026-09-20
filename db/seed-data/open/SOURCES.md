# Open data used by `npm run seed:expand`

Built by `scripts/build-open-vocab.mjs`; the JSON here is checked in so seeding needs no network.

| File | Derived from | Licence |
| --- | --- | --- |
| `cip.json` | NCES *Classification of Instructional Programs* 2020, https://nces.ed.gov/ipeds/cipcode/Files/CIPCode2020.csv | US Government work, public domain |
| `hobbies.json` | dariusk/corpora `sports`, `music/genres`, `art/isms`, https://github.com/dariusk/corpora | CC0 / public domain |
| `names.json` | sigpwned/popular-names-by-country-dataset (forenames and surnames by country) | CC0 |

A short list of everyday hobbies (Cooking, Reading, Video games, ...) and the popular head entries for sports and music (Soccer, Jazz, ...) is written by hand in `src/seed/expand/vocab.ts`, because the open lists above do not contain them.

Person names are random first x last combinations from these lists; they do not identify real people.
Clubs, labs and departments are fictional campus entities named from these vocabularies.
