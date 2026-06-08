import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import "@/App.css";

import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider, useTheme } from "./lib/theme";
import { installMCP } from "./lib/mcp";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import DashboardRouter from "./pages/DashboardRouter";
import ResearchHub from "./pages/ResearchHub";
import Collateral from "./pages/Collateral";
import Outreach from "./pages/Outreach";
import Leads from "./pages/Leads";
import Newsletter from "./pages/Newsletter";
import MCPConsole from "./pages/MCPConsole";
import AgentMonitor from "./pages/AgentMonitor";
import Composio from "./pages/Composio";
import Audit from "./pages/Audit";
import Marketplace from "./pages/Marketplace";
import MyListings from "./pages/MyListings";
import Inquiries from "./pages/Inquiries";
import DealRooms from "./pages/DealRooms";
import DealRoomDetail from "./pages/DealRoomDetail";
import Security from "./pages/Security";
import BuyerDiscovery from "./pages/BuyerDiscovery";
import BuyerAlerts from "./pages/BuyerAlerts";
import ConnectableApps from "./pages/ConnectableApps";
import DetailedReport from "./pages/DetailedReport";
import PrivateLocker from "./pages/PrivateLocker";

function Protected({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Layout>{children}</Layout>;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.role !== "admin") return <Navigate to="/app/dashboard" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  useEffect(() => { installMCP(); }, []);
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
      <Route path="/app/dashboard" element={<Protected><DashboardRouter /></Protected>} />
      <Route path="/app/research" element={<Protected><ResearchHub /></Protected>} />
      <Route path="/app/marketplace" element={<Protected><Marketplace /></Protected>} />
      <Route path="/app/listings" element={<Protected><MyListings /></Protected>} />
      <Route path="/app/inquiries" element={<Protected><Inquiries /></Protected>} />
      <Route path="/app/rooms" element={<Protected><DealRooms /></Protected>} />
      <Route path="/app/rooms/:id" element={<Protected><DealRoomDetail /></Protected>} />
      <Route path="/app/collateral" element={<Protected><Collateral /></Protected>} />
      <Route path="/app/outreach" element={<Protected><Outreach /></Protected>} />
      <Route path="/app/leads" element={<Protected><Leads /></Protected>} />
      <Route path="/app/newsletter" element={<Protected><Newsletter /></Protected>} />
      <Route path="/app/mcp" element={<AdminOnly><MCPConsole /></AdminOnly>} />
      <Route path="/app/agents" element={<Protected><AgentMonitor /></Protected>} />
      <Route path="/app/composio" element={<Protected><Composio /></Protected>} />
      <Route path="/app/security" element={<Protected><Security /></Protected>} />
      <Route path="/app/buyers" element={<Protected><BuyerDiscovery /></Protected>} />
      <Route path="/app/buyer-alerts" element={<Protected><BuyerAlerts /></Protected>} />
      <Route path="/app/research/detailed/:rid" element={<Protected><DetailedReport /></Protected>} />
      <Route path="/app/private-locker" element={<Protected><PrivateLocker /></Protected>} />
      <Route path="/apps" element={<ConnectableApps />} />
      <Route path="/app/audit" element={<AdminOnly><Audit /></AdminOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
            <ThemedToaster />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </div>
  );
}

function ThemedToaster() {
  const { resolved } = useTheme();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <Toaster
      theme={resolved}
      position={isMobile ? "top-center" : "top-right"}
      offset={isMobile ? 72 : 16}
      toastOptions={{
        style: {
          background: "var(--wz-surface)",
          border: "1px solid var(--wz-border)",
          color: "var(--wz-text)",
          borderRadius: 2,
          fontFamily: "'IBM Plex Sans', sans-serif",
        },
        duration: 3000,
      }}
    />
  );
}
