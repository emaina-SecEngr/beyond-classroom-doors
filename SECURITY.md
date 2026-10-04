# Security

Strangers are being sent into high school classrooms, so the question this app has to answer is: **who can see and change what, and how do we know?** This page is the short version. The enforceable rules are in [GUARDRAILS.md](GUARDRAILS.md); the tests that hold them are listed there as standing tests 1–25.

## Reporting a problem

Email **mainin2003@yahoo.com** with "Security" in the subject. Please don't open a public issue for a vulnerability.

---

## The model in five rules

1. **Identity comes only from the verified sign-in token.** Every server action uses the caller's ID from the platform's JWT. Nothing in a request body can say who you are; a forged `volunteerId` is ignored (standing test 4).
2. **Every write is a server action that checks WHO and WHETHER.** Members can't create or delete records directly in any collection; the only direct edits are marking your own notification read and your own user row (whose role is system-managed, so nobody can promote themselves). Every other write goes through an action, and each action checks the caller's role *and* the record's current state (for example, you can only approve someone who is waiting; you can only claim a session that is open and in the future).
3. **What you can read is set in the schema and enforced by the server.** Hiding a button is never the protection. Private rows (a booked session's details, a volunteer's profile, license files) are readable only by their owner, the people the action shares them with, and staff.
4. **Roles come from the server, never from the page.** The "Sign in as Teacher / Program staff / Program admin" links only choose which hint to show; after sign-in, people land by their real role. Using the "wrong" link shows a note, never extra access.
5. **Everything privileged is audited, append-only.** The audit log can't be edited or deleted by anyone, including the admin.

## Roles and who grants them

| Role | Granted by | Enforced where |
|---|---|---|
| Program admin | Is the app owner (`OWNER_USER_ID`) | Server actions (`requireNonprofitAdmin`) |
| Program staff | **Only the program admin.** DeepSpace's built-in "set role" lets *any* admin promote anyone, unaudited; `worker.ts` intercepts it and refuses unless the sender is the owner, and audits every change (standing test 17) | `worker.ts` → `src/server/staff-guard.ts` |
| Delegated approver | Program admin, for a set time (max 30 days); ends early on demand or if staff status is lost | `activeVettingHelp` checked on every decision |
| Teacher | An invite by school email; accepted only by the account whose **verified** email matches (the browser sends nothing but its token) | `acceptTeacherInvite` |
| Volunteer | Anyone may apply; **only the program admin (or a delegated approver) approves, and the decision is final** | `vetVolunteer` |

## What's shared with whom

| Data | Who can see it |
|---|---|
| Open sessions (grade, topic, date, school, class size) | Signed-in members |
| Volunteer profile (profession, employer, skills, license, preferred schools) | The volunteer, staff, the program admin |
| Approved volunteers' **work profile** (name, profession, employer, years, skills, hobbies) | Teachers, through a teacher-only action that builds the response field by field (no email, phone, access needs or license) |
| Volunteer **email, phone, access needs** | Only the teacher of a session they're booked on, that school's staff, and the admin; copied onto the private session row at booking and **cleared on withdraw or cancel** |
| License documents | The volunteer and approvers only; fetched from the volunteer's private file space; every approver view audited; PDF/JPG/PNG up to 5 MB |
| Teacher's email and phone | The volunteer booked with them; on an invitation, the teacher's email only if she ticked "include my email" |
| Perk voucher links | The booked volunteer (the page shows them once they confirm; the link sits on the private session row from the moment staff add it); https links on the vendor's own site only; cleared on withdraw or cancel |
| Notifications | Never contain email addresses, phone numbers, access-needs text or voucher links; they say *that* something exists and where to look |
| Students | Nothing. No student data is collected |

**Access needs** are practical ("step-free route", "parking close to the entrance"), chosen from a list, never a diagnosis.

## Abuse limits built into the actions

- **One volunteer per session,** enforced by a database unique constraint, so two simultaneous claims produce exactly one winner (standing test 3).
- **Expired clearance can't claim,** checked inside the claim itself, not only by a scheduled job.
- **No self-withdrawal inside 48 hours** of the session (server time); after that, a change request goes to the program team.
- **Invitations:** a teacher can invite only to her own open, future sessions; only approved and cleared volunteers; at most 5 pending per session; no re-invite after a decline.
- **Staff edits are limited to their assigned school.**
- **Test data** can be loaded only by the program admin, adds only what's missing, and never touches teachers who already have sessions.

## Things the app deliberately doesn't do

- **No payments.** No cards, no balances; perks are vendor voucher links (decision D7).
- **No email sending.** Contact uses `mailto:` and `tel:` links in the person's own apps.
- **No location tracking.** "Directions" is a plain Google Maps link with the school's public address; Maps works out distance on the volunteer's device. No API key, and no home addresses stored.
- **No debug routes in production.** `/api/debug/*` answers only when `ALLOW_DEBUG_ROUTES` is set and the caller is an admin; the browser integration proxy has an empty allowlist, so it can't be used as an open relay. The template's `/api-status` page was removed.
- **A new applicant's form is held in their own browser tab** until they create an account; nothing reaches the server before they're signed in.

## How it's tested

- **Server-action security tests** (`src/actions/actions.test.ts`, 100+ cases) run the real actions against an in-memory store that enforces the same unique constraints as the platform: wrong role refused, forged IDs ignored, stale state refused, races, no emails in responses.
- **Schema permission tests** (`src/schemas/permissions.test.ts`): signed-out callers read nothing; members can't create records directly; the users table stays private.
- **Static guardrail check** (`scripts/guardrail-check.sh`): blocks known-dangerous patterns, for example calling `setRole` outside the owner-only panel, or importing worker code into the browser.
- **CI** (`.github/workflows/ci.yml`): secret scan, guardrail check, type-check and unit tests block the merge; deploy needs a manual approval.
- **Manual script:** [TESTING.md](TESTING.md), section 8 lists the "should be refused" checks.

## Known limitations

These are open and stated honestly rather than hidden:

1. **Staff can read other schools' data.** Their *writes* are limited to their assigned school, but DeepSpace read permissions are per role, not per school, so a staff member could read another school's sessions. Fine for a one-school pilot; needs per-school scoping before a district rollout.
2. **License file viewing is unit-tested, not yet verified on the live platform.** The test fakes the platform's file fetch; it needs one live check.
3. **E2E security tests need CI secrets.** The Playwright suite exists, but it runs only once test-account secrets are added to the CI environment.
4. **Teachers see all approved volunteers' work profiles** (no contact details). This was a deliberate product choice (decision D18) so teachers can invite; revisit if volunteers object.
5. **Perk links are hidden until confirmation by the page, not the server.** A booked volunteer who reads their private session row directly could see a voucher link before confirming. Low risk (they're the intended recipient), but noted.
6. **Vetting is recorded, not performed.** The app records that identity, license and clearance were checked; the checks themselves happen outside the app.
