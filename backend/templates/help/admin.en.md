<!-- autoi18n: source=admin.md lang=en sha1=79cf6c455b7451a26d3d5779688f23f0b22960b1 -->
# How to Work on the Platform

The administrator sees everything that the teacher sees — but for all groups and all teachers — and additionally manages users, courses, and groups.

## Groups

On the [Main](/dashboard) — all groups of the platform. Filter by teacher or **My** — only the groups where you are a teacher. Groups can be viewed as a **table** or **calendar** of lessons, and there is also an **archive**.

Click on a group — its page will open: settings, QR for student registration, composition, schedule, and lessons. Working with a group and lessons is the same as for the teacher: lessons, journal, homework, quizzes, dialogue with students.

### Lesson Teacher

A group has a main teacher, and each lesson has its own: usually the same, but for one or several lessons, another can be assigned. On the group page, click **Lesson Teacher** and select the teacher, from which lesson and to which.

- **Replacement** — select one or several lessons. The main teacher of the group does not change. The replacing teacher sees only these lessons and works in each until midnight of the lesson day, then the lesson remains for them to view.
- **Transfer of Group** — select the lesson from which the group is transferred, and "until the end." The teacher becomes the main one: receives the entire group and all its lessons, new lessons are created for them. The previous teacher sees only the lessons they taught and cannot change anything in them.
- **Who Taught Before** — if the group has already been transferred, assign the previous teacher to the lessons they taught.

Only the main teacher of the group can delete or move a lesson and change its participants. They also check homework, while the work submitted during the lesson is checked by the one who teaches the lesson. Work during the lesson, "Notes for Yourself" for the lesson, and downloading student files are the same as for the teacher (teacher's help, section "Lesson"). In reports and in the "Teachers" section, the lesson is credited to the one recorded as its teacher.

New students who registered via QR are waiting for confirmation from the group teacher or admin — how this works is described in the teacher's help ("New Students"). Students added by the admin do not wait for confirmation.

## Admin

In the [Admin](/dashboard/admin) section — tabs for Teachers, Admins, Curators, Courses, Groups, and Company.

### Teachers and Admins

User list: name, login, phone.

- **+ Add Teacher** / **+ Add Administrator** — new user with a login and password; they can log in immediately.
- Click on the row — data can be changed.
- Deletion: the system will show what is associated with the user and ask for confirmation.

### Curators

The curator brings students and hands them over to teachers (how they work — curator's help). They see the calendars of all teachers and all students in "Students," can create a student and assign them an additional lesson.

- **+ Add Curator** — first name and last name, phone and contacts. The login is created automatically (first name, dot, three letters of the last name, and numbers), the password is the same as the login. A window with the login and password will open immediately, along with the **Copy** and **Send via WhatsApp** buttons.
- The key in the curator's row opens the same window; if the curator has changed the password — **Reset to Login**.
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
- **Group schedule** — open the group page.
- **Send to archive** — the group is no longer active; it can be **returned** or **deleted permanently** from the archive.

## Knowledge base

In the [Knowledge base](/dashboard/materials), the administrator additionally has:

- **Upload course** — upload a folder with course materials as a lesson template: for each file, specify the course, direction, and lesson number.
- Filters by course and sector and display of materials from lesson templates.
- **Approve** / **Block** template material — one by one or the entire course package at once.
- Only the administrator can delete files and links; quiz — administrator or its author. Material used in lessons must be unpinned first.

## Students

In the [Students](/dashboard/students) section — all students of the platform: group, teacher, average grades for lessons, Homework and exams, stars, absences, tardies, last login date, phone, parent and contacts. Filters by teacher, course, and group, **My** — only your groups. Click on the column name — the table will be sorted by it.

The colored bar under the name — debt for the last issued Homework: orange — the student has not yet submitted the answer or the Homework has been returned for revision, red — the deadline has passed. The bar disappears when the student submits the answer.

In the "Absences" column — only unclosed absences without a valid reason. A red ring around the number of absences — the student missed the last lesson of the group and was not present at the personal lesson afterward. The ring appears the day after the lesson. It disappears when the personal lesson is over and the student is marked as "Attended" or "Online," or when the student attends the next group lesson; an absence for a valid reason does not give a ring.

A personal lesson closes absences: when it is over and the student is marked as "Attended" or "Online," all absences of this student in regular group lessons up to that day are considered closed. A closed absence remains visible in the student's report with a note, but is no longer counted in the number of absences and in the attendance percentage.

### How to add a student

1. Click **+ Student**.
2. Fill in the first name and last name (first name, then last name) and phone number. The login is created automatically — first name, dot, three letters of the last name, and numbers, for example `murad.ali47`; the password is initially the same as the login.
3. Enter the parent's name and phone number.
4. Select a group — or just a course (and, optionally, a teacher): then the student will appear with this teacher "without a group," and the teacher will assign them to a group themselves. The checkbox **Immediately add lesson** creates a personal lesson in the selected group. Click **Save**. The student will immediately appear in the group, and their card will open: in the **Student Access** block — address, login, and password with **Copy** and **Send to WhatsApp** buttons. As long as the student hasn't changed their password, it is visible in the card; if they changed it and forgot — **Reset to login**.

### How to change student data

Click the **pencil** icon in the student's row. In the window, you can change the name, phone number, email, Telegram, WhatsApp, parent's name, and phone number. The login cannot be changed.

### Rules for phones

- The student's phone number is mandatory. A red dash in the "Phone" column means it is not filled in; the system will ask to provide a phone number upon login for such a student.
- The same phone number cannot be used by two users. If the system responds that the phone number already exists, it means the student is already registered — find them in the list.
- If the child does not have their own phone, enter the parent's phone number in both fields: "Student's Phone" and "Parent's Phone."
- The parent's phone number can be repeated: siblings share one.
- The number can be entered as +994 50 123 45 67 or 050 123 45 67; a number from another country — with a plus and country code.

### Link for Parent

The parent can view the child's performance via a personal link or log in with their own credentials. Open the student's data (pencil); the teacher can only do this for students in their groups: in the "Parent" section, there is a block with the link. Along with the link, a parent login is created: username — `p.` and the child's username, the password initially equals the username; the buttons immediately provide the parent with the link, address, username, and password. For old links — **Create Parent Login**.

- **Create Link for Parent** — the button appears when the parent's phone number is filled in and the card is saved.
- **Copy** — the link will be copied to the clipboard and can be pasted into any messenger.
- **Send via WhatsApp** — a chat will open with the parent using their phone number and a prepared message with the link.
- **New Link** — the old one will immediately stop working. Click if the link was forwarded to the wrong person.

The link belongs to the parent's phone: if siblings have the same parent's phone number in their cards, all children can be seen through one link — each has their own tab. Below the link, it is written who the parent will see and when the link was last opened.

Through the link, the parent sees only the performance: grades for lessons, Homework, and Exams, Attendance, and absences. By clicking on the lesson, they see the Homework assignment, the student's response, and the lesson dialogue. Nothing can be changed.

### Other Actions

- **Change Password** (key) — if the student forgot their password. The new password will be displayed on the screen, and it needs to be communicated to the student.
- **Delete** (trash can) — the system will show what is associated with the student and ask for confirmation.
- Transfer the student to another group or expel — on the group page, the **Students** icon.

### Student Report

Click on the student's name to open the report for parents. The period is selected at the top of the page: **Month** (with scrolling), **Since the beginning of the year** — from September 1, **Since the beginning of learning** — from the student's first lesson, **Period** — any two dates. The **Print** button outputs the report on paper. Comparison with the previous month is only available in the monthly report.

- **Summary in one phrase** — how the period went and what to pay attention to.
- **Month (period) in numbers** — attended lessons, submitted homework, stars, and average grade for lessons.
- **How things are going** — six indicators with color: attendance in lessons, punctuality, performance during lessons, submission and quality of homework, exam results.
- **Main points for the period** — what can be proud of and what to pay attention to.
- **Lessons for the period** — for each lesson: attendance, grade, homework, and stars.

Green color — everything is fine, yellow — slight deviation, red — parents' help is needed, gray — no data yet.

## Teachers

In the [Teachers](/dashboard/teachers) section — a summary for each teacher: how many groups and students, conducted lessons, attendance, and average score. Groups and students are counted based on the groups where they are the main teacher; lessons, attendance, and scores are based on the lessons they conducted themselves, including substitutes.

### Teacher Report

Click on the teacher to open the report. The period is selected at the top of the page: **Month** (with scrolling), **Since the beginning of the year** — from September 1, **Since the beginning of teaching** — from the teacher's first lesson, **Period** — any two dates. The **Print** button outputs the report on paper. Comparison with the previous month is only available in the monthly report.

- **Summary in one phrase** — how the period was worked and which indicators require attention.
- **How much was worked** — conducted lessons according to the schedule, personal lessons, hours, and canceled lessons. A conducted lesson is considered an open lesson with at least one student present.
- **How it was worked** — eight indicators with norms and colors: attendance, student retention, timely journal filling, assignment of homework and speed of checking, growth in exam results, student usage of the platform, and how they rate lessons with emojis.
- **By groups** — the same key figures for each group of the teacher.
- **What to pay attention to** — specific cases: ungraded work, students with three consecutive absences, students who left and the reason, canceled lessons.

Green color — norm met, yellow — slight deviation, red — below norm, gray — no data yet.

Grades for lessons and stars are not included in the report: they are assigned by the teacher themselves, so they cannot be used to judge the quality of their work.

## Rooms

In the [Rooms](/dashboard/rooms) section — a directory of the academy's rooms: **number** (only a number, not repeated) and **number of seats** for students. A room can be added, modified (pencil), and deleted. The directory is maintained by the administrator and curator.

## Attendance

In the [Attendance](/dashboard/activity) section:

- **Today in the system** — who logged in today; "currently" — active in the last minutes.
- Report for the period (today, 7 or 30 days) for teachers, students, and administrators: how many days logged in, time in the system, last activity — in total or by days.

## Profile

In the [Profile](/dashboard/profile) you can change your password.
