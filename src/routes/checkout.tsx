import { createFileRoute, useSearch } from "@tanstack/react-router";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

type CheckoutSearch = { price?: string };

export const Route = createFileRoute("/checkout")({
  validateSearch: (s: Record<string, unknown>): CheckoutSearch => ({
    price: typeof s.price === "string" ? s.price : undefined,
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { price } = useSearch({ from: "/checkout" });
  const priceId = price || "pro_monthly";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#faf7f0" }}>
      <PaymentTestModeBanner />
      <div
        style={{
          maxWidth: 560,
          margin: "0 auto",
          padding: "32px 20px 60px 20px",
        }}
      >
        <h1
          style={{
            fontFamily: "Fraunces, serif",
            fontWeight: 400,
            fontSize: "1.75rem",
            letterSpacing: "-0.01em",
            color: "#0b1018",
            margin: "0 0 20px 0",
          }}
        >
          Start your Pluvik Pro trial
        </h1>
        <StripeEmbeddedCheckout priceId={priceId} />
      </div>
    </div>
  );
}