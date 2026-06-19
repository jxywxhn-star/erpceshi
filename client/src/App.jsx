import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Login from './pages/login';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/dashboard';
import Orders from './pages/orders';
import Shops from './pages/shops';
import Users from './pages/users';
import Reports from './pages/reports';
import Profile from './pages/profile';
import Settings from './pages/settings';
import CollectorIssues from './pages/collector-issues';
import FactoryWorkbench from './pages/factory';
import Products from './pages/products';
import ShopOverview from './pages/shop-overview';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      setUser(JSON.parse(stored));
    }
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <MainLayout user={user} onLogout={handleLogout} />
            </PrivateRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<Orders />} />
          <Route path="shops" element={<Shops />} />
          <Route path="shop-overview" element={<ShopOverview />} />
          <Route path="users" element={<Users />} />
          <Route path="settings" element={<Settings />} />
          <Route path="collector-issues" element={<CollectorIssues />} />
          <Route path="reports" element={<Reports />} />
          <Route path="products" element={<Products />} />
          <Route path="factory" element={<FactoryWorkbench />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
