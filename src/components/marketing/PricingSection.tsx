"use client";

import React from "react";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

interface FeatureItem {
  id: string;
  name: string;
  value?: string;
  isIncluded?: boolean;
  isExcluded?: boolean;
}

interface PricingPlan {
  id: string;
  name: string;
  subtitle: string;
  badge?: string;
  badgeType?: "popular" | "best-value";
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
      { id: "ai", name: "AI Features", isExcluded: true },
      { id: "commerce", name: "WhatsApp Commerce", isExcluded: true },
      { id: "voice", name: "Voice Cloning", isExcluded: true },
      { id: "calls", name: "Call Recordings", isExcluded: true },
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
    badgeType: "popular",
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
      { id: "ai", name: "AI Features", isIncluded: true },
      { id: "commerce", name: "WhatsApp Commerce", isIncluded: true },
      { id: "voice", name: "Voice Cloning", isExcluded: true },
      { id: "calls", name: "Call Recordings", isIncluded: true },
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
    badgeType: "best-value",
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
      { id: "ai", name: "AI Features", isIncluded: true },
      { id: "commerce", name: "WhatsApp Commerce", isIncluded: true },
      { id: "voice", name: "Voice Cloning (Your Own Voice)", isIncluded: true },
      { id: "calls", name: "Call Recordings", isIncluded: true },
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
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case "members":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "contacts":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case "templates":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "ai":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="m9 12 2 2 4-4" />
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
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
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
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="15" width="6" height="6" rx="1" />
          <path d="M6 9v3a3 3 0 0 0 3 3h6" />
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
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
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
          <h2 className="vachat-pricing-title">
            <span className="vachat-brand-text">VaChat</span> Plans That Scale With Your Business
          </h2>
          <p className="vachat-pricing-subtitle">
            From getting started to full automation with AI &amp; voice cloning — choose your perfect plan.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="vachat-pricing-grid">
          {pricingPlans.map((plan) => {
            const isPopular = plan.badgeType === "popular";
            const isBestValue = plan.badgeType === "best-value";

            return (
              <div
                key={plan.id}
                className={`vachat-pricing-card ${isPopular ? "featured" : ""} ${isBestValue ? "best-value-card" : ""}`}
              >
                {/* Floating Top Badge */}
                {plan.badge && (
                  <div
                    className={`vachat-plan-badge ${
                      isPopular ? "badge-popular" : "badge-best-value"
                    }`}
                  >
                    {isPopular && (
                      <span className="badge-icon-star">★</span>
                    )}
                    {isBestValue && (
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" className="badge-icon-crown">
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
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        ) : feature.isExcluded ? (
                          <span className="vachat-icon-cross" title="Not Included">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ef4444" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
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
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
            <span className="vachat-trust-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </span>
            <span>No Setup Fees</span>
          </div>

          <span className="vachat-trust-sep">|</span>

          <div className="vachat-trust-item">
            <span className="vachat-trust-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </span>
            <span>Cancel Anytime</span>
          </div>
        </div>
      </div>
    </section>
  );
}
