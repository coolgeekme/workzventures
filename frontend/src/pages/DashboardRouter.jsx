import { useAuth } from "../lib/auth";
import BuyerDashboard from "./BuyerDashboard";
import SellerDashboard from "./SellerDashboard";
import AdminDashboard from "./Dashboard"; // legacy global view, reused for admin

export default function DashboardRouter() {
  const { user } = useAuth();
  if (user?.role === "seller") return <SellerDashboard />;
  if (user?.role === "admin") return <AdminDashboard />;
  return <BuyerDashboard />;
}
