import { redirect } from "next/navigation";
import { AssistantApp } from "@/components/AssistantApp";
import { getDb } from "@/enterprise/simulator";
import { formatDate } from "@/lib/format";
import { getSession } from "@/platform/security/session";
import { workflowSummaries } from "@/workflows";

export default async function AssistantPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const customer = (await getDb()).customers.find((c) => c.id === session.customerId);
  if (!customer) redirect("/");

  const workflows = workflowSummaries(customer.firstName).filter((w) => w.id !== "card-servicing" || customer.cardIds.length > 0);
  return <AssistantApp customer={{ id: customer.id, name: customer.name, firstName: customer.firstName, city: customer.city, segment: customer.segment, customerSince: formatDate(customer.customerSince) }} workflows={workflows} />;
}
