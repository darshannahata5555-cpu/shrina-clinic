import { LinkTabs } from "@/components/ui/page";

export function InventoryTabs({ active }: { active: "products" | "purchases" | "suppliers" | "transactions" | "reports" }) {
  return (
    <LinkTabs
      active={active}
      tabs={[
        { key: "products", label: "Products & stock", href: "/inventory" },
        { key: "purchases", label: "Purchases", href: "/inventory/purchases" },
        { key: "suppliers", label: "Suppliers", href: "/inventory/suppliers" },
        { key: "transactions", label: "Stock movements", href: "/inventory/transactions" },
        { key: "reports", label: "Reports", href: "/inventory/reports" },
      ]}
    />
  );
}
