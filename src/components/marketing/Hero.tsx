"use client";

import React from "react";
import Image from "next/image";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

interface HeroProps {
  onOpenDemo?: () => void;
}

export default function Hero({ onOpenDemo }: HeroProps) {
  return (
    <section className="hero-section">
      <div className="wr hero-inner">
        <div className="hero-content">
          <span className="badge-pill">
            <span>✨</span> — <span>AI-Powered WhatsApp Marketing Platform</span>
          </span>
          <h1 className="hero-title">
            <span className="hero-title-accent">5X Your Shopify Sales</span>
            with AI-Powered WhatsApp
          </h1>
          <p className="hero-lead-highlight" style={{ fontSize: "20px", fontWeight: 600, color: "var(--color-primary-dark, #009e46)", marginBottom: "10px" }}>
            VaChat turns WhatsApp conversations into Shopify sales.
          </p>
          <p className="hero-subtitle" style={{ marginTop: "4px" }}>
            Engage customers with AI-powered WhatsApp conversations and calls, recommend the right products, and make payments easier — all while seamlessly connecting with your Shopify store.
          </p>

          {/* Feature Highlights Pills */}
          <div className="hero-feature-pills" style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", justifyContent: "center", margin: "18px 0 28px 0" }}>
            {["AI WhatsApp Calls", "Product Recommendations", "Call Recording", "WhatsApp Payments", "Shopify Integration"].map((item, idx) => (
              <span
                key={idx}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "13px",
                  fontWeight: 500,
                  padding: "5px 12px",
                  borderRadius: "9999px",
                  backgroundColor: "rgba(3, 207, 101, 0.09)",
                  color: "#0f5132",
                  border: "1px solid rgba(3, 207, 101, 0.25)",
                }}
              >
                <span style={{ color: "#03cf65", marginRight: "6px", fontWeight: "bold" }}>•</span> {item}
              </span>
            ))}
          </div>

          <div className="hero-actions">
            <a
              href={APP_SIGNUP}
              className="btn btn-primary btn-large"
            >
              <span>Start Increasing Sales</span>
              <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
              </svg>
            </a>
            <button
              type="button"
              onClick={onOpenDemo}
              className="btn btn-secondary btn-large"
            >
              <span>See How VaChat Works</span>
              <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Hero Visual Graphic */}
        <div className="hero-visual-wrapper">
          <Image
            src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/psugh9h16vbov6xh.webp?w=1200&dpr=2"
            alt="WhatsApp Marketing Platform Demo Graphic"
            className="hero-visual-img"
            width={1100}
            height={640}
            priority
            style={{ width: "100%", height: "auto" }}
          />
        </div>
      </div>
    </section>
  );
}
