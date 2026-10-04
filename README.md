# Beyond Classroom Doors

**Live:** https://beyond-classroom-doors.app.space

Nurses, electricians and engineers visit a high school classroom for one hour to talk about their real jobs. Teachers post a session, a vetted volunteer claims it, and the school gets the class ready. The pilot targets San Diego Unified high schools.

Built on DeepSpace (Cloudflare Workers, a record database per app, React).

---

## Who uses it

| Role | How they get it | What they do |
|---|---|---|
| **Volunteer** | Applies on **Volunteer → Apply** (form first, then an account with Google or GitHub) | Fills in a profile (profession, license, schools they'd like, access needs); once approved, claims open sessions or accepts teachers' invitations; confirms; proposes another date; gets directions to the school |
| **Teacher** | Invited by the program admin by school email; signing in with that email gives teacher access at that school | Posts sessions; sees **My volunteers**: who's booked, contact, access needs, a prep checklist; invites approved volunteers; marks the class ready; proposes another date |
| **Program staff** | Granted by the program admin only, and assigned to one school | Works with that school's teachers on session prep; can help with approvals only when the admin delegates it, for a set time |
| **Program admin** | The app owner (the nonprofit) | Approves or rejects volunteers (final); manages schools, teachers and staff; assigns volunteers to sessions; sees everything |

Students never use the app, and **no student data is stored**: sessions record only grade, topic and headcount.

## How a session happens

1. **Teacher** posts a session: date, time, grade, topic, class size.
2. **Volunteer** applies; the **program admin** checks identity, license and school clearance (TB test, background check) and approves. The decision is final.
3. The approved volunteer **claims** the session (or accepts a teacher's invitation, or the admin assigns them). Exactly one volunteer can hold a session.
4. The teacher sees the volunteer's contact details and any access needs, works through the **prep checklist**, and marks the **class ready**. Either side can propose another date; the other side accepts or declines.
5. The volunteer confirms, gets **directions** to the school, and any thank-you perks the program attached.

## Try it

- Sign in with the links in the top bar: **Volunteer · Teacher · Program staff · Program admin**. They all open the same sign-in; what you can do comes from your real role, never from the link you used.
- The program admin can load realistic test data (**Approvals → Schools → Load test data**): five real San Diego Unified high schools (public addresses), test-teacher invites and sample sessions marked "[Test data]".
- **[TESTING.md](TESTING.md)** is the step-by-step manual test script for every role, including the "should be refused" checks.
- Test accounts with a password: `npx deepspace test accounts create --email=vol1@deepspace.test --name="Test Volunteer" --password-stdin`.

## Run it

```bash
npm install
npx deepspace auth login        # once
npm run dev                     # local dev
bash scripts/precommit.sh       # type-check, guardrail check, unit tests, design gate
npm run build
npx deepspace deploy
```

| Command | What it runs |
|---|---|
| `bash scripts/precommit.sh` | Everything below except E2E, the same gates CI blocks on |
| `npm run test:unit` | Vitest: server-action security tests, schema permission tests, UI render tests |
| `npm test` | Playwright E2E against a deployed app (needs test accounts) |
| `bash scripts/guardrail-check.sh` | Static checks for the rules in [GUARDRAILS.md](GUARDRAILS.md) §1 |

## Where things live

```
src/schemas/          one file per collection, with its permissions (who can read what)
src/actions/index.ts  every write: server actions that check WHO and WHETHER before writing
src/actions/*.test.ts security tests that run the real actions against an in-memory store
src/pages/            pages (generouted). (app)/(protected) = sign-in required
src/components/       UI, incl. admin/ (approvals, schools, staff) and the pickers
worker.ts             Cloudflare Worker + the guard on DeepSpace's built-in role changes
GUARDRAILS.md         the rules every change follows, and the standing security tests
SECURITY.md           the security model in one page
```

## What's deliberately not here

- **No payments.** Donations go by email to the program. Thank-you perks (meals, rides) are voucher links the program creates with the vendor; the app stores the link and never handles money.
- **No in-app email sending.** Contact uses the person's own mail or phone app (`mailto:` / `tel:` links), because the email sender domain isn't verified yet.
- **No student data**, no messaging between volunteers, no public profiles.

## Status

A working pilot built for an application exercise. Before real use: a registered nonprofit account, school-district sign-off on the vetting steps, and the open items in [SECURITY.md](SECURITY.md#known-limitations).
