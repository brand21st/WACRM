import React from "react";

export default function TickerBar() {
  const items = [
    "Free Green Tick Verification",
    "Free WhatsApp Business API",
    "Free Onboarding",
    "Zero Setup fee",
    "Free Website Widget",
    "Free QR & Link",
  ];

  return (
    <section className="ticker-section">
      <div className="ticker-track">
        {items.map((item, idx) => (
          <div className="ticker-item" key={`tick-1-${idx}`}>
            <span>{item}</span>
            <span className="ticker-dot"></span>
          </div>
        ))}

        {/* Duplicate for infinite loop */}
        {items.map((item, idx) => (
          <div className="ticker-item" key={`tick-2-${idx}`}>
            <span>{item}</span>
            <span className="ticker-dot"></span>
          </div>
        ))}
      </div>
    </section>
  );
}
