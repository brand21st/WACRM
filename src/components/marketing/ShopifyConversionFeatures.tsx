import React from "react";
import Image from "next/image";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

interface FeatureItem {
  id: string;
  badge: string;
  emoji: string;
  title: string;
  description: string;
  subtext?: string;
  image: string;
  imageAlt: string;
  reverse?: boolean;
}

const features: FeatureItem[] = [
  {
    id: "ai-support",
    badge: "24/7 Sales Assistance",
    emoji: "🤖",
    title: "AI That Talks to Your Customers",
    description: "Let VaChat's AI answer questions, understand what customers need, recommend products, and guide them toward a purchase — 24/7.",
    subtext: "Instant responses that keep customer intent high, whether it's daytime browsing or midnight shopping.",
    image: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/j87yg4e58k0f6l57.gif?w=520&dpr=2",
    imageAlt: "AI customer conversation demo",
    reverse: false,
  },
  {
    id: "shopify-orders",
    badge: "Direct Catalog Integration",
    emoji: "🛍️",
    title: "Convert Conversations Into Shopify Orders",
    description: "Connect your Shopify store with VaChat and bring your products directly into the customer conversation. Help shoppers discover products faster and move from interest to purchase.",
    subtext: "Sync products, variants, and stock automatically so your AI always recommends available items.",
    image: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/2cbv2iqtg8phy296.webp",
    imageAlt: "Shopify product catalog in WhatsApp",
    reverse: true,
  },
  {
    id: "ai-calls",
    badge: "Conversational Voice AI",
    emoji: "📞",
    title: "AI-Powered WhatsApp Calls",
    description: "Give customers a more personal buying experience with AI-powered WhatsApp calls. Your AI can talk with customers, answer questions, and assist them through their buying journey.",
    subtext: "Natural, lifelike voice calling that handles high-intent purchase questions in real time.",
    image: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/psugh9h16vbov6xh.webp?w=800&dpr=2",
    imageAlt: "AI WhatsApp calling visual",
    reverse: false,
  },
  {
    id: "call-recording",
    badge: "Quality & Insights",
    emoji: "🎙️",
    title: "Record & Understand Calls",
    description: "Record WhatsApp calls to review conversations, understand customer requirements, and identify opportunities to improve your sales process.",
    subtext: "Actionable transcripts and summaries to continuously optimize your pitch and product recommendations.",
    image: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/h85o5lk7uzt082ur.gif?w=650&dpr=2",
    imageAlt: "Call recording and analysis",
    reverse: true,
  },
  {
    id: "whatsapp-payments",
    badge: "Zero-Friction Checkout",
    emoji: "💳",
    title: "Make Payments Easier on WhatsApp",
    description: "Reduce friction at checkout with a convenient WhatsApp payment experience, helping customers move from product discovery to purchase faster.",
    subtext: "Complete transactions right inside the chat window without losing buyers to complicated external checkouts.",
    image: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/wrgtce58qaaq14xq.jpg?w=800&h=800&dpr=2",
    imageAlt: "WhatsApp payment checkout interface",
    reverse: false,
  },
];

export default function ShopifyConversionFeatures() {
  return (
    <section id="features" className="features-deep-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Turn WhatsApp Conversations Into Shopify Customers</h2>
          <p className="section-subtitle">
            Your customers are already talking on WhatsApp. VaChat helps you turn those conversations into <strong>real Shopify orders</strong>.
          </p>
        </div>

        {features.map((feat) => (
          <div
            id={feat.id}
            className={`feature-row ${feat.reverse ? "reverse" : ""}`}
            key={feat.id}
          >
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
                  padding: "4px 12px",
                  borderRadius: "9999px",
                  width: "fit-content",
                  marginBottom: "12px",
                }}
              >
                <span>{feat.emoji}</span> {feat.badge}
              </span>
              <h3 className="section-title" style={{ textAlign: "left", fontSize: "30px", marginBottom: "14px" }}>
                {feat.title}
              </h3>
              <p className="section-subtitle" style={{ textAlign: "left", marginBottom: feat.subtext ? "12px" : "24px", fontSize: "17px", lineHeight: "1.55" }}>
                {feat.description}
              </p>
              {feat.subtext && (
                <p style={{ color: "var(--color-text-secondary)", fontSize: "15px", lineHeight: "1.6", marginBottom: "28px" }}>
                  {feat.subtext}
                </p>
              )}
              <div>
                <a
                  href={APP_SIGNUP}
                  className="btn btn-primary"
                >
                  <span>Start Selling on WhatsApp</span>
                  <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                  </svg>
                </a>
              </div>
            </div>
            <div className="feature-row-visual">
              <Image
                src={feat.image}
                alt={feat.imageAlt}
                width={560}
                height={420}
                unoptimized={feat.image.endsWith(".gif")}
                style={{ width: "100%", height: "auto", borderRadius: "12px", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.08)" }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
