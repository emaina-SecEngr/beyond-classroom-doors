# GUARDRAILS — read before every change

These are the checks and balances for this app, distilled from the DeepSpace docs
(docs.deep.space) and from our own security review. They apply to every human and
every coding agent working in this repo.

**Precedence:** the user's explicit instruction > this file > DeepSpace docs > agent defaults.
If this file and the docs disagree, **stop and ask** — don't pick one silently.

**Companion files (local only, gitignored):**
- `docs/decisions.md` — locked decisions and open spikes. Re-read on every resume.
- `docs/lessons.md` — every gotcha, appended the moment it's learned.

**Mechanical enforcement:** `bash scripts/guardrail-check.sh` (security, blocking in CI)
and `bash scripts/design-gate.sh` (design, warn in CI). Section numbers below are
referenced by the scripts' output.

---

## 0. How to work

- Run the app only with `npx deepspace dev start`. Never `vite`, `vite preview`, or a custom start script.
- One checkout, one dev server, one thread of work. No parallel worktrees.
- Before using any SDK API: read the docs page (docs MCP or `<url>.md`) and the types in
  `node_modules/deepspace/dist/*.d.ts`. **Never guess an API name or signature.**
- Commit before every risky pass (refactor, review fixes, redesign). Small commits.
- Append every surprise, wrong assumption, or doc trap to `docs/lessons.md` immediately.
- Never weaken or delete a test to make it pass. Fix the code, or ask.

### CLI discipline
- Start every session with `npx deepspace status`. Its first line names the plane the
  next command will mutate: it must say `production`. A stray `DEEPSPACE_ENV` or
  `DEEPSPACE_AUTH_URL` silently switches planes and credentials.
- Use `--json` and branch on the **exit code and `code` field**, never on the prose.
  Exit 0 = done, 1 = failure (fix the cause; retrying won't help),
  2 = safe partial stop (read the facts; follow an `action` only if one is given).
- Run an `action` as an argv array in its `cwd`. Never invent a command when no
  `action` is returned.
- Before committing, run `npx deepspace test run all`. The default suite (smoke + api)
  **skips** the multi-user security specs; check `skippedSpecs` in `--json`.
- Check spend daily with `npx deepspace app usage` (account-wide).
- Log messages: put the error message in the log line itself
  (`console.error(\`[claim] ${err.message}\`)`), and never log emails, tokens, or
  anything about a person beyond an ID. Platform logs are stored.
- Triage logs on `level`, `request.status`, and `eventType === "exception"`,
  never on `outcome` alone (`outcome: "ok"` can still be an error response).

### Stop and ask before
- Spending money beyond a stated spike budget (`integrations invoke` is billed).
- Changing any integration's billing mode, or any permission rule to make a test pass.
- Deleting data, dropping/renaming a schema column, `app undeploy`, or removing a DO class.
- Adding a new integration, collection, or route tier.
- Descoping any **Must** requirement, or marking a failed spike as "fine".

### Flags an agent must never pass without the user's explicit approval
These flags exist precisely to supply consent. An agent supplying them is consenting
on the user's behalf.

| Flag / command | Why it needs a human |
|---|---|
| `--yes` on `integrations invoke` | Confirms a **paid** call |
| `--yes` on `rollback`, `app undeploy`, `secrets configs delete` | Destructive: undeploy **destroys all app data** |
| `rollback --allow-do-deletion` | Deletes stored data of dropped Durable Object classes |
| `deploy --ignore-stale` | Overwrites someone else's newer release |
| `app init --new-id` | Forks the app: new data, new secrets, new identity |
| `deploy --rename` | Moves the public URL |
| `test accounts clear` | Wipes the test-account pool **shared by every app** on the machine |
| `test accounts delete` | Immediate, no prompt |
| `app collaborators add` | Grants **owner-equivalent deploy access** |
| `auth logout` | Revokes the session server-side, logging out every copy (laptop and CI) |

---

## 1. Security non-negotiables (blocking)

1. **Identity comes only from the verified JWT.** In server actions use `ctx.userId`.
   Never read the actor's identity from `params` or any client-supplied field.
2. **Every server action checks WHO and WHETHER before writing.** Actions bypass RBAC:
   check the caller's role/status AND the target record's current state.
3. **Permissions live in schemas, enforced by the server.** Hiding UI is not security.
   A `where` clause is not security (the client chooses it).
4. **Users schema stays private:** keep `member: { read: 'own' }` and set
   `roster: 'read-policy'`. Never `member: { read: true }` on users.
5. **Never return a raw user row from an action.** Build responses field by field.
   No emails, tokens, or `callerJwt` in any response.
6. **Email and LLM calls happen only in server actions.** The browser never calls
   `integration.post` for email or AI. The browser sends intent ("claim session X");
   the server decides recipients, content, and prompts.
7. **Paid calls are bounded by design.** Confirmation emails and the AI brief run only
   inside `claimSession` (one claim per session via `uniqueOn`). The admin
   broadcast is capped at once per day (checked against the audit log).
8. **Secrets:** never commit `.dev.vars`, `~/.deepspace/*`, or `.claude/launch.json`.
   Never log or return `callerJwt`/tokens. Never put tokens in URLs or `localStorage`.
   Production secrets are set with `npx deepspace secrets set`, never via `.dev.vars`.
   Never publish `dist/` as a CI artifact or archive: a Cloudflare build can leave a
   copy of the secrets at `dist/<worker>/.dev.vars`.
9. **No student data, ever.** Session-level aggregates only (grade level, headcount).
   Nothing about students is stored or sent to the LLM.
10. **Audit log is append-only:** `update: false, delete: false` for every role,
    including admin. Every privileged write records `ctx.userId`.
11. **Scheduled jobs:** only admins may trigger/pause/resume (customize the cron route's
    role resolver). No personal data in cron error messages.
12. **Status transitions check the current state** inside the action (e.g. vet only if
    `applied`). No blind status writes.
13. **Clearance expiry is enforced inside `claimSession`**, not only by the cron job.
14. **Excluded by design:** bundled public messaging (public to all members), Yjs rooms
    without a `documents` collection, presence on volunteer-facing pages.
15. **Never import `deepspace/worker` from browser code.** Shared schemas import from
    `deepspace/schema`.
16. **Never gate security on `isProduction()` / `isLocalDev()`** or any client-side
    environment detection.
17. **Destructive actions are reversible-by-design:** cancel sessions with
    `status: 'cancelled'`; never hard-delete sessions, claims, or audit entries.
18. **Only the nonprofit admin (app owner) changes who is staff** (decision R6).
    DeepSpace's built-in set-role message lets any admin set any role, unaudited;
    `AppRecordRoom.webSocketMessage` in `worker.ts` must keep checking it with
    `decideSetRole` (src/server/staff-guard.ts). Never call `useUsers().setRole`
    outside src/components/admin/StaffAccess.tsx (the owner-only panel).

---

## 2. Platform rules (DeepSpace)

### Routes
- Landing page: `src/pages/index.tsx` is **static** — no data or auth hooks.
- Data pages: `src/pages/(app)/`. Signed-in-only pages: **only** under
  `src/pages/(app)/(protected)/`. Never create a `(protected)` folder anywhere else
  (it would gate nothing).
- Home: `src/pages/(app)/home.tsx` **is** the session board. First line is the
  `/* home pattern: ... */` declaration. Signed-out visitors see a **hardcoded, labeled
  sample** board — never a real query.
- CTAs that need sign-in point to a `(protected)` route, never to `/home`.

### Records
- Fields live under `record.data.<field>`. `record.<field>` is a bug.
- Use `createConfirmed` / `putConfirmed` / `removeConfirmed` before any success toast or
  navigation. Plain mutations are fire-and-forget and fail silently offline.
- `put` sends only the changed fields.
- Schemas: additive changes only after first deploy (no rename, drop, or type change).
  Restart `dev start` after any schema change.
- Record IDs are not secrets; never use one as an access token or "private link".

### UI kit and feedback
- Import UI from `src/components/ui`, never from `deepspace`.
- No `window.confirm/alert/prompt`, no native `<select>`, no raw `<div onClick>`.
- `ConfirmModal` names the item ("Reject Jane Doe's application?").
- `Button loading={...}` for async actions; `EmptyState` with an action; `Badge` for
  statuses; `Tabs` for queues; `animate-pulse` skeletons while loading.
- Integration-backed views use `useAsyncResource` with four states (loading, error with
  retry, empty, success). Never reload the whole page on an error.
- Keep the scaffold's `AuthBoot` `onWriteError` wiring and the test IDs
  `app-navigation`, `nav-sign-in-button`, `nav-user-name`.

### Auth
- Sign-in checks: `useAuth().isSignedIn`. Role-gated UI:
  `useAuthProfileReady({ requireUser: true })`. Destructure `const { user } = useUser()`.
- Any custom HTTP route verifies the JWT with `verifyJwt` and checks `result` (it never throws).
- `getAuthToken()` returns `null` when signed out — check before calling an action.

### Never
- Remove a DO class from the manifest, edit `DEEPSPACE_APP_ID`, or run `app undeploy`.
- Copy code from `landing-design/examples` or ship scaffold landing sections verbatim.
- Deploy a dirty working tree. With GitHub as the source of record, `deploy` ships the
  working tree **as-is** (no `dirty_worktree` guard), so commit first or deploy from CI.
- Expose local agent tools from this app without an explicit decision (see Spike S9).

---

## 3. Design rules

- Direction block at the top of `src/pages/index.tsx` (see `docs/decisions.md`).
- Theme: `front-office` block in `src/themes.css`, registered in `src/themes.ts`, set in
  `index.html`; light, `color-scheme: light`, `--radius` ≈ 4px.
  Fraunces (headings) + Source Sans 3 (body). Chalkboard-green primary, cream background.
  Verify contrast: 4.5:1 body text, 3:1 large text.
- Semantic tokens only. No hex, `rgb()`, or palette classes (`green-700`), no
  purple/indigo gradients, no `foreground/` fractional opacity.
- No pictograph emoji anywhere in UI chrome. Lucide outline icons only.
- Hero headline 3–8 words. Landing body copy under ~150 words. No three identical cards.
- Motion is mechanical and once-only. Wrap the landing page in
  `<MotionConfig reducedMotion="user">`. Any `setTimeout` / `requestAnimationFrame`
  animation calls `useReducedMotion()` and jumps to its end state.
- Voice: second person, never starts with "we"; max 12 words per sentence;
  no exclamation points.
- Page `<title>` and favicon are app-specific (not "DeepSpace App").

---

## 4. Review checklist (every change, before commit)

- [ ] `bash scripts/guardrail-check.sh` passes (section 1 rules).
- [ ] Every new/changed server action: identity from `ctx.userId`; WHO + WHETHER checks;
      no raw user rows in the response; audit entry written.
- [ ] Every new/changed schema: explicit permissions for each role; no `member: { read: true }`
      on sensitive collections; additive-only if already deployed.
- [ ] Every new page: correct route tier; four UI states; no emoji; semantic tokens.
- [ ] Every success toast follows a **confirmed** write.
- [ ] Tests extended (section 5). No test weakened.
- [ ] Any surprise recorded in `docs/lessons.md`.
- [ ] Permission/auth/money changes got an **independent review** (a fresh agent session
      that didn't write the code), with each finding verified against the source.

---

## 5. Test obligations

Extend the scaffold's three specs; don't add parallel suites.

| Change | Required test |
|---|---|
| New schema | `smoke.spec.ts`: CRUD happy path for a signed-in user |
| New page or route | `smoke.spec.ts`: loads with real content; gated pages show the overlay when signed out |
| Permission rule | `collab.spec.ts`: two authorized users + one outsider |
| Server action | `api.spec.ts`: 401 signed out; wrong role refused; happy path |
| Integration call | Mock only the paid boundary with `page.route(...)`; never flip billing modes |
| Bug fix | A failing test first, then the fix; the test stays |

**Standing security tests (must stay green):**
1. Signed-out calls to every action return 401.
2. A non-approved volunteer cannot claim, even by calling the action directly.
3. Two simultaneous claims → exactly one winner.
4. A forged `volunteerId` in the request body is ignored.
5. A user cannot change their own role or status (UI **and** raw `clientBuild.put`).
6. Teacher A cannot edit teacher B's request.
7. Only the nonprofit admin (or staff during an active help request) approves or rejects a volunteer, and the decision is final: no one can re-decide an approved or rejected volunteer.
8. A new sign-up's user directory contains only themselves.
9. Action responses contain no emails or tokens.
10. Members cannot trigger or pause cron tasks (`read_only`).
11. An expired clearance cannot claim even if the cron job never ran.
12. A stale "vet" after a rejection is refused.
13. Audit entries cannot be updated or deleted by anyone.
14. Live app: `/api/debug/*` does not answer; the integration proxy cannot be used as an
    open email relay (signed out and as a plain member).
15. A withdrawn session can be reclaimed, by exactly one new volunteer.
16. Only the claimant can confirm, withdraw or request a change; self-withdrawal is
    refused inside 48 hours (server time).
17. Only the nonprofit admin can grant or remove staff; another staff member's
    set-role message is refused and audited; the owner's own access can't be changed;
    no role values other than admin/member.
18. Staff can decide on volunteers only during an active help request from the nonprofit
    admin (ended or expired help, or losing staff status, stops it); only the nonprofit
    admin grants help.
19. Only the program admin creates or edits schools; a teacher needs an active school;
    a session's school is taken from the teacher's assignment, never from the request.
20. A teacher invite is accepted only by the signed-in account whose verified email
    matches it; members can't read invites; a revoked invite never grants access.
21. Staff can change or cancel sessions only at the school they're assigned to; only the
    booked volunteer can list equipment; only requested items can be marked ready.
22. A license file opens only for its volunteer or an approver (program admin / delegated
    staff); it is fetched from that volunteer's private space only; approver views are
    audited; uploads are PDF/JPG/PNG up to 5 MB.
23. Only the program admin assigns a volunteer to a session, with the same checks as a
    self-claim; a date proposal can only be answered by the other party; contact details
    live only on the private session row (never in notifications) and are cleared on
    withdraw or cancel.
24. A volunteer's access needs are practical help, never a diagnosis; they reach only the
    booked session's teacher, school staff and the program admin; notifications say only
    that needs exist; only the volunteer edits them; cleared on withdraw or cancel.

---

## 6. Definition of done

A feature is done only when all six gates pass:

1. Type-check and `npx deepspace test run` pass — necessary, never sufficient.
2. Changed screens inspected visually.
3. Diffed against the Design Direction.
4. Core loop driven **on the deployed app** as a **fresh test account**, with screenshots.
5. Multi-user features verified with multiple real sessions.
6. Failure states exercised: denied, expired, empty, offline.

Report with evidence and keep a hard line between **built and verified**,
**built but unverified**, and **not built**.

---

## 7. Known doc traps — never copy these patterns

| Doc pattern | Why it's wrong here | Do instead |
|---|---|---|
| Data storage example: `try { await create(...); success(...) }` | `create` is fire-and-forget; the toast shows even if the server rejects | `createConfirmed`, then toast |
| Server actions example `inviteAttendee` | No authorization check — any user can modify any record | WHO + WHETHER checks first |
| Quickstart: "deploy syncs secrets from `.dev.vars`" | Deployment page: deploy never reads `.dev.vars` | `npx deepspace secrets set` |
| Default role: `member` (permissions) vs `viewer` (auth reference) | Inconsistent | Verify in Spike 1; record result |
| Cron monitor: members can trigger/pause by default | Lets any user pause clearance expiry | Admin-only role resolver |
| Anti-AI gate emoji check with `2>/dev/null` | Fails open in non-UTF-8 locales | Use `scripts/design-gate.sh` |
| Examples giving `admin: { delete: true }` | Wrong for the audit log | `delete: false` for all roles |
| `npx deepspace test run` with no suite | Runs smoke + api only; multi-user security specs are skipped | `test run all` before commit |
| `test accounts create --password ...` | The password lands in shell history | Low-value test credentials only; never reuse a real password |
