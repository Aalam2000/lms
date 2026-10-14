from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, JSON, Boolean, UniqueConstraint, Index
from sqlalchemy.sql import func
from .database import Base


# Все пользователи: admin | teacher | student
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    email = Column(String, nullable=True)
    role = Column(String, nullable=False, default="teacher")  # admin | teacher | student
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # кто создал пользователя
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    full_name = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    telegram_username = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)
    # Родитель ученика — заполняет педагог/админ; телефон родителя может повторяться (братья и сёстры)
    parent_name = Column(String, nullable=True)
    parent_phone = Column(String, nullable=True)
    photo_url = Column(String, nullable=True)  # путь к фото — этап 2
    theme = Column(String, nullable=True)  # brand | playful | dark — выбор пользователя, NULL = brand по умолчанию
    # Выходные педагога: недельные полоски по версиям и отдельные даты (app/days_off.py)
    days_off = Column(JSON, nullable=True)


# Курс / тема преподавания
class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Группа — поток учеников по курсу
class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    name = Column(String, nullable=False)
    telegram_chat_id = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)
    video_url = Column(String, nullable=True)  # постоянная ссылка на видеоконференцию (Meet и т.п.)
    # Длительность урока по умолчанию (мин) — подставляется в новые уроки, урок хранит копию
    lesson_duration_min = Column(Integer, nullable=False, default=120, server_default="120")
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String, nullable=False, default="active")  # active | archived
    invite_code = Column(String, unique=True, nullable=False)  # для регистрации студентов по QR
    sector = Column(String, nullable=True)  # ru | az — направление группы, независимо от тегов материалов
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Состав группы
class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (
        Index("ix_group_members_group_id", "group_id"),
        Index("ix_group_members_student_id", "student_id"),
    )
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # active | expelled | pending — сам зарегистрировался по QR и ждёт, когда педагог
    # примет (routers/groups.py); pending нигде не учитывается, как и expelled
    status = Column(String, nullable=False, default="active")
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    # Заполняются только при status="expelled" (отчислен из ЭТОЙ группы —
    # ученик может состоять в нескольких группах одновременно и быть
    # отчислен только из одной), очищаются при восстановлении обратно в
    # active — истории отчислений не храним, только последнее.
    expel_reason = Column(Text, nullable=True)
    expelled_at = Column(DateTime(timezone=True), nullable=True)
    expelled_by = Column(Integer, ForeignKey("users.id"), nullable=True)


# Урок — одна запись на группу, копируется для новых групп
class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (Index("ix_lessons_group_id_date", "group_id", "date"),)
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    title = Column(String, nullable=False)
    order = Column(Integer, nullable=False, default=0)  # порядок урока в группе
    date = Column(DateTime(timezone=True), nullable=True)  # дата проведения
    duration_min = Column(Integer, nullable=False, default=120, server_default="120")  # длительность, мин; конец = date + duration
    is_open = Column(Boolean, nullable=False, default=False)  # педагог открывает доступ
    source = Column(String, nullable=True)  # academy | teacher
    comment = Column(Text, nullable=True)  # заметки педагога по уроку в целом — видит и ученик
    private_note = Column(Text, nullable=True)  # «Заметки для себя» — только педагог и админ, ученику не отдаются
    # Персональный урок: виден и учитывается только у участников (lesson_students) — app/personal.py
    is_personal = Column(Boolean, nullable=False, default=False, server_default="false")
    # Кто ведёт урок: по умолчанию основной педагог группы, админ может назначить
    # другого (замена, передача группы). Правила и доступ — app/lesson_teacher.py
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Участники персонального урока (Lesson.is_personal). У обычного урока записей
# нет — его ученики = активные участники группы. Правила — app/personal.py.
class LessonStudent(Base):
    __tablename__ = "lesson_students"
    __table_args__ = (Index("ix_lesson_students_student_id", "student_id"),)
    lesson_id = Column(Integer, ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


# Оценка урока учеником — три смайлика: 3 зелёный (понравилось), 2 жёлтый
# (нормально), 1 красный (не понравилось). Одна запись на пару (урок, ученик).
# Педагогу отдельные оценки не показываются — только сводка в отчёте по
# педагогу у админа (app/teacher_report.py), иначе дети не будут честными.
class LessonFeedback(Base):
    __tablename__ = "lesson_feedback"
    __table_args__ = (Index("ix_lesson_feedback_student_id", "student_id"),)
    lesson_id = Column(Integer, ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    rating = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


# Посещаемость + оценка + звёзды за урок. Одна строка на пару (урок, студент).
class LessonMark(Base):
    __tablename__ = "lesson_marks"
    __table_args__ = (Index("ix_lesson_marks_student_id", "student_id"),)
    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    attendance_status = Column(String, nullable=True)  # in_person | online | excused | absent | NULL
    is_late = Column(Boolean, nullable=False, default=False)  # независим от attendance_status
    score = Column(Integer, nullable=True)  # 0..100
    exam_score = Column(Integer, nullable=True)  # 0..100 — из live-квиза с флажком "Экзамен", отдельно от ручной score
    stars = Column(Integer, nullable=True)  # 0..3
    comment = Column(Text, nullable=True)
    marked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    marked_at = Column(DateTime(timezone=True), nullable=True)
    # Проверка работы на уроке (LessonWorkFile): педагог принял или оценил
    # (оценка — та же score за урок). После проверки файлы ученика заморожены.
    work_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    work_reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Материалы («База знаний») — файлы в хранилище. Загружает teacher/admin,
# удаляет только admin (см. routers/materials.py). Хранится только
# метаданные — сам файл лежит в хранилище под object_key (app/storage.py).
class Material(Base):
    __tablename__ = "materials"
    id = Column(Integer, primary_key=True, index=True)
    object_key = Column(String, unique=True, nullable=False)
    original_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)  # каталог по темам — этап 2
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    sector = Column(String, nullable=True)  # ru | az — направление, для шаблонов курсов; ставит только admin
    template_lesson_no = Column(String, nullable=True)  # "5.2" и т.п. — номер урока в шаблоне; ставит только admin
    template_status = Column(String, nullable=True)  # draft | approved — статус шаблонного материала
    # Персональный файл ДЗ конкретному студенту (homework-tasks/ в хранилище) —
    # в «Базу знаний» не попадает, живёт только в своём уроке.
    is_personal = Column(Boolean, nullable=False, default=False)
    # sha256 содержимого — контроль повторной загрузки того же файла в БЗ
    content_hash = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Ссылки («База знаний») — третий тип библиотечного ресурса, наравне с
# Material и Quiz. Своего хранилища не требует — просто url + заголовок.
class Link(Base):
    __tablename__ = "links"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)  # каталог по темам — как у Material
    sector = Column(String, nullable=True)  # ru | az — направление, для шаблонов курсов; ставит только admin
    template_lesson_no = Column(String, nullable=True)  # "5.2" и т.п. — номер урока в шаблоне; ставит только admin
    template_status = Column(String, nullable=True)  # draft | approved — статус шаблонного материала
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Квизы — самостоятельная библиотечная единица (как Material и Link).
# Привязка к урокам — через LessonResource, много-ко-многим.
class Quiz(Base):
    __tablename__ = "quizzes"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    topic = Column(String, nullable=True)
    type = Column(String, nullable=False)  # flash | live | sprint
    template_type = Column(String, nullable=False, default="flash")
    html_content = Column(Text, nullable=False)
    html_translations = Column(JSON, default={})
    questions_data = Column(JSON, nullable=True)  # live/sprint — структурированные вопросы, не переводится
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)  # каталог по темам — как у Material
    sector = Column(String, nullable=True)  # ru | az — направление, для шаблонов курсов; ставит только admin
    template_lesson_no = Column(String, nullable=True)  # "5.2" и т.п. — номер урока в шаблоне; ставит только admin
    template_status = Column(String, nullable=True)  # draft | approved — статус шаблонного материала
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Привязка ресурса (файл/квиз/ссылка) к уроку — общая полиморфная
# таблица-связка вместо трёх отдельных. Один ресурс можно привязать к
# нескольким урокам одновременно; отвязка не удаляет сам ресурс.
# Целостность resource_id (что он реально существует в нужной таблице
# при привязке, и что привязки чистятся при удалении ресурса) —
# на уровне кода (routers/library.py, routers/lessons.py), а не FK,
# т.к. одна колонка не может ссылаться на три разные таблицы.
class LessonResource(Base):
    __tablename__ = "lesson_resources"
    __table_args__ = (
        UniqueConstraint(
            "lesson_id", "resource_type", "resource_id",
            name="uq_lesson_resources_lesson_type_resource",
        ),
    )
    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False, index=True)
    resource_type = Column(String, nullable=False)  # material | quiz | link
    resource_id = Column(Integer, nullable=False)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now())


# ===================== Домашние задания (схема v2, claude/homework-plan.md) =====================
# ДЗ живёт в таблице «Студенты» урока. Задание = файл (Material) в уроке:
# student_id NULL — «всем» (одна запись; видят все активные студенты группы,
# в т.ч. пришедшие позже), иначе — персонально одному студенту.
class HomeworkTask(Base):
    __tablename__ = "homework_tasks"
    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)  # NULL — всем
    deadline = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Ответ студента на всё ДЗ урока: одна запись на пару (урок, студент) —
# файлы ответа, ОДНА оценка за всё ДЗ (0–100) и отметка «принято».
# Оценка или «принято» = проверено, ответ заморожен; «вернуть на
# доработку» снимает и то и другое. Оценка за ДЗ — отдельный вид оценки
# (наряду с оценкой за урок и экзаменационной), своя средняя.
class HomeworkAnswer(Base):
    __tablename__ = "homework_answers"
    __table_args__ = (
        UniqueConstraint("lesson_id", "student_id", name="uq_homework_answers_lesson_student"),
    )
    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    grade = Column(Integer, nullable=True)
    accepted = Column(Boolean, nullable=False, default=False)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


# Файлы ответа студента (homework-answers/ в хранилище), в «Базу знаний» не попадают.
class HomeworkAnswerFile(Base):
    __tablename__ = "homework_answer_files"
    id = Column(Integer, primary_key=True, index=True)
    answer_id = Column(Integer, ForeignKey("homework_answers.id"), nullable=False, index=True)
    object_key = Column(String, nullable=False, unique=True)
    original_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())


# Работа на уроке: файлы, которые ученик сдаёт во время урока (lesson-work/ в
# хранилище), в «Базу знаний» не попадают. Оценка за них — оценка за урок
# (LessonMark.score), отметка проверки — LessonMark.work_reviewed_at.
# Правила — app/lesson_work.py и routers/lesson_work.py.
class LessonWorkFile(Base):
    __tablename__ = "lesson_work_files"
    __table_args__ = (Index("ix_lesson_work_files_lesson_student", "lesson_id", "student_id"),)
    id = Column(Integer, primary_key=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    object_key = Column(String, nullable=False, unique=True)
    original_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())


# Диалог педагог ↔ студент в строке студента урока (заменяет комментарий).
# Только добавление; править можно лишь своё последнее сообщение в диалоге
# и только пока на него не ответили.
class LessonMessage(Base):
    __tablename__ = "lesson_messages"
    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)  # чей это диалог
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    edited_at = Column(DateTime(timezone=True), nullable=True)


# Сессии присутствия в системе (claude/presence-plan.md): одна строка на
# непрерывный отрезок работы пользователя. Открытая вкладка раз в минуту
# шлёт «пульс» (POST /presence/ping) — продлевает last_seen_at; перерыв
# больше SESSION_GAP (app/routers/presence.py) начинает новую сессию. Храним только
# время — без IP, браузера и открытых страниц. Удаление пользователя удаляет
# и его сессии (ON DELETE CASCADE), срок хранения — RETENTION_DAYS.
class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("ix_user_sessions_user_last_seen", "user_id", "last_seen_at"),
        Index("ix_user_sessions_last_seen", "last_seen_at"),
        Index("ix_user_sessions_started", "started_at"),
    )
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), nullable=False)

# Нарушения Content-Security-Policy, присланные браузерами (POST /csp-report).
# Дедупликация: одна строка на «вид» нарушения — fingerprint из директивы,
# источника (только домен), страницы (путь, id заменены на :id) и места в
# коде (файл:строка). Повтор не создаёт строку, а делает count += 1 и
# обновляет last_seen. Нормализация — app/routers/csp.py.
class CspReport(Base):
    __tablename__ = "csp_reports"
    id = Column(Integer, primary_key=True)
    fingerprint = Column(String(64), nullable=False, unique=True)
    directive = Column(String, nullable=False)      # script-src-elem, font-src…
    blocked = Column(String, nullable=False)        # inline | eval | https://fonts.gstatic.com …
    page = Column(String, nullable=False)           # /login, /groups/:id …
    source = Column(String, nullable=False)         # /assets/index-*.js:12 | "" (если нет)
    disposition = Column(String, nullable=False)    # report | enforce
    sample = Column(Text, nullable=True)            # первые символы кода (если браузер прислал)
    user_agent = Column(String, nullable=True)      # пример браузера (последний)
    count = Column(Integer, nullable=False, default=1)
    first_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


# Данные академии — одна запись (вкладка «Академия» у админа, routers/academy.py)
class Academy(Base):
    __tablename__ = "academy"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    website = Column(String, nullable=True)
    telegram = Column(String, nullable=True)   # канал новостей
    whatsapp = Column(String, nullable=True)
    instagram = Column(String, nullable=True)
    address = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)


# Сектор — направление обучения (ru, az, …). Код хранится строкой у групп и
# у материалов шаблонов курсов и после создания не меняется.
class Sector(Base):
    __tablename__ = "sectors"
    id = Column(Integer, primary_key=True)
    code = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)          # «Русский сектор»
    lesson_word = Column(String, nullable=False)   # «Урок» на языке сектора — для названий уроков


# Личная ссылка родителя /p/<token> (routers/parent.py): принадлежит телефону
# родителя — по ней видны все дети с этим телефоном в карточке. Одна действующая
# ссылка на телефон; «Новая ссылка» отключает старую (revoked_at).
class ParentLink(Base):
    __tablename__ = "parent_links"
    id = Column(Integer, primary_key=True)
    parent_phone = Column(String, nullable=False, index=True)   # нормализован (app/phones.py)
    token = Column(String(8), nullable=False, unique=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
