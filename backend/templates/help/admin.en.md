<!-- autoi18n: source=admin.md lang=en sha1=8744ef68287bd7ead40d897185ec810b8c886c36 -->
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

Only the main teacher of the group can delete or move a lesson and change its participants. They also check the homework, while the work submitted during the lesson is checked by the one who teaches the lesson. Work during the lesson, "Notes for Yourself" for the lesson, and downloading student files are the same as for the teacher (teacher's help, section "Lesson"). In reports and in the "Teachers" section, the lesson is credited to the one who is recorded as its teacher.

New students who registered via QR are waiting for confirmation from the group teacher or admin — how this works is described in the teacher's help ("New Students"). Students added by the admin do not wait for confirmation.

## Admin

In the [Admin](/dashboard/admin) section, there are four tabs.

### Teachers and Admins

User list: name, login, phone.

- **+ Add Teacher** / **+ Add Administrator** — new user with a login and password; they can log in immediately.
- Click on the row — data can be changed.
- Deletion: the system will show what is associated with the user and ask for confirmation.

### Teacher Days Off

The calendar icon in the teacher's row indicates their days off. Only the admin can set them; the teacher sees them in their profile.

- Mark the days of the week that are the teacher's days off every week. **+** adds another week — then the weeks alternate in a cycle (for example, a day off every other week). Week 1 is the one in which you saved the days off.
- **Calendar** — individual days: click on a day to make it a day off or, conversely, a working day (for example, cancel a permanent day off in one of the weeks).
- Days off are effective from the day of saving and onward; past days do not change.
- On a day off, lesson calendars are highlighted in red. Only the teacher can schedule a lesson on a day off (create, move, assign a teacher, fill the schedule) — the admin will be denied by the system and shown the dates.

### Courses

Course title and description. **+ Add Course**, edit by clicking on the row, delete.

### Groups

Name, course, sector, teacher, video conference, Telegram.

- **+ Add Group** — a new group with a course and teacher.
- Click on the row — data can be changed. Changing the teacher in the row takes effect from today: past lessons remain with the one who taught them.
- **Group Schedule** — open the group page.
- **Send to Archive** — the group is no longer active; it can be **returned** from the archive or **deleted permanently**.

## Knowledge base

In the [Knowledge base](/dashboard/materials), the administrator additionally has:

- **Upload course** — upload a folder with course materials as a lesson template: for each file, the course, direction, and lesson number are specified.
- Filters by course and sector and display of materials from lesson templates.
- **Approve** / **Block** template material — one at a time or the entire course package at once.
- Only the administrator can delete files and links; a quiz can be deleted by the administrator or its author. Material used in lessons must be unpinned first.

## Students

In the [Students](/dashboard/students) section — all students of the platform: group, teacher, average grades for lessons, Homework, and Exams, stars, absences, tardies, last login date, phone, parent, and contacts. Filters by teacher, course, and group, **My** — only your groups. Click on the column name — the table will be sorted by it.

The colored bar under the name — debt for the last issued Homework: orange — the student has not yet submitted the answer or the Homework has been returned for revision, red — the deadline has passed. The bar disappears when the student has submitted the answer.

In the "Absences" column — only unclosed absences without a valid reason. A red ring around the number of absences — the student missed the last group lesson and was not present at the personal lesson afterward. The ring appears the day after the lesson. It disappears when the personal lesson is over and the student is marked as "Attended" or "Online," or when the student attends the next group lesson; an absence for a valid reason does not give a ring.

A personal lesson closes absences: when it is over and the student is marked as "Attended" or "Online," all of that student's absences in regular group lessons up to that day are considered closed. A closed absence remains visible in the student's report with a note, but is no longer counted in the number of absences and in the attendance percentage.

### How to Add a Student

1. Click **+ Student**.
2. Fill in the first name and last name, phone number, username, and password. The username and password should be passed on to the student later.
3. Enter the parent's name and phone number.
4. Select a group and click **Save**. The student will immediately appear in the group and will be able to log in.

### How to Change Student Data

Click the **pencil** icon in the student's row. In the window, you can change the name, phone number, email, Telegram, WhatsApp, parent's name, and parent's phone number. The username cannot be changed.

### Phone Number Rules

- The student's phone number is mandatory. A red dash in the "Phone" column means it is not filled; the system will ask such a student to provide a phone number upon login.
- The same phone number cannot be used by two users. If the system responds that the phone number already exists, it means the student is already registered — find them in the list.
- If the child does not have their own phone, enter the parent's phone number in both fields: "Student's Phone" and "Parent's Phone."
- The parent's phone number can be repeated: siblings share one.
- The number can be entered as +994 50 123 45 67 or 050 123 45 67; a number from another country should include the plus sign and country code.

### Link for Parent

A parent can view their child's academic performance without a username and password — through a personal link. Open the student's data (pencil); a teacher can do this only for students in their groups: in the "Parent" section, there is a block with the link.

- **Create Link for Parent** — the button appears when the parent's phone number is filled in and the card is saved.
- **Copy** — the link will be copied to the clipboard and can be pasted into any messenger.
- **Send via WhatsApp** — a chat will open with the parent using their phone number and a prepared message with the link.
- **New Link** — the old one will immediately stop working. Click if the link was sent to the wrong person.

The link belongs to the parent's phone number: if siblings have the same parent's phone number in their cards, all children will be visible through one link — each will have their own tab. Below the link, it is written who the parent will see and when the link was last opened.

Through the link, the parent can only see academic performance: grades for lessons, Homework, and Exams, Attendance, and absences. By clicking on a lesson, they can see the Homework assignment, the student's response, and the lesson dialogue. Nothing can be changed.

### Other Actions

- **Change Password** (key) — if the student forgot the password. The new password will be displayed on the screen, and it needs to be communicated to the student.
- **Delete** (basket) — the system will show what is associated with the student and ask for confirmation.
- Transfer the student to another group or expel — on the group page, the **Students** icon.

### Student Report

Click on the student's name — a report for parents will open. The period is selected at the top of the page: **Month** (with scrolling), **Since the Beginning of the Year** — from September 1, **Since the Start of Learning** — from the student's first lesson, **Period** — any two dates. The **Print** button outputs the report on paper. Comparison with the previous month is only available in the monthly report.

- **Summary in One Phrase** — how the period went and what to pay attention to.
- **Month (Period) in Numbers** — attended lessons, submitted homework, stars, and average grade for lessons.
- **How Things Are Going** — six indicators with color: whether the student attends lessons, arrives on time, how they perform in class, whether they submit and how they complete homework, how they take exams.
- **Main Highlights for the Period** — what can be proud of and what to pay attention to.
- **Lessons for the Period** — for each lesson: attendance, grade, homework, and stars.

Green color — everything is fine, yellow — slight deviation, red — parents' help is needed, gray — no data yet.

## Teachers

In the [Teachers](/dashboard/teachers) section — a summary for each teacher: how many groups and students, conducted lessons, attendance, and average score. Groups and students are counted in groups where they are the main teacher; lessons, attendance, and score are based on the lessons they taught themselves, including replacements.

### Teacher Report

Click on the teacher to open the report. The period is selected at the top of the page: **Month** (with scrolling), **Since the beginning of the year** — from September 1, **Since the beginning of teaching** — from the teacher's first lesson, **Period** — any two dates. The **Print** button outputs the report on paper. Comparison with the previous month is only available in the monthly report.

- **Summary in one phrase** — how the period was worked and which indicators require attention.
- **How much was worked** — lessons conducted according to the schedule, personal lessons, hours, and canceled lessons. A lesson is considered conducted if at least one student attended.
- **How it was worked** — eight indicators with norms and colors: attendance, whether students remain, whether the journal is filled out on time, whether homework is assigned and checked quickly, whether exam results are improving, whether students are using the platform, and how they rate the lessons with emojis.
- **By groups** — the same key figures for each of the teacher's groups.
- **What to pay attention to** — specific cases: ungraded work, students with three consecutive absences, students who have left and the reason, canceled lessons.

Green color — norm met, yellow — slight deviation, red — below norm, gray — no data yet.

Grades for lessons and stars are not included in the report: they are assigned by the teacher themselves, so they cannot be used to judge the quality of their work.

## Attendance

In the [Attendance](/dashboard/activity) section:

- **Today in the system** — who logged in today; "now" — active in the last few minutes.
- Report for the period (today, 7 or 30 days) for teachers, students, and administrators: how many days logged in, time in the system, last activity — in total or by days.

## Profile

In the [Profile](/dashboard/profile) you can change your password.
