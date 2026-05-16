import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (s: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      navigate({ to: "/", search: { upgraded: "true" } as any });
    }, 1800);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#faf7f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🌤️</div>
        <h1
          style={{
            fontFamily: "Fraunces, serif",
            fontWeight: 400,
            fontSize: "1.6rem",
            color: "#0b1018",
            margin: "0 0 8px 0",
          }}
        >
          Welcome to Pluvik Pro
        </h1>
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: "0.95rem",
            color: "rgba(11,16,24,0.55)",
            margin: 0,
          }}
        >
          Setting up your account…
        </p>
      </div>
    </div>
  );
}