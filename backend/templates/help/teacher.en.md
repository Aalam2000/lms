<!-- autoi18n: source=teacher.md lang=en sha1=8696061a660612f331f0ba00f28e453fbe261f5d -->
# How to work on the platform

## My groups

On the [Main](/dashboard) — your groups: name, course, number of students, and contacts. Groups can be viewed as a **table** or **calendar** of lessons for all groups at once. There is also an **archive** of closed groups.

Click on a group to open it.

If you replaced another teacher or led the group before its transfer, there is a block **My lessons in other groups** below: in such a group, you only see your lessons. You can work on a lesson until midnight on the lesson day, after which it remains for viewing. For a lesson led by a teacher who is not the main teacher of the group, the teacher's name is shown in the list and calendar.

If students have submitted answers to homework assignments, the group is highlighted and marked **Homework: check** with the number of answers. A button **Check Homework** appears in the header — it opens the lesson with the oldest unchecked answer. The same applies to works submitted in the lesson: the label **Works: check** and the button **Check works** in the header — it opens the lesson journal with the oldest unchecked work. The marks update automatically, there is no need to refresh the page: a new answer is visible within 15 seconds, and after checking the last answer, the button disappears immediately.

## Group

At the top of the group page — icons, the name of each is visible on hover:

- **Group settings** (gear) — name, Telegram, WhatsApp, link to the video conference, and default lesson duration;
- **QR for registration** — link and QR code, through which students register in the group themselves;
- **Students** (little people with a number) — group composition and phones: enrol a student in the group through search, view their data and parent data, expel (with a reason) or return from the archive. The search shows only students who are not currently studying in any group; a student from another group is transferred by the administrator. A red dash in the "Phone" column means the phone is not filled in.

### New Students (registration via QR)

A student who registered via the group's QR code does not join immediately but with the status **"awaiting confirmation"**: they are not yet in the journal, lessons, and reports. The group receives a **New** label with the number of applications, and on the group page, there is a **New** button. It opens the students' window on the "New" tab:

- **Accept** — the student is immediately in the group; lessons up to this day are not counted as absences.
- **Decline** — the application is deleted. If the student is not in any other group, their account is also deleted, and the phone number is freed up.

Students that you enrol through search in the students' window do not wait for confirmation.

Protection against unnecessary accounts: the phone number is checked against the phone plans of countries — a number with a non-existent operator code, incorrect length, or made up of the same digits is not accepted. You can register no more than 30 times per hour with one QR code. Registration via the QR code of an archived group is not allowed.

### Group Lessons

Lessons are visible as a **table** or **calendar** — two icons on the left. The filter — from today, from the beginning of the week, from the beginning of the month, or all.

The group's schedule — lessons numbered 1, 2, 3… — is created by the administrator. The numbers are fixed to the lessons.

- **+ Lesson** — an extra lesson for the whole group or a personal one: date, time, duration, and, if needed, your own title. An extra lesson has no number. You can name it, for example, "Lesson 2" if it replaces or adds to the second lesson — the group's numbering does not change.
- **Schedule and materials** (calendar with a plus) — fill lessons with materials: from the course template or from another group, from lesson № to №. If the group has no schedule yet, the system will say so — it is created by the administrator.
- **Open lessons** (lock) — open several lessons for students by numbers at once.
- **Mark as holiday** — no lesson is held on this date: it and all subsequent lessons are shifted in the schedule.
- **Weekends** are highlighted in red in the calendar. You can schedule a lesson on your own weekend.

### Personal Lesson

An additional class for one or several students of the group. In the **+ Lesson** window, check the **Personal Lesson** box and select the students.

- This lesson is visible only to the selected students. It is not shown to others, and no absence is recorded.
- In the list of lessons and in the calendar, it is marked with the label 👤 with the names of the participants.
- Materials, homework, grades, and stars work like in a regular lesson.
- The composition of participants changes on the lesson page — click on the label 👤.
- A personal lesson closes absences: when it is finished and the student is marked as "Attended" or "Online," all absences of this student in regular lessons of the group up to that day are considered closed. A closed absence remains visible in the student's report with a note, but it no longer counts towards the number of absences or the attendance percentage.
- The **From Lesson** button on the page of such a lesson adds all materials from any past lesson of the group: files, links, and quizzes. Lessons that the student missed are highlighted in the list.
- The lesson is created as closed: open it on the lesson page. The buttons "Open Lessons," "Schedule and Materials," and "Mark as Holiday" do not affect personal lessons.

A lesson with unchecked answers on Homework is marked "Homework: check."

## Lesson

At the top of the lesson:

- **Open / Close** — access for students to the lesson. Closed lessons are not visible to students. The lesson opens automatically as soon as you mark the first attending student.
- 📅 — change of date, time, and duration of the lesson.
- Deleting the lesson.

The lesson has two tabs: **Lesson** and **Students**.

### Tab "Lesson" — materials

- **Add from the database** — select materials from the [Knowledge base](/dashboard/materials).
- **+ File**, **+ Link** — add your own file or link.
- **+ Quiz** — create a quiz directly for this lesson.
- **Unpin** — remove the material from the lesson (it is not deleted from the Knowledge base).

The material opens in a new tab when clicking on the title.

At the bottom of the lesson, there are two fields:

- **Comment on the lesson** — what was discussed, what to bring. Students see it on the lesson page.
- **Notes for yourself** — only you and the administrator see it. Students and parents do not see them.

### Tab "Students" — journal

For each student:

- **Attendance** — Came, Online or Valid reason; separately — Late. The **All came** button marks everyone at once.
- **Grade**, **Exam**, **Stars** (up to three).
- **Files from the lesson** — work that the student submitted during the lesson (see below).
- **Homework** and **Response** — the assigned task and the student's response.
- **Dialogue** — correspondence with the student regarding this lesson.

After midnight in Baku, attendance and grades for the lesson can no longer be changed (a valid reason can be marked for an absent student), the lesson cannot be rescheduled or deleted. Exam, stars, Homework, and dialogue can be changed. The grade for the lesson can be given to a student who submitted work during the lesson even after midnight — work is often checked the next day.

### Homework

- **+ Homework for everyone** — assign a task to the whole group: a file from your computer or from the Knowledge base, deadline.
- **+ Homework** in the student's row — a personal task for this student.
- **Check Homework** — the journal is rearranged for checking: open the student's response, assign a grade from 0 to 100, accept without a grade or return for revision. The "Previous / Next" buttons make it convenient to go through students in order.

**Checking with AI.** In the student's response panel, there is a button **Prompt for AI** — it copies the ready prompt: task, student's response, and grading rules. Paste it into any AI (ChatGPT, Claude, Gemini). Images and PDFs from the response do not get into the prompt as text — they are listed under the button: download them and attach to the request. The AI response (JSON) is inserted with the **Insert AI response** button → **Fill**: the grade will appear in the grade field, and the comment "Good / Bad" in the group's language will appear in the dialogue message field. Nothing is saved automatically: correct it, click **Save** on the grade and **Send** on the message. If the task is an HTML page, only its text goes into the prompt, without formatting; blocks that are not needed for checking (like how to take a screenshot, cheat sheet) can be marked in HTML with the class `no-ai` — they will not get into the prompt. The same applies to the work submitted during the lesson: the materials of the lesson and the comment on the lesson serve as the task for the AI, and the grade is treated as the grade for the lesson.

**AI Check for the Entire Group (in-class work).** The **AI Check** button in the lesson journal opens a window: select the lesson materials that were assigned and click **Download Package** — a ZIP file will be sent with the prompt, selected materials, and files of all students (only the name for each). Submit the AI archive, paste its response (JSON) into the window, and click **Fill**: each student will receive a grade and a comment "Good / Bad". Correct it and click **Accept** in the row or **Accept All** — the grade for the lesson will be recorded in the journal, and the comment will go to the dialogue. If the window is closed, unaccepted drafts will be saved while the lesson is open.

The deadline can be changed for everyone at once or for an individual student. There can be any number of files in the assignment — in the "+ Homework" window, you can select several at once; the only limitation is the file size (up to 50 MB).

In the checking window, there is **⬇ Download** — the student's file is saved to your computer.

### In-Class Work

Students submit files directly during the lesson — on their **In-Class Work** tab. They appear in your journal in the **Files from Lesson** column, automatically, without refreshing the page. Orange files are waiting for review; the number on the **Students** tab indicates how many students are waiting.

Click on the file — a checking window will open: file, **↗ in a new tab**, **⬇ Download**, dialogue with the student, and "Previous / Next". Checking:

- **Grade for the Lesson** — this is the same grade as in the "Grade" column: there is only one for the lesson. A grade entered directly in the "Grade" column is also considered a review.
- **✓** — accept without a grade.

After the review, the student can no longer add or delete files. The student can submit work while the lesson is open and until midnight on the day of the lesson. The work in class is checked by the person conducting the lesson.

## Quiz

**+ Quiz** in the lesson or **+ Create quiz** in the [Knowledge base](/dashboard/materials).

- **Flash** — question-answer; **Live** — real-time voting.
- Questions can be written by yourself or use the **Assistant**: it will gather a request for any AI on the topic and materials of the lesson, and the AI's answer will fill the quiz.
- The live quiz is conducted from the quiz page: students connect via the link, you click **Conduct** and lead the questions. If you mark **Exam**, the result will go as a grade in the lesson journal. Students get a **Join the quiz** button on their lesson page (they can also join by QR code or link).
- Only one quiz runs in a lesson: starting another one closes the previous one. **Close the quiz** ends the game, and the button disappears for students.

## Knowledge base

In the [Knowledge base](/dashboard/materials) — general files, links, and quizzes that can be added to lessons and assigned as Homework. Here you can upload your file, add a link, or create a quiz. The **My** filter shows only your materials.

At the top — a search bar: the material is found by name immediately as you type. Below it are filters: **Sector**, **Course**, **Lesson**, **Type**, **My** — the selected filter is removed with a cross. Results are grouped, they do not need to be created, the platform organizes them itself:

- **Lesson N** — the material is in lesson N of some group (in materials or as Homework); sector and course are taken from the group.
- **General** — the material is used only in additional lessons or it has a sector and course, but it is not yet in any lesson.
- **For everyone** — material without a sector and course that is not used anywhere.

On the right — a view of the selected material and where it is used (group, lesson, date). The sector and course of the material are changed by its owner or administrator — the link **Edit** is under the view. Arrows ↑ ↓ select the material, Enter opens it, Ctrl+K translates to search. Filters are saved in the profile.

In the lesson, the **Add from base** window is arranged the same way: it opens in the group's course, materials for this lesson are listed first, Enter or the **Add to lesson** button adds the selected one.

By default, the **Course** filter is set to "My courses" — the courses of your groups and materials "For everyone".

## Students

In the [Students](/dashboard/students) section — all your students: group, average grades for lessons, Homework and Exams, stars, absences, tardies, last login date, phone, parent and contacts. Click on the column title — the table will be sorted by it; clicking again changes the order.

The colored bar under the name — the debt for the last issued Homework: orange — the student has not submitted the answer yet or the Homework has been returned for revision, red — the deadline has passed. The bar disappears when the student has submitted the answer.

In the "Absences" column — only unresolved absences without a Valid reason. A red ring around the number of absences — the student missed the last group lesson and did not attend the personal lesson afterward. The ring appears the day after the lesson. It disappears when the personal lesson is completed and the student is marked as "Attended" or "Online," or when the student attends the next group lesson; an absence for a Valid reason does not give a ring.

New students are added by the administrator and the curator; the login is created automatically (first name, dot, three letters of the last name, and numbers — for example, `murad.ali47`), the password initially equals the login.

- **Student details** (pencil) — view the data; the administrator or the curator can change it. The card has the **Student access** block: platform address, login and password, **Copy** and **Send via WhatsApp** buttons; if the student has changed the password and forgotten it — **Reset to login**. The parent's link is there too.
- **Change Password** (key) — if the student has forgotten the password.

- **Additional Lesson** (calendar with a plus) — personal lesson for this student: date and time. If the student is not yet in the group (sent by the curator — in the "Group" column marked "without group"), select a group — the student will be enrolled in it.

Students referred to you by the curator are visible in this list immediately, even without a group. Homework assigned to the group before the student's arrival is not considered their debt; if they submit it — the grade will be counted.

The student's phone is mandatory and cannot be duplicated among two users. If the child does not have their own phone, enter the parent's phone number. The number can be entered as +994 50 123 45 67 or 050 123 45 67.

Students evaluate each lesson with an emoji (green, yellow, red). You cannot see who rated which emoji: this way, children respond honestly.

### Link for Parent

The parent can view the child's performance via a personal link or log into the platform using their login. Open the student's data (pencil): in the "Parent" section, there is a block with the link. Along with the link, a parent login is created: login — `p.` and the child's login, password initially equals the login. The **Copy** and **Send via WhatsApp** buttons immediately send the parent the link, address, login, and password. For links created earlier, click **Create Parent Login**.

- **Create Link for Parent** — the button appears when the parent's phone number is filled in and the card is saved.
- **Copy** — the link will go to the clipboard and can be pasted into any messenger.
- **Send via WhatsApp** — a chat will open with the parent on their phone with a ready message containing the link.
- **New Link** — the old one will immediately stop working. Click if the link was forwarded to the wrong person.

The link belongs to the parent's phone: if siblings have the same parent's phone number in their cards, all children can be seen through one link — each has their own tab. Below the link, it is written who the parent will see and when the link was last opened.

Through the link, the parent sees only the performance: grades for lessons, Homework, and Exams, Attendance, and absences. By clicking on the lesson, they see the Homework assignment, the student's answer, and the lesson dialogue. Nothing can be changed.

### Student Report

Click on the student's name — a report for parents will open. The period is selected at the top of the page: **Month** (with scrolling), **Since the Beginning of the Year** — from September 1, **Since the Beginning of Studies** — from the student's first lesson, **Period** — any two dates. The **Print** button outputs the report on paper. Comparison with the previous month is only available in the monthly report.

- **Summary in One Phrase** — how the period went and what to pay attention to.
- **Month (Period) in Numbers** — attended lessons, submitted Homework, stars, and average grade for lessons.
- **How Things Are Going** — six indicators with color: whether they attend lessons, arrive on time, how they work in class, whether they submit and how they perform Homework, how they take Exams.
- **Main Points for the Period** — what can be proud of and what to pay attention to.
- **Lessons for the Period** — for each lesson: attendance, grade, Homework, and stars.

Green color — everything is fine, yellow — slight deviation, red — parents' help is needed, gray — no data yet. Only lessons from your groups are included in the report. The report can also be opened from the lesson journal — by the student's name. If you are not the main teacher in the group, the report will only include the lessons you taught.

## Profile

In the [Profile](/dashboard/profile) you can change your password. You can also see your days off there — they are set by the administrator.
