import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AddQuizPage from './pages/AddQuizPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import AdminPage from './pages/AdminPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import ProfilePage from './pages/ProfilePage';
import HomePage from './pages/HomePage';
import LessonPage from './pages/LessonPage';
import StudentLessonPage from './pages/StudentLessonPage';
import StudentPerformancePage from './pages/StudentPerformancePage';
import GroupPage from './pages/GroupPage';
import StudentsPage from './pages/StudentsPage';
import TeachersDirectoryPage from './pages/TeachersDirectoryPage';
import TeacherReportPage from './pages/TeacherReportPage';
import StudentReportPage from './pages/StudentReportPage';
import ActivityPage from './pages/ActivityPage';
import RoomsPage from './pages/RoomsPage';
import JoinGroupPage from './pages/JoinGroupPage';
import ParentPage from './pages/ParentPage';
import QuizLiveHostPage from './pages/QuizLiveHostPage';
import QuizLiveJoinPage from './pages/QuizLiveJoinPage';
import NotFoundPage from './pages/NotFoundPage';
import HelpPage from './pages/HelpPage';
import MethodologyPage from './pages/MethodologyPage';
// Просмотр слайдов тянет pdf.js (~1 МБ) — грузим отдельным чанком, только когда он открыт
const SlideViewerPage = lazy(() => import('./pages/SlideViewerPage'));
import RoleRoute from './components/RoleRoute';
import TooltipLayer from './components/Tooltip';
import PhoneGate from './components/PhoneGate';
import { useAcademyName } from './utils/academyName';

function PrivateRoute({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" />;
}

function App() {
  useAcademyName(); // название академии из настроек — в заголовок вкладки браузера
  return (
    <AuthProvider>
      {/* Единая мгновенная подсказка для всех элементов с data-tip */}
      <TooltipLayer />
      <PhoneGate />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/join/:inviteCode" element={<JoinGroupPage />} />
        {/* Родитель — по личной ссылке, без входа (routers/parent.py) */}
        <Route path="/p/:token" element={<ParentPage />} />
        <Route path="/quiz-live/:code" element={<QuizLiveJoinPage />} />
        <Route path="/quiz-live/:code/host" element={
          <PrivateRoute>
            <RoleRoute roles={['teacher', 'admin']}><QuizLiveHostPage /></RoleRoute>
          </PrivateRoute>
        } />
        <Route path="/slides/:materialId" element={
          <PrivateRoute><Suspense fallback={null}><SlideViewerPage /></Suspense></PrivateRoute>
        } />
        <Route path="/dashboard" element={
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        }>
          <Route index element={<HomePage />} />
          <Route path="add-quiz" element={
            <RoleRoute roles={['teacher', 'admin']}><AddQuizPage /></RoleRoute>
          } />
          <Route path="add-quiz/:id" element={
            <RoleRoute roles={['teacher', 'admin']}><AddQuizPage /></RoleRoute>
          } />
          <Route path="materials" element={
            <RoleRoute roles={['teacher', 'admin']}><KnowledgeBasePage /></RoleRoute>
          } />
          <Route path="students" element={
            <RoleRoute perm="students.view"><StudentsPage /></RoleRoute>
          } />
          <Route path="students/:studentId/report" element={
            <RoleRoute perm="students.view"><StudentReportPage /></RoleRoute>
          } />
          <Route path="teachers" element={
            <RoleRoute roles={['admin']}><TeachersDirectoryPage /></RoleRoute>
          } />
          <Route path="teachers/:teacherId/report" element={
            <RoleRoute roles={['admin']}><TeacherReportPage /></RoleRoute>
          } />
          <Route path="rooms" element={
            <RoleRoute perm="rooms.edit"><RoomsPage /></RoleRoute>
          } />
          <Route path="activity" element={
            <RoleRoute roles={['admin']}><ActivityPage /></RoleRoute>
          } />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="methodology" element={
            <RoleRoute roles={['teacher', 'admin']}><MethodologyPage /></RoleRoute>
          } />
          <Route path="methodology/:section/:slug" element={
            <RoleRoute roles={['teacher', 'admin']}><MethodologyPage /></RoleRoute>
          } />
          <Route path="admin" element={
            <RoleRoute roles={['admin']}><AdminPage /></RoleRoute>
          } />
          <Route path="lessons/:lessonId" element={
            <RoleRoute roles={['teacher', 'admin']}><LessonPage /></RoleRoute>
          } />
          <Route path="student-lessons/:lessonId" element={
            <RoleRoute roles={['student']}><StudentLessonPage /></RoleRoute>
          } />
          <Route path="performance" element={
            <RoleRoute roles={['student']}><StudentPerformancePage /></RoleRoute>
          } />
          <Route path="groups/:groupId" element={
            <RoleRoute roles={['teacher', 'admin']}><GroupPage /></RoleRoute>
          } />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;