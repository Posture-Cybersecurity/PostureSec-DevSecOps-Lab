# S0-06 — instructor walkthrough: the authentication bypass

**INSTRUCTOR ONLY. This file names the defect and the fix. It is on
`demo/instructor-s0-06` and must not be merged into the student branch.**

Student-facing brief: `docs/S0-06-TASK.md` on `lab/s0-06-simulation`, which
deliberately names neither the file nor the token.

---

## The three branches, and which is which

| Branch | Contains | Who |
|---|---|---|
| `demo/instructor-local-ports` | **no defects** — port isolation only | instructor, setup |
| `demo/instructor-s0-06` | the bypass **+ this walkthrough** | instructor, demo |
| `lab/s0-06-simulation` | the bypass, no solution | **students** |

---

## The defect

`backend/src/routes/auth.js`, in the login route:

```js
const ok = user && verifyPassword(password, user.password_hash);   // seeded
const ok = user && (await verifyPassword(password, user.password_hash));  // correct
```

One missing `await`.

`verifyPassword` is `bcrypt.compare`, which returns a **`Promise<boolean>`**.
Without `await`, `ok` is the Promise object itself. A Promise is always truthy —
including a Promise that will resolve to `false` — so `if (!ok)` never fires and
the route proceeds to mint a session.

Nothing throws. No warning is printed. bcrypt genuinely runs and genuinely
computes the right answer; the answer is simply never read.

## Why it is an authentication *bypass*

Authentication answers one question: *did this person prove who they are?* The
proof step still exists in the source, still executes, and its verdict is
discarded. Every account is reachable by anyone who knows the email address.

Note what is **not** broken, because students often reach for these first:

- passwords are still hashed with bcrypt; nothing is stored in plaintext,
- `password_hash` is still never returned by any endpoint,
- sessions are still opaque, server-side and revocable,
- there is no second login path and no backdoor account.

An unknown email is still refused (`user` is `undefined`, so `ok` is falsy).
That asymmetry is the tell: **known email → 200, unknown email → 401**, which
also reintroduces user enumeration. The existing no-enumeration test catches it
as a second, independent symptom of the same line.

---

## Running the demo

Set the stack up per `docker-compose.demo.yml` (instructor band
3900 / 5900 / 55900), then:

**1. A real account exists**

```bash
curl -s -o /dev/null -w "register -> %{http_code}\n" \
  -X POST http://localhost:5900/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.test","password":"correct-horse-battery-staple"}'
```

**2. The correct password works — establish the baseline first**

```bash
curl -i -s -X POST http://localhost:5900/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.test","password":"correct-horse-battery-staple"}' \
  | grep -iE "^HTTP|set-cookie"
```

`200 OK` and a `psec_session` cookie. Say out loud that this is what success
looks like, so the next step lands.

**3. Now the wrong password — the moment of the demo**

```bash
curl -i -s -X POST http://localhost:5900/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.test","password":"totally-the-wrong-password"}' \
  | grep -iE "^HTTP|set-cookie"
```

`200 OK`, and a **new** session cookie. Pause here.

**4. Prove the session is real, not just a stray header**

Copy the cookie from step 3:

```bash
curl -s http://localhost:5900/api/auth/me \
  -H "Cookie: psec_session=<the-value-from-step-3>"
```

It returns the genuine user's id, email and role. This is the point worth
labouring: the attacker is not "seeing a 200", they are **holding a working
session for someone else's account**.

**5. Show the asymmetry**

```bash
curl -s -o /dev/null -w "unknown email -> %{http_code}\n" \
  -X POST http://localhost:5900/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ghost@example.test","password":"anything"}'
```

`401`. Known accounts let you in, unknown ones do not — so the endpoint now also
tells an attacker which email addresses are registered.

**6. Show the test suite already knew**

```bash
cd backend && npm test
```

Two failures, one root cause: the password test and the enumeration test.

---

## The fix, and what to insist on

Add the missing `await`. Then:

```bash
cd backend && npm test     # 21/21
```

Do not accept a fix that:

- adds a second comparison "just to be safe" — one check, done correctly,
- compares hashes by hand, or with `==` / `===` on the digest,
- switches to a synchronous bcrypt call to dodge the async question. It works,
  but it blocks the event loop and dodges the lesson. If a student proposes it,
  that is a good conversation, not a pass.

Insist on evidence in the PR: the red run, a request showing the vulnerable
behaviour, and the green run. "It works now" is not evidence.

## Talking points, if there is time

- **Why no exception?** This is what makes async bugs a security class of their
  own. A forgotten `await` does not fail loudly; it silently substitutes an
  object for a boolean, and every truthiness test then says yes.
- **Why the tests caught it but a human might not.** The route reads almost
  correctly at a glance. The test does not read the code — it asks the endpoint
  a question and checks the answer, which is why behavioural tests are worth
  writing for authentication specifically.
- **Where this happens in real systems.** Anywhere a verification helper is
  async: token introspection, signature checks, MFA verification, policy lookups.
