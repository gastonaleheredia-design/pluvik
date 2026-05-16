const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as
  | string
  | undefined;

export function PaymentTestModeBanner() {
  if (!clientToken?.startsWith("pk_test_")) return null;
  return (
    <div
      style={{
        width: "100%",
        backgroundColor: "#fde9d6",
        borderBottom: "1px solid #f5b78a",
        padding: "8px 16px",
        textAlign: "center",
        fontFamily: "Inter, sans-serif",
        fontSize: "0.8rem",
        color: "#7a3a0c",
      }}
    >
      All payments here are in test mode.{" "}
      <a
        href="https://docs.lovable.dev/features/payments#test-and-live-environments"
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "underline", color: "#7a3a0c", fontWeight: 600 }}
      >
        Learn more
      </a>
    </div>
  );
}