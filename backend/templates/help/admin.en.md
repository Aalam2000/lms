<!-- autoi18n: source=admin.md lang=en sha1=23d1484ee680c85d37d31d621c33a605d220fda9 -->
# How to Work on the Platform

The administrator sees everything that the teacher sees — but for all groups and all teachers — and additionally manages users, courses, and groups.

## Groups

On the [Main](/dashboard) — all groups of the platform. Filter by teacher or **My** — only the groups where you are a teacher. Groups can be viewed as a **table** or **calendar** of lessons, and there is also an **archive**.

Click on a group — its page will open: settings, QR for student registration, composition, schedule, and lessons. Working with a group and lessons is the same as for the teacher: lessons, journal, homework, quizzes, dialogue with students.

### Group Schedule

Only the administrator creates a group's schedule. A group can be created without a schedule — to fill it with students — and the schedule added once it is clear.

The schedule opens with the **Schedule** button in the group's row (the "Groups" tab in the admin section) or with the **Schedule and materials** button on the group page.

- The group has no lessons yet — fill in the date and time of the first lesson (one time for all lessons), duration, weekdays, number of lessons and **Start from lesson №**: a group may start not from lesson 1 but, for example, from lesson 10. Lesson numbers are fixed to the lessons and do not change later. Materials from the course template or from another group are attached by the same numbers: lesson 10 gets the materials of lesson 10.
- The group already has lessons — **Delete and recreate** (personal lessons are not deleted), **Rooms by weekday** or, on the group page, **Leave dates — fill in with materials**.

The teacher does not create or delete the schedule: they fill lessons with materials, shift lessons for a holiday and add extra lessons — for the whole group or personal. An extra lesson has no number, even if the teacher named it "Lesson 2": it does not change the group's numbering.

### Lesson Teacher

A group has a main teacher, and each lesson has its own: usually the same, but for one or several lessons, another can be assigned. Click **Lesson Teacher** on the group page or in the group's row on the "Groups" tab of the admin section and select the teacher, from which lesson and to which.

- **Replacement** — select one or several lessons. The main teacher of the group does not change. The replacing teacher sees only these lessons and works in each until midnight of the lesson day, then the lesson remains for them to view.
- **Transfer of Group** — select the lesson from which the group is transferred, and "until the end." The teacher becomes the main one: receives the entire group and all its lessons, new lessons are created for them. The previous teacher sees only the lessons they taught and cannot change anything in them.
- **Who Taught Before** — if the group has already been transferred, assign the previous teacher to the lessons they taught.

Only the main teacher of the group can delete or move a lesson and change its participants. They also check homework, while the work submitted in the lesson is checked by the one who teaches the lesson. Work in the lesson, "Notes for Yourself" for the lesson, and downloading student files are the same as for the teacher (teacher's help, section "Lesson"). In reports and in the "Teachers" section, the lesson is credited to the one recorded as its teacher.

New students who registered via QR are waiting for confirmation from the group teacher or admin — how this works is described in the teacher's help ("New Students"). Students added by the admin do not wait for confirmation.

## Admin

In the [Admin](/dashboard/admin) section — tabs for Teachers, Admins, Curators, Courses, Groups, and Company.

### Teachers and Admins

User list: name, login, phone.

- **+ Add Teacher** / **+ Add Administrator** — new user with login and password; they can log in immediately.
- Click on the row — data can be changed.
- Deletion: the system will show what is associated with the user and ask for confirmation.

### Curators

The curator brings students and hands them over to teachers (how they work — curator's help). They see the calendars of all teachers and all students in "Students," can create a student and assign them an additional lesson.

- **+ Add Curator** — first name and last name, phone and contacts. The login is created automatically (first name, dot, three letters of the last name, and numbers), the password is the same as the login. A window with the login and password will open immediately, along with buttons **Copy** and **Send via WhatsApp**.
- The key in the curator's row opens the same window; if the curator has changed the password — **Reset to login**.
- Click on the row — data can be changed.

### Teacher's Days Off

The calendar icon in the teacher's row indicates their days off. Only the admin sets them; the teacher sees them in their profile.

- Mark the days of the week that are the teacher's days off every week. **+** adds another week — then the weeks alternate in a cycle (for example, a day off every other week). Week 1 is the one in which you saved the days off.
- **Calendar** — specific days: click on a day to make it a day off or, conversely, a working day (for example, cancel a permanent day off in one of the weeks).
- Days off are effective from the day of saving and onward; past days do not change.
- On a day off, lesson calendars are highlighted in red. Only the teacher can schedule a lesson on a day off (create, move, assign a teacher, fill in the schedule) — the admin will be denied by the system and shown the dates.

### Courses

Course title and description. **+ Add course**, edit by clicking on the row, delete.

### Groups

Name, course, sector, teacher, video conference, Telegram.

- **+ Add group** — new group with course and teacher.
- Click on the row — data can be edited. Changing the teacher in the row takes effect from today: past lessons remain with the one who taught them.
- **Group schedule** (calendar) — open the group page.
- **Schedule** — create the group's schedule, delete and create again, rooms by weekday (the "Group Schedule" section above).
- **Lesson Teacher** — replacement for lessons and transfer of the group (the "Lesson Teacher" section above).
- **Send to archive** — the group is no longer active; it can be **returned** or **deleted permanently** from the archive.

## Knowledge base

At the top — search bar: material is found by title immediately upon typing. Below it are filters: **Sector**, **Course**, **Lesson**, **Type**, **My** — the selected filter can be removed with a cross. Results are organized by groups, they do not need to be created, the platform organizes them itself:

- **Lesson N** — material is in lesson N of some group (in materials or as Homework); sector and course are taken from the group.
- **General** — material is used only in additional lessons or it has a sector and course, but it is not yet in any lesson.
- **For everyone** — material without a sector and course, which is not used anywhere.

On the right — view of the selected material and where it is used (group, lesson, date). The sector and course of the material can be changed by its owner or administrator — link **Edit** below the view. Arrows ↑ ↓ select material, Enter opens it, Ctrl+K leads to search. Filters are saved in the profile.

In the lesson, the **Add from base** window is arranged the same way: it opens on the course of the group, materials for this lesson are listed first, Enter or the **Add to lesson** button adds the selected one.

For the administrator additionally:

- **Upload course** — upload a folder with course materials as a lesson template: for each file, course, direction, and lesson number are specified.
- **Approve** / **Block** template material — under the material view; the entire course package at once — when sector and course are selected in the filters.
- Only the administrator can delete files and links; quiz — administrator or its author. Material that is used in lessons must first be unlinked.

## Students

In the [Students](/dashboard/students) section — all students of the platform: group, teacher, average grades for lessons, Homework and Exams, stars, absences, tardies, last login date, phone, parent and contacts. Filters by teacher, course, and group, **My** — only your groups. Click on the column title — the table will be sorted by it.

The colored bar under the name — debt for the last issued Homework: orange — the student has not submitted the answer yet or the Homework has been returned for revision, red — the deadline has passed. The bar disappears when the student has submitted the answer.

In the "Absences" column — only unclosed absences without a Valid reason. A red ring around the number of absences — the student missed the last lesson of the group and has not attended the personal lesson after it. The ring appears the day after the lesson. It disappears when the personal lesson is over and the student is marked as "Attended" or "Online," or when the student attends the next group lesson; an absence for a Valid reason does not give a ring.

A personal lesson closes absences: when it is over and the student is marked as "Attended" or "Online," all absences of this student in regular group lessons up to that day are considered closed. A closed absence remains visible in the student's report with a note, but is no longer included in the number of absences and in the attendance percentage.

### How to add a student

1. Click **+ Student**.
2. Fill in the first name and last name (first name first, then last name) and phone number. The login is created automatically — first name, dot, three letters of the last name, and numbers, for example `murad.ali47`; the password initially equals the login.
3. Enter the name and phone number of the parent.
4. Choose a group — or just a course (and optionally, a teacher): then the student will appear with this teacher "without a group," and the teacher will assign them to a group themselves. The checkbox **Immediately add a lesson** creates a personal lesson in the selected group. Click **Save**. The student will immediately appear in the group, their card will open: in the **Student Access** block — address, login, and password with **Copy** and **Send via WhatsApp** buttons. As long as the student has not changed the password, it is visible in the card; if they changed it and forgot — **Reset to login**.

### How to change student data

Click the student's row (not the name). In the window, you can change the name, phone, email, Telegram, WhatsApp, parent's name, and parent's phone. The login cannot be changed.

### Rules for phones

- The student's phone is mandatory. A red dash in the "Phone" column in the list means it is not filled; the system will ask such a student to provide a phone number upon login.
- The same phone cannot belong to two users. If the system responds that the phone already exists, it means the student is already registered — find them in the list.
- If the child does not have their own phone, enter the parent's phone in both fields: "Student's Phone" and "Parent's Phone."
- The parent's phone can be repeated: siblings share one.
- The number can be entered as +994 50 123 45 67 or 050 123 45 67; a number from another country should include the plus sign and country code.

### Link for the parent

The parent can view the child's performance via a personal link or log in with their own login. Open the student's data (click on the row); the teacher can only do this for students in their groups: in the "Parent" section, there is a block with the link. Along with the link, a parent login is created: the login is `p.` followed by the child's login, and the password initially equals the login; the buttons immediately provide the parent with the link, address, login, and password. For old links — **Create parent login**.

- **Create link for parent** — the button appears when the parent's phone is filled in and the card is saved.
- **Copy** — the link will go to the clipboard and can be pasted into any messenger.
- **Send via WhatsApp** — a chat will open with the parent at their phone number and a ready message with the link.
- **New link** — the old one will immediately stop working. Click if the link was forwarded to the wrong person.

The link belongs to the parent's phone: if siblings have the same parent's phone in their card, all children can be seen through one link — each has their own tab. Below the link, it is written who the parent will see and when the link was last opened.

Through the link, the parent sees only the performance: grades for lessons, Homework, and Exams, Attendance, and absences. By clicking on the lesson, they see the Homework assignment, the student's response, and the lesson dialogue. Nothing can be changed.

### Other Actions

- The student forgot the password — open their data (click on the row) and in the **Student access** block click **Reset to login**.
- **To archive** (icon on the right of the row) — expel the student with a reason: for example, did not pay or finished the course. If the student has several groups, choose which one to expel from, or **From all**. The whole study history is kept.
- An extra lesson is added on the group page: **+ Lesson** → **Personal lesson**.
- Transfer the student to another group — on the group page, the **Students** icon: enrol the student in the new group and send them to the archive from the old one. A student may also study in two groups at once.

### Student Archive

The archive icon at the top right opens the **Student archive** — students who have no group left: group, reason and date of expulsion. Click the name — the student report opens with all their studies (lessons up to the day of expulsion).

- **Return to the group** — the student is back in the group.

A student in the archive can log in and view the lessons of this group up to the day of expulsion — materials, their answers and the dialogue — but cannot submit or write anything.
- **Delete completely** (trash can) — only in the archive: the system will show what is associated with the student and, after confirmation, delete them together with the whole history — grades, attendance, homework and dialogues.

Students are added and their data changed by the administrator and the curator. The teacher sees the student card read-only but gives access: the student's login and password, the parent's link and login. The teacher and the curator enrol in a group only students who are not currently studying in any group; a student from another group is enrolled only by the administrator.

### Student Report

Click on the student's name — a report for parents will open. The period is selected at the top of the page: **Month** (with scrolling), **Since the Beginning of the Year** — from September 1, **Since the Start of Learning** — from the student's first lesson, **Period** — any two dates. The **Print** button outputs the report on paper. Comparison with the previous month is only available in the monthly report.

- **Summary in One Phrase** — how the period went and what to pay attention to.
- **Month (Period) in Numbers** — attended lessons, submitted homework, stars, and average grade for lessons.
- **How Things Are Going** — six indicators with color: whether the student attends lessons, arrives on time, how they perform in class, whether they submit and how they complete homework, how they take exams.
- **Main Points for the Period** — what can be proud of and what to pay attention to.
- **Lessons for the Period** — for each lesson: attendance, grade, homework, and stars.

Green color — everything is fine, yellow — slight deviation, red — parents' help is needed, gray — no data yet.

## Teachers

In the [Teachers](/dashboard/teachers) section — a summary for each teacher: how many groups and students, conducted lessons, attendance, and average grade. Groups and students are counted based on the groups where they are the main teacher; lessons, attendance, and grades are based on the lessons they taught themselves, including substitutions.

### Teacher Report

Click on the teacher to open the report. The period is selected at the top of the page: **Month** (with scrolling), **Since the beginning of the year** — from September 1, **Since the beginning of teaching** — from the teacher's first lesson, **Period** — any two dates. The **Print** button outputs the report on paper. Comparison with the previous month is only available in the monthly report.

- **Summary in one phrase** — how the period was worked and which indicators require attention.
- **How much was worked** — lessons conducted according to the schedule, personal lessons, hours, and canceled lessons. A lesson is considered conducted if at least one student attended.
- **How it was worked** — eight indicators with norms and colors: attendance, whether students remain, whether the journal is filled out on time, whether homework is assigned and checked quickly, whether exam results are improving, whether students use the platform, and how they rate the lessons with emojis.
- **By groups** — the same main figures for each group of the teacher.
- **What to pay attention to** — specific cases: ungraded work, students with three consecutive absences, students who have left and the reason, canceled lessons.

Green color — norm met, yellow — slight deviation, red — below norm, gray — no data yet.

Grades for lessons and stars are not included in the report: they are assigned by the teacher themselves, so they cannot be used to judge the quality of their work.

## Classrooms

In the [Classrooms](/dashboard/rooms) section — a directory of the academy's classrooms: **number** (only a number, not repeated) and **number of seats** for students. A classroom can be added, modified (pencil), and deleted. The directory is maintained by the administrator and curator.

## Attendance

In the [Attendance](/dashboard/activity) section:

- **Now in the system** — only those who are online right now, and since what time. Closed the tab — disappears at once; minimised it or lost the connection — within 1–2 minutes. Who logged in today — in the report below, period "Today".
- Report for the period (today, 7 or 30 days) for teachers, students, and administrators: how many days logged in, time in the system, last activity — in total or by days.

## Profile

In the [Profile](/dashboard/profile) you can change your password.
