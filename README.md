# fast-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Stranmor/fast-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Stranmor/fast-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A drop-in for make.fun's csv-reader 1.0.0: `solve.js` exports `run(input)`, and it returns csv-reader's exact
`{columns, rows, errors}` answer for every input while reading the same text several times faster. csv-reader builds each
field one character at a time and keeps the whole read in one function's closures; this reads the text once over its code
units, takes a field as a slice of the text, and keeps the read's position, line and errors in local variables, so the
loop runs on registers. The policy is csv-reader's, read for read, and the notes at the top of `solve.js` say which
rule each branch follows: the BOM, the blank lines, `stray_cr`, the quoted field's escapes and line breaks,
`unterminated_quote`, `quote_junk`, the rows padded or cut to the first record's width, and each error's line and row.

## Run it

```sh
# the grader's own driver: /input/cases.json in, /output/answers.json out
node main.ts
# outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output
MAKEFUN_INPUT_DIR=path/to/input MAKEFUN_OUTPUT_DIR=path/to/output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=txz1h3r6&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
