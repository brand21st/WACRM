import React from "react";

export default function WhyWhatsApp() {
  return (
    <section className="why-whatsapp-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Why WhatsApp?</h2>
          <p className="section-subtitle">
            WhatsApp is the One Platform that brings together Actionable Notifications &amp; Customer Support!
          </p>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">98%</div>
            <div className="stat-label">Open Rates</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">45-60%</div>
            <div className="stat-label">Click Rates</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">2.6 Bn+</div>
            <div className="stat-label">Active Users</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">7%</div>
            <div className="stat-label">Engagement Rate</div>
          </div>
        </div>
      </div>
    </section>
  );
}
