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

## 2b · Teacher profile (T1)
1. As **T1** → **Profile**.
   - ✅ School shows *Lincoln High* with its address, and can't be edited.
2. Set the name *Ms. Rivera*, subject *Health Science / Medical*, grades 11 and 12, phone *619-555-0100* → **Save**.
   - ✅ Saved; a reload keeps it.

## 3 · Volunteers apply (V1, V2)
1. Sign in as **V1**.
   - ✅ Nav is **My sessions · My teachers · Inbox · Profile**, with no board and no Settings.
   - ✅ Lands on **My sessions** with *Apply* status.
2. **Profile**: fill in the form using the dropdowns:
   - Name, employer, skills, hobbies and phone are typed.
   - **Profession**: pick *Registered Nurse*. Try *Other…*: a text box appears.
   - **Years of experience**: pick from the list.
   - **Access needs**: tick *Step-free / wheelchair-accessible route* and *Elevator or ground-floor room*.
   - **Schools you'd like to visit**: district *San Diego Unified*, then tick **Lincoln High** and **Hoover High**.
   - **License type**: *Registered Nurse (RN)*. Enter a number, pick state *CA*, upload a small PDF, then **Save**.
   - ✅ Status *Applied*. Reloading the page shows every choice still selected.
3. **V2**: same steps, minimal profile.

## 4 · Admin decides (A) — the decision is final
1. **Approvals → Waiting**.
   - ✅ V1 and V2 are listed. Opening one shows the profile, *Schools they'd like* (Hoover High, Lincoln High), license details and the uploaded file.
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
1. **V1 → My sessions → Open sessions**.
   - ✅ The Lincoln and Hoover sessions come first, each with a **Your school** badge.
2. **V1** claims the Lincoln *Healthcare* session.
   - ✅ It moves to their booked list with school, room, class (*Period 2 · Health Science*) and 28 students.
   - ✅ Teacher shows **Ms. Rivera · Email · Call 619-555-0100**.
3. **V1**: request equipment (projector, markers…) and confirm availability.
4. **V1 → My teachers**.
   - ✅ Card for Ms. Rivera with Lincoln High and its address, plus **Call** and **Email** buttons and the session.
   - ✅ **Open** goes back to the session.
5. **T1 → Teacher desk**.
   - ✅ Booked volunteer shows with **Email** and **Call**.
   - ✅ Access needs text appears (*To help them on the day…*).
   - ✅ The notification T1 got says only that access needs exist, not what they are.
6. **T1**: tick the equipment as ready → **Class is ready** with a note.
   - ✅ V1's inbox gets the message.
   - ✅ The session shows *Class ready*.

## 5b · Teacher's My volunteers (T1, V1)
1. **T1 → My volunteers → Booked with you**.
   - ✅ V1's card shows date, class, Email/Call, access needs and *Prep 0/0*.
2. Add suggested items (*Visitor sign-in…*, *Parking pass…*) and one of your own (*Bring a stethoscope to demo*). Tick one.
   - ✅ The badge shows *Prep 1/3*.
   - ✅ **V1 → My sessions** shows *What the school is preparing*, with the ticked item.
3. **T1 → Approved volunteers**.
   - ✅ V1 is listed with *Picked your school*, profession and skills.
   - ✅ **No email, phone or access needs** are shown for anyone.
   - ✅ V2 (rejected) isn't listed.
4. As **T1** on the Teacher desk, post one more session about two weeks out. Then **My volunteers → Approved → Invite to a session**: pick it, add a message, keep *Include my email* ticked → **Send**.
   - ✅ V1's **Inbox** has *Ms. Rivera invited you…* with no email address in it.
   - ✅ **My sessions → Invitations** shows the card with **Claim**, **Decline** and **Reply by email**.
5. **V1 → Decline**.
   - ✅ T1's inbox says *can't make it*.
   - ✅ Inviting V1 to the same session again is refused.
6. Optional: invite again to another session and **Claim** it.
   - ✅ It moves to Upcoming, and T1 sees it under **Booked with you**.

## 6 · Change of date (T1 ↔ V1)
1. **T1 → Propose another date** with a reason.
   - ✅ V1 sees a yellow banner.
2. **V1 → Accept new date**.
   - ✅ The date changes on both sides.
3. Optional: V1 proposes, T1 declines.
   - ✅ The date stays the same.

## 7 · Admin assigns and staff (A, S)
1. **A → School** (choose Hoover) → **Assign volunteer**.
   - ✅ V1 is listed first with *prefers this school*. Book V1 onto a Hoover session.
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

## 7b · Sign-in links (signed out, then each account)
1. Open the landing page signed out.
   - ✅ Under the buttons: *Sign in as a volunteer, teacher or program staff*.
   - ✅ The footer has three sign-in links.
2. Click **teacher**.
   - ✅ Sign-in opens right away, with the note *Teachers: sign in with the school email…*.
3. Sign in as **T1** → ✅ lands on **My volunteers**.
4. Sign out, use **teacher**, sign in as **V1**.
   - ✅ *You're signed in as a volunteer. You don't have teacher access yet…*, with a **Go to My sessions** button.
   - ✅ Nav shows only the volunteer links.
5. Use **program staff** as **V1**.
   - ✅ *This account isn't program staff…*; no Approvals in the nav.
6. Use **program staff** as **A** → ✅ lands on **Approvals**.

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
| 2b |  |  |
| 3 |  |  |
| 4 |  |  |
| 5 |  |  |
| 5b |  |  |
| 6 |  |  |
| 7 |  |  |
| 7b |  |  |
| 8 |  |  |
