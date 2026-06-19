import { Routes, Route, Navigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import useResponsive from './hooks/useResponsive'
import DesktopLayout from './layouts/DesktopLayout'
import MobileLayout from './layouts/MobileLayout'
import LoginPage from './pages/login'
import DashboardPage from './pages/dashboard'
import OrdersPage from './pages/orders'
import ShopsPage from './pages/shops'
import UsersPage from './pages/users'
import ExpensesPage from './pages/expenses'
import ReportsPage from './pages/reports'
import MobileProfile from './pages/profile'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useSelector((state: any) => state.auth.token)
  if (!token) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function App() {
  const { isMobile } = useResponsive()
  const Layout = isMobile ? MobileLayout : DesktopLayout

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="shops" element={<ShopsPage />} />
        <Route path="users" element={<UsersPage />} />
        {isMobile && <Route path="profile" element={<MobileProfile />} />}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
