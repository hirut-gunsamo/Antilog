import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import AppShell from './components/AppShell'
import { LanguageProvider } from './components/LanguageProvider'
import { SettingsProvider } from './components/SettingsProvider'
import Dashboard from './pages/Dashboard'
import Approvals from './pages/Approvals'
import Branches from './pages/Branches'
import DamageLoss from './pages/DamageLoss'
import Inventory from './pages/Inventory'
import NationalId from './pages/NationalId'
import NationalIdOrders from './pages/NationalIdOrders'
import Products from './pages/Products'
import ProductTypes from './pages/ProductTypes'
import Categories from './pages/Categories'
import Ibid from './pages/Ibid'
import VoucherPrices from './pages/VoucherPrices'
import Telebirr from './pages/Telebirr'
import Transfers from './pages/Transfers'
import Expenses from './pages/Expenses'
import Payroll from './pages/Payroll'
import Commission from './pages/Commission'
import Receipts from './pages/Receipts'
import Reports from './pages/Reports'
import Requests from './pages/Requests'
import Sales from './pages/Sales'
import Equipment from './pages/Equipment'
import Holdings from './pages/Holdings'
import Settings from './pages/Settings'
import Sync from './pages/Sync'
import Users from './pages/Users'
import Login from './pages/Login'

function Protected() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100svh',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  )
}

function LoginRoute() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to="/dashboard" replace />

  return <Login />
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />

          <Route element={<Protected />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/users" element={<Users />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/products" element={<Products />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/product-types" element={<ProductTypes />} />
            <Route path="/ibid" element={<Ibid />} />
            <Route path="/voucher" element={<VoucherPrices />} />
            <Route path="/telebirr" element={<Telebirr />} />
            <Route path="/transfers" element={<Transfers />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/commission" element={<Commission />} />
            <Route path="/branches" element={<Branches />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/damage-loss" element={<DamageLoss />} />
            <Route path="/national-id" element={<NationalId />} />
            <Route path="/national-id/original" element={<NationalIdOrders key="ORIGINAL" kind="ORIGINAL" />} />
            <Route path="/national-id/copy" element={<NationalIdOrders key="COPY" kind="COPY" />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/holdings" element={<Holdings />} />
            <Route path="/equipment" element={<Equipment />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/requests/sales" element={<Requests key="SALES" scope="SALES" />} />
            <Route path="/requests/mine" element={<Requests key="MINE" scope="MINE" />} />
            <Route path="/reports" element={<Reports />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  )
}
