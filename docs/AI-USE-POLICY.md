# AI Use Policy

**Applies to:** every engineer on the AI DevSecOps Engineering Experience, for all work
submitted to this programme.
**Read alongside:** the [Engineering Handbook](ENGINEERING-HANDBOOK.md), §4 *Working with
Grok*, which describes day-to-day practice. This document is the policy you acknowledge.

You are expected to use AI. This policy is not a restriction on using it — it is the set
of rules that make using it safe and defensible.

---

## 1. The governing rule

> **AI output is never evidence.**

An AI answer is a **hypothesis**. It becomes a finding only when you establish it yourself
— by running it, reading the source, or reproducing the behaviour.

This applies without exception, including when the answer is detailed, confident, well
formatted, and turns out to be correct. Being right by luck is not the same as being
verified.

## 2. You own what you submit

Whatever an AI produced, **you** are the author of record. You will be asked to defend it
in review, and "the AI wrote it" is not a defence. If you cannot explain why a change is
correct, do not submit it.

## 3. What you must never send to an AI tool

Do not paste any of the following into any AI system, in any form, at any time:

| Category | Examples of what this covers |
| --- | --- |
| **Live credentials and secrets** | API keys, tokens, passwords, private keys, connection strings, `.env` contents |
| **Personal data** | Learner, customer, colleague or third-party personal information |
| **Production configuration** | Production hostnames, internal network detail, infrastructure identifiers, real customer environments |

Three tests, any one of which means **stop**:

1. Would this let someone act as me, or as the organisation?
2. Is this about a real person who did not agree to it being shared?
3. Could I not defend sending this to a stranger?

**"Internal" is not a safety property.** Data being private to the organisation is exactly
what makes pasting it a disclosure. A prompt is an external transmission.

### What you may safely send instead

You may describe a secret's **name, purpose and scope** without its value — *"a container
registry push token with write access"*. That is almost always all the AI needs. The same
applies to configuration: describe the shape, not the values.

### If you send something by mistake

Report it immediately in your squad channel and tell your instructor. Do not delete the
conversation and say nothing. Accidental disclosure handled openly is a recoverable
incident; concealment is not.

## 4. What AI is appropriate for

Explaining unfamiliar code · researching an error · generating ranked hypotheses ·
drafting a first implementation, description or document · interpreting tool output ·
challenging your own reasoning.

In every case the output is a starting point that you verify.

## 5. What AI must never decide for you

- Whether a security finding is **real**.
- Whether a change is **safe to merge**.
- Whether a control is **working**.
- Any factual claim about **this repository** — it cannot read your code and will
  reconstruct plausible answers that do not match what is actually there.

## 6. You must disclose AI use

Whenever AI contributes to work you submit, record it in an **AI Interaction Log**: the
prompt, the raw output, your verdict (accept / reject / partial), and what *you* ran or
read to establish it.

Undisclosed AI use in submitted work is a conduct matter, not a style preference. A log in
which every suggestion was accepted indicates you were not reading carefully.

## 7. When you are unsure

Ask before you paste, not after. In order: your squad channel, then your instructor. There
is no penalty for asking, and the question takes less time than the incident does.

---

## Acknowledgement

By acknowledging this policy you confirm that you have read it, that you understand the
governing rule and the categories in §3, and that you accept responsibility for work you
submit regardless of how it was produced.

Acknowledgement is recorded against your enrolment.
