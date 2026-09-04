"use client";

import React from "react";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

interface FeatureItem {
  id: string;
  name: string;
  value: string;
  isIncluded?: boolean;
  isExcluded?: boolean;
}

interface PricingPlan {
  id: string;
  name: string;
  subtitle: string;
  badge?: string;
  badgeIcon?: string;
  isFeatured?: boolean;
  isBestValue?: boolean;
  description: string;
  price: string;
  period: string;
  pillLabel: string;
  features: FeatureItem[];
  ctaText: string;
  ctaHref: string;
}

const pricingPlans: PricingPlan[] = [
  {
    id: "starter",
    name: "STARTER",
    subtitle: "Perfect to get started",
    description: "Ideal for new Shopify stores getting started with WhatsApp.",
    price: "₹1,599",
    period: "/ month",
    pillLabel: "Starting Plan",
    ctaText: "Start Now",
    ctaHref: APP_SIGNUP,
    features: [
      { id: "accounts", name: "WhatsApp Account Limit", value: "1" },
      { id: "members", name: "Team Members", value: "1" },
      { id: "contacts", name: "Contact Limit", value: "1,000" },
      { id: "templates", name: "Template Messages", value: "100" },
      { id: "ai", name: "AI Features", value: "Not Included", isExcluded: true },
      { id: "commerce", name: "WhatsApp Commerce", value: "Not Included", isExcluded: true },
      { id: "voice", name: "Voice Cloning", value: "Not Included", isExcluded: true },
      { id: "calls", name: "Call Recording", value: "Not Included", isExcluded: true },
      { id: "workflows", name: "Automation Workflows", value: "Limited" },
      { id: "analytics", name: "Analytics & Reports", value: "Basic" },
      { id: "support", name: "Support", value: "Standard" },
    ],
  },
  {
    id: "growth",
    name: "GROWTH",
    subtitle: "WhatsApp Commerce + AI",
    badge: "MOST POPULAR",
    badgeIcon: "star",
    isFeatured: true,
    description: "Grow your store with WhatsApp Commerce and powerful AI features.",
    price: "₹3,500",
    period: "/ month",
    pillLabel: "Everything in Starter, plus",
    ctaText: "Start Now",
    ctaHref: APP_SIGNUP,
    features: [
      { id: "accounts", name: "WhatsApp Account Limit", value: "3" },
      { id: "members", name: "Team Members", value: "3" },
      { id: "contacts", name: "Contact Limit", value: "10,000" },
      { id: "templates", name: "Template Messages", value: "Unlimited" },
      { id: "ai", name: "AI Features", value: "Included", isIncluded: true },
      { id: "commerce", name: "WhatsApp Commerce", value: "Included", isIncluded: true },
      { id: "voice", name: "Voice Cloning", value: "Not Included", isExcluded: true },
      { id: "calls", name: "Call Recording", value: "Included", isIncluded: true },
      { id: "workflows", name: "Automation Workflows", value: "Advanced" },
      { id: "analytics", name: "Analytics & Reports", value: "Advanced" },
      { id: "support", name: "Support", value: "Priority Support" },
    ],
  },
  {
    id: "pro",
    name: "PRO",
    subtitle: "All Features + Own Voice Cloning",
    badge: "BEST VALUE",
    badgeIcon: "crown",
    isBestValue: true,
    description: "Complete WhatsApp automation with own voice cloning and all advanced features.",
    price: "₹12,500",
    period: "/ month",
    pillLabel: "Everything in Growth, plus",
    ctaText: "Start Now",
    ctaHref: APP_SIGNUP,
    features: [
      { id: "accounts", name: "WhatsApp Account Limit", value: "Unlimited" },
      { id: "members", name: "Team Members", value: "Unlimited" },
      { id: "contacts", name: "Contact Limit", value: "Unlimited" },
      { id: "templates", name: "Template Messages", value: "Unlimited" },
      { id: "ai", name: "AI Features", value: "Included", isIncluded: true },
      { id: "commerce", name: "WhatsApp Commerce", value: "Included", isIncluded: true },
      { id: "voice", name: "Voice Cloning (Your Own Voice)", value: "Included", isIncluded: true },
      { id: "calls", name: "Call Recording", value: "Included", isIncluded: true },
      { id: "workflows", name: "Automation Workflows", value: "Advanced" },
      { id: "analytics", name: "Analytics & Reports", value: "Advanced" },
      { id: "support", name: "Support", value: "24/7 Priority Support" },
    ],
  },
];

function getFeatureIcon(id: string) {
  switch (id) {
    case "accounts":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
      );
    case "members":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "contacts":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "templates":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case "ai":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        </svg>
      );
    case "commerce":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      );
    case "voice":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      );
    case "calls":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case "workflows":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      );
    case "analytics":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    case "support":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
        </svg>
      );
    default:
      return null;
  }
}

function getPlanHeaderIcon(id: string) {
  if (id === "starter") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    );
  }
  if (id === "growth") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
    </svg>
  );
}

export default function PricingSection() {
  return (
    <section id="pricing" className="vachat-pricing-section">
      <div className="wr">
        {/* Section Header */}
        <div className="vachat-pricing-header">
          <div className="vachat-pricing-eyebrow">
            <span>VACHAT PRICING</span>
          </div>
          <h2 className="vachat-pricing-title">
            <span className="vachat-brand-text">VaChat</span> Plans That Grow Your Shopify Sales
          </h2>
          <p className="vachat-pricing-subtitle">
            Choose the right VaChat plan to turn WhatsApp conversations into more Shopify sales.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="vachat-pricing-grid">
          {pricingPlans.map((plan) => {
            const isFeatured = plan.isFeatured;
            const isBestValue = plan.isBestValue;

            return (
              <div
                key={plan.id}
                className={`vachat-pricing-card ${isFeatured ? "featured" : ""} ${isBestValue ? "best-value" : ""}`}
              >
                {/* Floating Top Badge */}
                {plan.badge && (
                  <div className={`vachat-plan-badge ${isFeatured ? "badge-popular" : "badge-best"}`}>
                    {plan.badgeIcon === "star" && (
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ marginRight: "4px" }}>
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    )}
                    {plan.badgeIcon === "crown" && (
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ marginRight: "4px" }}>
                        <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
                      </svg>
                    )}
                    <span>{plan.badge}</span>
                  </div>
                )}

                {/* Plan Header */}
                <div className="vachat-plan-top">
                  <div className="vachat-plan-icon-wrap">
                    {getPlanHeaderIcon(plan.id)}
                  </div>
                  <div>
                    <h3 className="vachat-plan-name">{plan.name}</h3>
                    <p className="vachat-plan-sublabel">{plan.subtitle}</p>
                  </div>
                </div>

                {/* Plan Description */}
                <p className="vachat-plan-desc">{plan.description}</p>

                {/* Price Display */}
                <div className="vachat-plan-price-box">
                  <div className="vachat-plan-price-row">
                    <span className="vachat-price-value">{plan.price}</span>
                    <span className="vachat-price-period">{plan.period}</span>
                  </div>
                  <div className="vachat-plan-pill">
                    <span>{plan.pillLabel}</span>
                  </div>
                </div>

                {/* Features List */}
                <div className="vachat-plan-features">
                  {plan.features.map((feature, idx) => (
                    <div className="vachat-feature-row" key={idx}>
                      <div className="vachat-feature-left">
                        <span className="vachat-feature-icon">
                          {getFeatureIcon(feature.id)}
                        </span>
                        <span className="vachat-feature-name">{feature.name}</span>
                      </div>
                      <div className="vachat-feature-right">
                        {feature.isIncluded ? (
                          <span className="vachat-icon-check" title="Included">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#03cf65" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        ) : feature.isExcluded ? (
                          <span className="vachat-icon-cross" title="Not Included">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#ef4444" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </span>
                        ) : (
                          <span className="vachat-feature-val">{feature.value}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* CTA Action Button */}
                <div className="vachat-plan-action">
                  <a href={plan.ctaHref} className="vachat-pricing-btn">
                    <span>{plan.ctaText}</span>
                    <span className="vachat-btn-arrow">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </span>
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Trust Strip */}
        <div className="vachat-pricing-trust">
          <div className="vachat-trust-item">
            <span className="vachat-trust-check">✓</span>
            <span>No Setup Fees</span>
          </div>
          <span className="vachat-trust-sep">•</span>
          <div className="vachat-trust-item">
            <span className="vachat-trust-check">✓</span>
            <span>Cancel Anytime</span>
          </div>
        </div>
      </div>
    </section>
  );
}

