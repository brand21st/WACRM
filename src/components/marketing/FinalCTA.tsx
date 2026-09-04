import React from "react";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

export default function FinalCTA() {
  return (
    <section className="final-cta-section" style={{ padding: "90px 0", backgroundColor: "#ffffff" }}>
      <div className="wr">
        <div
          style={{
            background: "linear-gradient(135deg, #0f2e20 0%, #164e32 50%, #0a2419 100%)",
            borderRadius: "20px",
            padding: "60px 40px",
            textAlign: "center",
            color: "#ffffff",
            boxShadow: "0 20px 45px rgba(15, 46, 32, 0.25)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Subtle background glow */}
          <div
            style={{
              position: "absolute",
              top: "-50%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "500px",
              height: "500px",
              background: "radial-gradient(circle, rgba(3, 207, 101, 0.25) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#d8ffe6",
              backgroundColor: "rgba(216, 255, 230, 0.15)",
              border: "1px solid rgba(216, 255, 230, 0.25)",
              padding: "6px 16px",
              borderRadius: "9999px",
              marginBottom: "20px",
            }}
          >
            ⚡ Start Converting Today
          </span>

          <h2
            style={{
              fontSize: "38px",
              fontWeight: 700,
              color: "#ffffff",
              marginBottom: "12px",
              lineHeight: 1.25,
            }}
          >
            Stop Losing Sales in WhatsApp Conversations.
          </h2>

          <p
            style={{
              fontSize: "22px",
              fontWeight: 600,
              color: "#03cf65",
              marginBottom: "18px",
            }}
          >
            Let AI turn your conversations into conversions.
          </p>

          <p
            style={{
              fontSize: "16px",
              color: "#c2dfcf",
              maxWidth: "640px",
              margin: "0 auto 36px auto",
              lineHeight: 1.6,
            }}
          >
            VaChat brings <strong>Shopify + WhatsApp + AI</strong> together to create a smarter sales channel for your store.
          </p>

          <div>
            <a
              href={APP_SIGNUP}
              className="btn btn-primary btn-large"
              style={{
                fontSize: "18px",
                padding: "16px 36px",
                backgroundColor: "#03cf65",
                color: "#ffffff",
                boxShadow: "0 4px 20px rgba(3, 207, 101, 0.4)",
              }}
            >
              <span>Grow My Shopify Sales</span>
              <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg" style={{ width: "16px", height: "14px" }}>
                <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
