# Manual test plan: San Diego Unified test data

Live app: https://beyond-classroom-doors.app.space · Decision D16 · About 45 minutes end to end.

## Test accounts

Use a separate private/incognito window (or browser profile) for each account so you can stay signed in as several people at once.

| Who | Account | Role after setup |
|---|---|---|
| **A** program admin | your owner account | Nonprofit admin (Approvals, School, Program board) |
| **T1** teacher | `you+lincoln@gmail.com` | Teacher at Lincoln High |
| **T2** teacher | `you+hoover@gmail.com` | Teacher at Hoover High |
| **S** staff | `you+staff@gmail.com` | Program staff, assigned to Lincoln High |
| **V1** volunteer | `you+vol1@gmail.com` | Volunteer, approved |
| **V2** volunteer | `you+vol2@gmail.com` | Volunteer, rejected |

Gmail delivers `+anything` addresses to your normal inbox. If sign-in only offers Google accounts, use separate Google accounts instead and enter those emails in step 1.

The schools and addresses are real public listings from the San Diego Unified directory. Every person and session is a test. Sample sessions say **[Test data]** in the teacher note.

---

## 1 · Load the test data (A)
1. Sign in as **A** → **Approvals → Schools**. Scroll to **Test data**.
2. The box suggests `you+lincoln…` and `you+hoover…`. Keep or edit them → **Load test data**.
   - ✅ Toast: *5 schools added* (fewer if some already exist), *2 teacher invites, 0 sample sessions*.
   - ✅ Schools list: Lincoln, Hoover, Crawford, San Diego High and Point Loma, each with its address. Each teacher shows as *invited* under their school.

## 2 · Teachers sign in (T1, T2)
1. Sign in as **T1**.
   - ✅ Toast: *Welcome. You have teacher access at Lincoln High.*
   - ✅ Nav shows **Teacher desk**.
2. Repeat for **T2** (Hoover High).
3. Back as **A**: **Approvals → Schools → Load test data** again.
   - ✅ Toast: *4 sample sessions* (two each).
4. **Program board**.
   - ✅ Four open sessions, filterable by school. Each shows grade, topic and time.

## 3 · Volunteers apply (V1, V2)
1. Sign in as **V1**.
   - ✅ Nav is **My sessions · My teachers · Inbox · Profile**, with no board and no Settings.
   - ✅ Lands on **My sessions** with *Apply* status.
2. **Profile**: fill in name, profession (e.g. *Registered Nurse*), employer, skills, years, hobbies, phone, and access needs (e.g. *Uses a wheelchair; needs a ground-floor room*). Add a license type, number and state, upload a small PDF, then **Save**.
   - ✅ Status *Applied*.
3. **V2**: same steps, minimal profile.

## 4 · Admin decides (A) — the decision is final
1. **Approvals → Waiting**.
   - ✅ V1 and V2 are listed. Opening one shows the profile, license details and the uploaded file.
2. **Open the license file**.
   - ✅ The PDF opens in the viewer. *This has not been verified live yet, so check it carefully.*
3. **Approve V1** (identity confirmed, clearance date a year out). **Reject V2** with a reason.
   - ✅ V1 moves to **Approved**.
   - ✅ No button to re-decide either one.
   - ✅ **Decisions** shows both.
4. As **V1**: **Inbox**.
   - ✅ Approval message.
   - ✅ **My sessions** now lists **Open sessions** with a *Claim* button.
5. As **V2**.
   - ✅ Status *Not approved*, with the reason.
   - ✅ No open sessions to claim.

## 5 · Booking and prep (V1, T1)
1. **V1** claims the Lincoln *Healthcare* session.
   - ✅ It moves to their booked list with school, teacher, room, class (*Period 2 · Health Science*) and 28 students.
2. **V1**: request equipment (projector, markers…) and confirm availability.
3. **V1 → My teachers**.
   - ✅ Card for T1 with Lincoln High and its address, an **Email** button, and the session.
   - ✅ **Open** goes back to the session.
4. **T1 → Teacher desk**.
   - ✅ Booked volunteer shows with **Email** and **Call**.
   - ✅ Access needs text appears (*To help them on the day…*).
   - ✅ The notification T1 got says only that access needs exist, not what they are.
5. **T1**: tick the equipment as ready → **Class is ready** with a note.
   - ✅ V1's inbox gets the message.
   - ✅ The session shows *Class ready*.

## 6 · Change of date (T1 ↔ V1)
1. **T1 → Propose another date** with a reason.
   - ✅ V1 sees a yellow banner.
2. **V1 → Accept new date**.
   - ✅ The date changes on both sides.
3. Optional: V1 proposes, T1 declines.
   - ✅ The date stays the same.

## 7 · Admin assigns and staff (A, S)
1. **A → School** (choose Hoover) → **Assign volunteer** → V1 to a Hoover session.
   - ✅ It appears in V1's My sessions and My teachers (T2).
2. **A → Approvals → Delegate & staff**: make **S** staff (S must have signed in once) and assign them to Lincoln High.
3. **S**.
   - ✅ **School** shows Lincoln only.
   - ✅ No Approvals in the nav.
   - ✅ Can edit Lincoln session prep.
   - ✅ Editing a Hoover session is refused.
4. **A**: delegate approvals to S for 1 day.
   - ✅ S now sees **Approvals** (Waiting only).
   - ✅ After **End**, it disappears.

## 8 · Negative checks (should all fail politely)
- **V2** opens `/approvals` or `/staff` directly → ✅ refused or empty, no data.
- **T1** opens `/approvals` → ✅ refused.
- **S** tries to make someone staff → ✅ refused (only the owner can).
- **V1 withdraws** the Lincoln booking → ✅ T1 no longer sees V1's contact details or access needs.
- **A cancels** a session → ✅ the volunteer is told; contact details are unshared.
- No email address, phone or access-needs text appears in any notification body.

## Results log
| Step | Pass/Fail | Notes / screenshot |
|---|---|---|
| 1 |  |  |
| 2 |  |  |
| 3 |  |  |
| 4 |  |  |
| 5 |  |  |
| 6 |  |  |
| 7 |  |  |
| 8 |  |  |
