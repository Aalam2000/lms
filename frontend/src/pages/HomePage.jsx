import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getMyParentToken } from '../api/parent';
import GroupsPage from './GroupsPage';
import StudentHome from './StudentHome';
import CuratorHome from './CuratorHome';

// Родитель, вошедший по логину, — сразу на свою страницу /p/<токен>
// (та же, что по личной ссылке; backend/app/routers/parent.py).
function ParentRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    getMyParentToken().then(token => navigate(`/p/${token}`, { replace: true })).catch(() => {});
  }, [navigate]);
  return null;
}

function HomePage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'parent') return <ParentRedirect />;
  if (user.role === 'student') return <StudentHome />;
  if (user.role === 'curator') return <CuratorHome />;
  return <GroupsPage />;
}

export default HomePage;
