import React from "react";
import Image from "next/image";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

const growthFeatures = [
  "AI-powered customer support",
  "AI WhatsApp calling",
  "Shopify product integration",
  "Smart product recommendations",
  "WhatsApp call recording",
  "WhatsApp payments",
  "24/7 automated sales assistance",
  "Designed to increase Shopify conversions",
];

export default function SalesAssistantSection() {
  return (
    <section id="assistant" className="broadcast-section" style={{ padding: "90px 0", backgroundColor: "var(--color-bg-subtle, #fbfbfb)" }}>
      <div className="wr">
        <div className="feature-two-col">
          <div className="feature-col-content">
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
                width: "fit-content",
                marginBottom: "14px",
              }}
            >
              🚀 Revenue-Driven AI
            </span>
            <h2 className="section-title" style={{ textAlign: "left", marginBottom: "14px" }}>
              Your AI Sales Assistant on WhatsApp
            </h2>
            <p
              style={{
                fontSize: "20px",
                fontWeight: 600,
                color: "var(--color-primary-dark, #009e46)",
                marginBottom: "12px",
                lineHeight: 1.4,
              }}
            >
              VaChat doesn&apos;t just answer customer messages. <span style={{ color: "#000000" }}>It helps you sell.</span>
            </p>
            <p
              style={{
                fontSize: "16px",
                color: "var(--color-text-secondary, #696969)",
                lineHeight: 1.6,
                marginBottom: "28px",
              }}
            >
              From answering product questions to recommending products and assisting customers through checkout, VaChat is designed to help Shopify merchants <strong>increase conversions and generate more sales from WhatsApp.</strong>
            </p>

            <div
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid var(--color-border-normal, #e5e5e5)",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "32px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.04)",
              }}
            >
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: 700,
                  color: "var(--color-text-title, #212529)",
                  marginBottom: "16px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Built for Shopify Growth
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "12px 18px",
                }}
              >
                {growthFeatures.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--color-text-primary, #000000)",
                    }}
                  >
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        backgroundColor: "#03cf65",
                        color: "#ffffff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "12px",
                        flexShrink: 0,
                        fontWeight: 700,
                      }}
                    >
                      ✓
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <a
                href={APP_SIGNUP}
                className="btn btn-primary btn-large"
              >
                <span>Grow My Shopify Sales</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
            </div>
          </div>

          <div className="feature-col-visual">
            <Image
              src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/bfe60rjxdht3o9im.webp"
              alt="VaChat AI Sales Assistant Interface for Shopify"
              width={600}
              height={500}
              style={{ width: "100%", height: "auto", borderRadius: "12px", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.08)" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
