import React from "react";
import Image from "next/image";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

export default function FeaturesSection() {
  return (
    <section id="features" className="features-deep-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Packed with Powerful WhatsApp Marketing Features</h2>
          <p className="section-subtitle">
            Launch latest WhatsApp API and AI Features at Blazing fast speed⚡
          </p>
        </div>

        {/* Feature Row 1: Click to WhatsApp Ads */}
        <div id="click-to-chat" className="feature-row">
          <div className="feature-col-content">
            <h3 className="section-title" style={{ textAlign: "left", fontSize: "32px" }}>
              Run AI powered Ads that Click to WhatsApp
            </h3>
            <p className="section-subtitle" style={{ textAlign: "left", marginBottom: "20px" }}>
              Run Ads on Facebook &amp; Instagram that land on WhatsApp. 5X Your lead generations &amp; 2-3X Conversions Instantly!
            </p>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "15px", lineHeight: "1.6", marginBottom: "28px" }}>
              Run Ads seamlessly, get quality leads with AI &amp; conversions API, smartly segregate your leads and build Chatbot Flows to automate everything!
            </p>
            <div>
              <a
                href={APP_SIGNUP}
                className="btn btn-primary"
              >
                <span>Explore</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
            </div>
          </div>
          <div className="feature-row-visual">
            <Image
              src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/iamo9w4rxjqhx5pw.jpg?w=800&h=800&dpr=2"
              alt="Click to WhatsApp Ads Visual Mockup"
              width={520}
              height={520}
              style={{ width: "100%", height: "auto" }}
            />
          </div>
        </div>

        {/* Feature Row 2: WhatsApp Forms */}
        <div id="forms" className="feature-row reverse">
          <div className="feature-col-content">
            <h3 className="section-title" style={{ textAlign: "left", fontSize: "32px" }}>
              Build WhatsApp Forms
            </h3>
            <p className="section-subtitle" style={{ textAlign: "left", marginBottom: "20px" }}>
              Capture Leads &amp; collect useful information <strong>Directly in WhatsApp Chats</strong> with WhatsApp Forms.
            </p>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "15px", lineHeight: "1.6", marginBottom: "28px" }}>
              From feedback to gathering user insights, collect it all on WhatsApp.
            </p>
            <div>
              <a
                href={APP_SIGNUP}
                className="btn btn-primary"
              >
                <span>Explore</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
            </div>
          </div>
          <div className="feature-row-visual">
            <Image
              src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/9kysgifrjsd48evo.jpg?w=800&h=800&dpr=2"
              alt="WhatsApp Forms Feature Preview"
              width={520}
              height={520}
              style={{ width: "100%", height: "auto" }}
            />
          </div>
        </div>

        {/* Feature Row 3: Collect Payments */}
        <div id="payments" className="feature-row">
          <div className="feature-col-content">
            <h3 className="section-title" style={{ textAlign: "left", fontSize: "32px" }}>
              Collect Payments on WhatsApp
            </h3>
            <p className="section-subtitle" style={{ textAlign: "left", marginBottom: "28px" }}>
              Collect Payments now on WhatsApp seamlessly with WhatsApp Pay and other modes of payment (Razorpay, Payu etc) and grow your revenue.
            </p>
            <div>
              <a
                href={APP_SIGNUP}
                className="btn btn-primary"
              >
                <span>Explore</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
            </div>
          </div>
          <div className="feature-row-visual">
            <Image
              src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/wrgtce58qaaq14xq.jpg?w=800&h=800&dpr=2"
              alt="Collect Payments on WhatsApp Mockup"
              width={520}
              height={520}
              style={{ width: "100%", height: "auto" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
