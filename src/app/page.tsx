import { KitchenBoard } from "@/components/KitchenBoard";
import { OrderProvider } from "@/components/OrderProvider";

export default function Home() {
  return <OrderProvider><KitchenBoard /></OrderProvider>;
}
