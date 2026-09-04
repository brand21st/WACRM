import React from "react";

const steps = [
  { step: "01", name: "WhatsApp", icon: "💬", desc: "Customer reaches out on WhatsApp" },
  { step: "02", name: "AI Conversation", icon: "🤖", desc: "AI engages & understands needs" },
  { step: "03", name: "Product Discovery", icon: "🛍️", desc: "Direct Shopify catalog search" },
  { step: "04", name: "Recommendation", icon: "✨", desc: "Smart personalized product match" },
  { step: "05", name: "Payment", icon: "💳", desc: "Zero-friction in-chat checkout" },
  { step: "06", name: "Shopify Sale", icon: "🚀", desc: "Order recorded & fulfilled in Shopify" },
];

export default function SalesJourneyBanner() {
  return (
    <section className="sales-journey-section" style={{ padding: "80px 0", backgroundColor: "#ffffff" }}>
      <div className="wr">
        <div className="section-header" style={{ textAlign: "center", marginBottom: "48px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--color-primary-dark, #009e46)",
              backgroundColor: "rgba(3, 207, 101, 0.1)",
              padding: "4px 14px",
              borderRadius: "9999px",
              marginBottom: "12px",
            }}
          >
            Seamless Conversion Funnel
          </span>
          <h2 className="section-title">More Conversations. More Conversions. More Shopify Sales.</h2>
          <p className="section-subtitle">
            VaChat works where your customers already are.
          </p>
        </div>

        {/* Journey Flow Steps */}
        <div
          className="journey-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: "16px",
            alignItems: "stretch",
          }}
        >
          {steps.map((item, idx) => (
            <div
              key={idx}
              className="journey-card"
              style={{
                backgroundColor: "var(--color-bg-subtle, #fbfbfb)",
                border: "1px solid var(--color-border-normal, #e5e5e5)",
                borderRadius: "12px",
                padding: "24px 16px",
                textAlign: "center",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                transition: "all 0.25s ease",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-primary, #03cf65)",
                  opacity: 0.8,
                }}
              >
                {item.step}
              </div>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(3, 207, 101, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "22px",
                  marginBottom: "14px",
                }}
              >
                {item.icon}
              </div>
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--color-text-title, #212529)",
                  marginBottom: "6px",
                }}
              >
                {item.name}
              </h3>
              <p
                style={{
                  fontSize: "13px",
                  color: "var(--color-text-secondary, #696969)",
                  lineHeight: 1.4,
                  margin: 0,
                }}
              >
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
