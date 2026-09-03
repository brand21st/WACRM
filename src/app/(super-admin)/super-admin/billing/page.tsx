import { redirect } from "next/navigation";

export default function SuperAdminBillingRedirect() {
  redirect("/super-admin/packages");
}
