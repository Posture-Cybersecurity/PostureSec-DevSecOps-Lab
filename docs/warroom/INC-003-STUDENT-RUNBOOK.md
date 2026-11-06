# INC-003 — Secret/Image Compromised

> Sprint 3 / DSO-W3 · War Room. A hands-on security incident. There is **no
> answer key here** — you investigate from the evidence, contain, remediate, and
> prove recovery.

## Scenario

The Sprint 3 application has been built and deployed locally and appears
**healthy**. Security monitoring has detected **credential material associated
with the container image currently in use**.

The application may keep functioning normally. That is exactly the trap: your job
is to investigate the **security state of the image**, not to assume that a
responding application means the image is safe.

## Before You Start

You will need:

- Docker installed and running.
- Access to the **PostureSec-DevSecOps-Lab** repository.
- A terminal open in the **War Room repository/worktree** (run the commands below
  from the repo root).
- Git Bash or an equivalent shell.

This is a **local training environment**. The credential material used in this
exercise is **synthetic** — it is not real and authenticates to nothing.

> Windows + Git Bash: if a `docker` command errors on a path, re-run it with the
> prefix `MSYS_NO_PATHCONV=1`.

## Launch the War Room

```bash
WAR_ROOM_INCIDENT=INC-003 bash warroom.sh up
```

Confirm the containers are running:

```bash
docker ps
```

You should see the War Room application containers up. Open the app:

```
http://localhost:8080
```

Check the backend health:

```bash
curl http://localhost:8080/api/health
```

A healthy response is expected **initially** — the application starts and serves
normally.

## What You Will See

Shortly after launch, the War Room raises an active security incident. The
homepage banner and the incident brief will show something like:

```
🔴 INC-003 · ACTIVE

Security incident

Security monitoring detected credential material in the container image
currently in use.
```

The application may still respond to requests while this incident is active.

## Your Mission

1. Investigate what triggered the alert.
2. Identify the affected container and image.
3. Determine whether credential material exists in the **running container**.
4. Investigate the **image metadata / history** and the build configuration.
5. Determine how the credential material became associated with the image.
6. Contain the exposure.
7. Remediate the build.
8. Rebuild the image.
9. Prove the corrected image is clean.
10. Confirm the application still works after remediation.

> **Do not jump straight to the fix. Collect evidence first.** A healthy,
> responding application is not proof that the image is secure.

## Useful Starting Commands

These are **starting points**, not answers. You decide which evidence matters.

```bash
docker ps
```

```bash
docker inspect warroom-local-backend --format '{{.Config.Image}}'
```

```bash
docker inspect warroom-local-backend --format '{{.Image}}'
```

```bash
docker image inspect posturesec-warroom-local-backend:latest
```

```bash
docker history posturesec-warroom-local-backend:latest
```

```bash
docker exec warroom-local-backend sh -lc 'find /app -maxdepth 3 -type f -print | sort'
```

Reason from what you find. Remember to look at the image itself — its metadata,
history, and filesystem — not only at whether the app responds.

## Evidence to Capture

Keep a record, with command output, for each of:

- the affected container
- the affected image
- the image identity / digest
- the suspicious credential material
- your image / build investigation
- the root cause you identified
- containment
- remediation
- the corrected image identity / digest
- successful application health **after** remediation

## Completion Criteria

The incident is **not** complete just because the application returns HTTP 200.
To finish, you must prove, with evidence, that:

- you understood the security issue
- the exposure was contained
- the build was remediated
- the corrected image was rebuilt
- the corrected artifact is **clean**
- the corrected application works
- every conclusion is backed by evidence

## Reset / Relaunch

To stop and reset the disposable local War Room runtime:

```bash
WAR_ROOM_INCIDENT=INC-003 bash warroom.sh down
```

To replay the exercise from a fresh start:

```bash
WAR_ROOM_INCIDENT=INC-003 bash warroom.sh up
```

This resets only this exercise's local runtime. Do not delete unrelated Docker
containers, images, networks, or volumes.

## Safety

- This is a **local training exercise**.
- The credential is **synthetic** and authenticates to nothing.
- Do **not** substitute real credentials.
- Do **not** push the training image or any secret to GHCR or another external
  registry.
- Do **not** deploy this exercise to production.
