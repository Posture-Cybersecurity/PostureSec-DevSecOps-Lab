# What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Ticket

<!-- e.g. ONB-006. One ticket per PR. -->

## How I verified it

<!--
Not "it works". Paste the evidence:
  - the command you ran and its output
  - for a fix: the test failing BEFORE and passing AFTER
  - for infrastructure: the resource actually responding
-->

- [ ] I ran the test suite locally (`npm test` in `backend/`)
- [ ] For a bug fix: a test failed before this change and passes after
- [ ] `npm run lint` is clean
- [ ] No secret, token, password or connection string appears in the diff

## AI Interaction Log

<!--
Required whenever Grok contributed to this change. AI output is never
evidence on its own — record what you did to establish it independently.
Delete this section only if you used no AI at all.
-->

| Prompt | Grok's output (summary) | My verdict | How I verified it independently |
| ------ | ----------------------- | ---------- | ------------------------------- |
|        |                         | accept / reject / partial |                    |

## Risk

<!-- What could this break? What did you check to convince yourself it doesn't? -->
