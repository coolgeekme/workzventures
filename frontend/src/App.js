import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import "@/App.css";

import { AuthProvider, useAuth } from "./lib/auth";
import { installMCP } from "./lib/mcp";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ResearchHub from "./pages/ResearchHub";
import Collateral from "./pages/Collateral";
import Outreach from "./pages/Outreach";
import Leads from "./pages/Leads";
import Newsletter from "./pages/Newsletter";
import MCPConsole from "./pages/MCPConsole";
import AgentMonitor from "./pages/AgentMonitor";
import Composio from "./pages/Composio";
import Audit from "./pages/Audit";

function Protected({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
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
      <Route path="/app/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/app/research" element={<Protected><ResearchHub /></Protected>} />
      <Route path="/app/collateral" element={<Protected><Collateral /></Protected>} />
      <Route path="/app/outreach" element={<Protected><Outreach /></Protected>} />
      <Route path="/app/leads" element={<Protected><Leads /></Protected>} />
      <Route path="/app/newsletter" element={<Protected><Newsletter /></Protected>} />
      <Route path="/app/mcp" element={<Protected><MCPConsole /></Protected>} />
      <Route path="/app/agents" element={<Protected><AgentMonitor /></Protected>} />
      <Route path="/app/composio" element={<Protected><Composio /></Protected>} />
      <Route path="/app/audit" element={<Protected><Audit /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              style: {
                background: "#121316",
                border: "1px solid #27282D",
                color: "#fff",
                borderRadius: 2,
                fontFamily: "'IBM Plex Sans', sans-serif",
              },
            }}
          />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}
