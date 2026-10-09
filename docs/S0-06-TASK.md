# S0-06 / ONB-006 — Fix a seeded bug and prove it with a test

**Ticket:** ONB-006 · **Points:** 5 · **Branch to start from:** `lab/s0-06-simulation`

This exercise is about **authentication**: *who are you, and did you prove it?*

It is not about authorization, roles, IDOR, SQL injection, or exploitation
technique. One thing is broken, in one place, and it is reachable with `curl`.

---

## The situation

A defect has been seeded in this branch. It is a **security** defect, and it is
in the part of the application that decides whether a person is who they claim
to be.

Nothing about the database, the password hashing, or the session mechanism has
been sabotaged. Passwords are still hashed with bcrypt and hashes are still
never returned. The problem is narrower than that, and closer to the surface.

---

## What you have to do

**1. Observe.** Run the test suite before you change anything.

```bash
cd backend && npm test
```

Something fails. Read the failure — not just the red, but what the assertion
actually expected and what it got.

**2. Reproduce it yourself, outside the test.** A failing test tells you a
contract is broken. Your own reproduction tells you *what an attacker can do*,
and that is what you will put in the pull request. Start the stack, register an
account, then log in twice: once with the correct password, once with a
deliberately wrong one. Compare the two responses carefully — the status, the
body, and the `Set-Cookie` header.

Then ask the question that matters: **did the wrong-password attempt leave you
holding something you could use?** Try it against `/api/auth/me`.

**3. Find the cause.** Read the login route and follow the value that decides
whether the credentials were accepted. Ask of every step: *what is this
expression actually worth at the moment it is tested?*

You are looking for one small thing. If you find yourself redesigning
authentication, you have gone too far.

**4. Fix it.** The smallest change that makes the application verify the
password properly. Do not add a second check, do not add a new mechanism, and
do not change the hashing.

**5. Prove it.** The test that was red must go green. Strengthen it if it does
not yet assert everything you learned in step 2 — in particular, that a refused
login leaves **no usable session** behind, not merely a 401 status.

```bash
cd backend && npm test
```

**6. Open a pull request back into `lab/s0-06-simulation`**, using the template.

---

## Acceptance criteria

- [ ] The bug is fixed.
- [ ] `npm test` is green.
- [ ] Your PR shows the failing behaviour **before** the fix and the passing
      behaviour **after** — real output, not a description of it.
- [ ] A regression test proves an incorrect password is rejected **and** creates
      no authenticated session.
- [ ] You can explain, in your own words, why this was an authentication bypass
      rather than "a bug".

## Evidence the reviewer expects

Paste actual terminal output, not adjectives. At minimum:

- the failing test before your change,
- a request showing the vulnerable behaviour (status + `Set-Cookie`),
- the same request after your fix,
- the green test run.

## Hints, if you are stuck

<details>
<summary>Hint 1 — where to look</summary>

Everything you need is in `backend/src/routes/auth.js` and
`backend/src/auth.js`. One of these two files contains the flaw; the other is
correct and is worth reading to understand what the first one *should* be
doing.
</details>

<details>
<summary>Hint 2 — what to ask</summary>

The login route computes a single value that decides the outcome. Print it, or
log its type. Is it the kind of value you expected? Is an object that is not
`false` the same as "the password matched"?
</details>

<details>
<summary>Hint 3 — the shape of the answer</summary>

JavaScript will happily treat a pending operation as a perfectly good truthy
value. Nothing throws, nothing warns, and the check quietly passes for
everybody.
</details>
