"use client";

import React, { useState } from "react";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

interface FeatureItem {
  id: string;
  name: string;
  value?: string;
  isIncluded?: boolean;
  isExcluded?: boolean;
}

interface ConversationRates {
  utility: string;
  marketing: string;
  authentication: string;
}

interface PricingPlan {
  id: string;
  name: string;
  subtitle: string;
  badge?: string;
  badgeType?: "popular";
  monthlyPrice: string;
  yearlyPrice: string;
  yearlyBilledTotal: string;
  yearlySavings: string;
  period: string;
  pillLabel: string;
  pillType?: "teal" | "green";
  isFlexibleOption?: boolean;
  rates: ConversationRates;
  features: FeatureItem[];
  ctaText: string;
  ctaHref: string;
}

const pricingPlans: PricingPlan[] = [
  {
    id: "super_starter",
    name: "SUPER STARTER",
    subtitle: "Simple automation to grow your sales.",
    monthlyPrice: "₹1,500",
    yearlyPrice: "₹1,200",
    yearlyBilledTotal: "₹14,400",
    yearlySavings: "₹3,600",
    period: "/ month",
    pillLabel: "SMALL BUSINESS ESSENTIALS",
    pillType: "teal",
    isFlexibleOption: true,
    ctaText: "Start Now",
    ctaHref: APP_SIGNUP,
    rates: {
      utility: "₹ 0.115",
      marketing: "₹ 0.8631",
      authentication: "₹ 0.115",
    },
    features: [
      { id: "meta_api", name: "Official Meta WhatsApp API", isIncluded: true },
      { id: "free_setup", name: "Free Setup & Onboarding", isIncluded: true },
      { id: "accounts", name: "WhatsApp Account Limit", value: "1" },
      { id: "members", name: "Team Members", value: "1" },
      { id: "contacts", name: "Contact Limit", value: "1,000" },
      { id: "ai_text", name: "AI Reply (Text)", isIncluded: true },
      { id: "ai_voice", name: "AI Voice Reply", isIncluded: true },
      { id: "voice_cloning", name: "Voice Cloning", isIncluded: true },
      { id: "recommendations", name: "Product Recommendations", isIncluded: true },
      { id: "checkout", name: "Direct Shopify Checkout", isIncluded: true },
      { id: "templates", name: "Template Messages", value: "Unlimited" },
      { id: "commerce", name: "WhatsApp Commerce", isIncluded: true },
      { id: "calls", name: "Call Recordings", isIncluded: true },
      { id: "workflows", name: "Automation Workflows", value: "Advanced" },
      { id: "analytics", name: "Analytics & Reports", value: "Advanced" },
      { id: "support", name: "Priority Support", value: "Priority" },
    ],
  },
  {
    id: "starter",
    name: "STARTER",
    subtitle: "Perfect to get started with WhatsApp automation.",
    monthlyPrice: "₹3,500",
    yearlyPrice: "₹2,800",
    yearlyBilledTotal: "₹33,600",
    yearlySavings: "₹8,400",
    period: "/ month",
    pillLabel: "Text AI Reply",
    ctaText: "Start Now",
    ctaHref: APP_SIGNUP,
    rates: {
      utility: "₹ 0.115",
      marketing: "₹ 0.8631",
      authentication: "₹ 0.115",
    },
    features: [
      { id: "meta_api", name: "Official Meta WhatsApp API", isIncluded: true },
      { id: "free_setup", name: "Free Setup & Onboarding", isIncluded: true },
      { id: "accounts", name: "WhatsApp Account Limit", value: "2" },
      { id: "members", name: "Team Members", value: "2" },
      { id: "contacts", name: "Contact Limit", value: "3,000" },
      { id: "ai_text", name: "AI Reply (Text Only)", isIncluded: true },
      { id: "recommendations", name: "Product Recommendations", isIncluded: true },
      { id: "checkout", name: "Direct Shopify Checkout", isIncluded: true },
      { id: "templates", name: "Template Messages", value: "100" },
      { id: "commerce", name: "WhatsApp Commerce", isIncluded: true },
      { id: "ai_voice", name: "AI Voice Reply", isIncluded: true },
      { id: "voice_cloning", name: "Voice Cloning", isExcluded: true },
      { id: "calls", name: "Call Recordings", isExcluded: true },
      { id: "workflows", name: "Automation Workflows", value: "Basic" },
      { id: "analytics", name: "Analytics & Reports", value: "Basic" },
      { id: "support", name: "Standard Support", value: "Standard" },
    ],
  },
  {
    id: "growth",
    name: "GROWTH",
    subtitle: "Advanced AI features with Voice Reply & more.",
    badge: "MOST POPULAR",
    badgeType: "popular",
    monthlyPrice: "₹6,500",
    yearlyPrice: "₹5,200",
    yearlyBilledTotal: "₹62,400",
    yearlySavings: "₹15,600",
    period: "/ month",
    pillLabel: "AI + Voice Reply",
    ctaText: "Start Now",
    ctaHref: APP_SIGNUP,
    rates: {
      utility: "₹ 0.115",
      marketing: "₹ 0.8631",
      authentication: "₹ 0.115",
    },
    features: [
      { id: "meta_api", name: "Official Meta WhatsApp API", isIncluded: true },
      { id: "free_setup", name: "Free Setup & Onboarding", isIncluded: true },
      { id: "accounts", name: "WhatsApp Account Limit", value: "3" },
      { id: "members", name: "Team Members", value: "3" },
      { id: "contacts", name: "Contact Limit", value: "10,000" },
      { id: "ai_text", name: "AI Reply (Text)", isIncluded: true },
      { id: "ai_voice", name: "AI Voice Reply", isIncluded: true },
      { id: "voice_cloning", name: "Voice Cloning", isIncluded: true },
      { id: "recommendations", name: "Product Recommendations", isIncluded: true },
      { id: "checkout", name: "Direct Shopify Checkout", isIncluded: true },
      { id: "templates", name: "Template Messages", value: "Unlimited" },
      { id: "commerce", name: "WhatsApp Commerce", isIncluded: true },
      { id: "calls", name: "Call Recordings", isIncluded: true },
      { id: "workflows", name: "Automation Workflows", value: "Advanced" },
      { id: "analytics", name: "Analytics & Reports", value: "Advanced" },
      { id: "support", name: "Priority Support", value: "Priority" },
    ],
  },
  {
    id: "pro",
    name: "PRO",
    subtitle: "Complete automation with all features.",
    monthlyPrice: "₹14,999",
    yearlyPrice: "₹11,999",
    yearlyBilledTotal: "₹1,43,988",
    yearlySavings: "₹36,000",
    period: "/ month",
    pillLabel: "All Features + Voice Cloning",
    ctaText: "Start Now",
    ctaHref: APP_SIGNUP,
    rates: {
      utility: "₹ 0.115",
      marketing: "₹ 0.8631",
      authentication: "₹ 0.115",
    },
    features: [
      { id: "meta_api", name: "Official Meta WhatsApp API", isIncluded: true },
      { id: "free_setup", name: "Free Setup & Onboarding", isIncluded: true },
      { id: "accounts", name: "WhatsApp Account Limit", value: "Unlimited" },
      { id: "members", name: "Team Members", value: "Unlimited" },
      { id: "contacts", name: "Contact Limit", value: "Unlimited" },
      { id: "ai_text", name: "AI Reply (Text)", isIncluded: true },
      { id: "ai_voice", name: "AI Voice Reply", isIncluded: true },
      { id: "voice_cloning", name: "Voice Cloning", isIncluded: true },
      { id: "recommendations", name: "Product Recommendations", isIncluded: true },
      { id: "checkout", name: "Direct Shopify Checkout", isIncluded: true },
      { id: "templates", name: "Template Messages", value: "Unlimited" },
      { id: "commerce", name: "WhatsApp Commerce", isIncluded: true },
      { id: "calls", name: "Call Recordings", isIncluded: true },
      { id: "workflows", name: "Automation Workflows", value: "Advanced" },
      { id: "analytics", name: "Analytics & Reports", value: "Advanced" },
      { id: "support", name: "24/7 Priority Support", value: "24/7 Priority" },
    ],
  },
];

function getFeatureIcon(id: string) {
  switch (id) {
    case "meta_api":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "free_setup":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
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
    case "ai_text":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "recommendations":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case "checkout":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      );
    case "templates":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="7" y1="8" x2="17" y2="8" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="7" y1="16" x2="13" y2="16" />
        </svg>
      );
    case "commerce":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      );
    case "ai_voice":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      );
    case "voice_cloning":
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11v3a1 1 0 0 0 1 1h2l4 4V5L6 9H4a1 1 0 0 0-1 1z" />
          <path d="M14 8c1.5 1.5 1.5 6.5 0 8" />
          <path d="M17 5c3 3.5 3 10.5 0 14" />
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
  if (id === "super_starter") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#008744" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 20A7 7 0 0 1 4 13a7 7 0 0 1 7-7c1.5 0 2.9.5 4 1.3V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v6.5c1.2 1.3 2 3.1 2 5.5a7 7 0 0 1-7 7z" />
        <path d="M11 13c2.5 0 5-1 6-3" />
      </svg>
    );
  }
  if (id === "starter") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#008744" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" fill="#008744" />
      </svg>
    );
  }
  if (id === "growth") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#008744" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="#008744" stroke="#008744" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
    </svg>
  );
}

const trustFeatures = [
  {
    id: "setup",
    title: "Easy Setup",
    subtitle: "Get started in minutes",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#008744" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "security",
    title: "Secure & Reliable",
    subtitle: "Enterprise-grade security",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#008744" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "support",
    title: "24/7 Priority Support",
    subtitle: "We're here for you anytime",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#008744" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </svg>
    ),
  },
  {
    id: "pricing",
    title: "No Hidden Charges",
    subtitle: "Transparent pricing",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#008744" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <circle cx="7" cy="7" r="1.5" fill="#008744" />
      </svg>
    ),
  },
];

export default function PricingSection() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const isYearly = billingCycle === "yearly";

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

          {/* Billing Toggle (Monthly / Yearly with 20% Discount) */}
          <div className="vachat-billing-toggle-container">
            <div className="vachat-billing-toggle-wrapper" role="tablist" aria-label="Billing frequency selection">
              <button
                type="button"
                role="tab"
                id="billing-tab-monthly"
                aria-selected={!isYearly}
                aria-controls="pricing-cards-grid"
                className={`vachat-billing-toggle-btn ${!isYearly ? "active" : ""}`}
                onClick={() => setBillingCycle("monthly")}
              >
                Monthly Billing
              </button>
              <button
                type="button"
                role="tab"
                id="billing-tab-yearly"
                aria-selected={isYearly}
                aria-controls="pricing-cards-grid"
                className={`vachat-billing-toggle-btn ${isYearly ? "active" : ""}`}
                onClick={() => setBillingCycle("yearly")}
              >
                <span>Yearly Billing</span>
                <span className="vachat-billing-discount-badge">Save 20%</span>
              </button>
            </div>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div id="pricing-cards-grid" className="vachat-pricing-grid" role="region" aria-live="polite">
          {pricingPlans.map((plan) => {
            const isPopular = plan.badgeType === "popular";
            const isDisabled = isYearly && plan.isFlexibleOption;
            const currentPrice = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
            const ctaUrl = plan.isFlexibleOption
              ? `${plan.ctaHref}?plan=${plan.id}&billing=monthly`
              : `${plan.ctaHref}?plan=${plan.id}&billing=${billingCycle}`;

            return (
              <div
                key={plan.id}
                className={`vachat-pricing-card ${isPopular ? "featured" : ""} ${isDisabled ? "plan-disabled" : ""}`}
              >
                {/* Floating Top Badge (Growth or Disabled status) */}
                {isDisabled ? (
                  <div className="vachat-plan-badge badge-disabled">
                    <span>MONTHLY ONLY</span>
                  </div>
                ) : (
                  plan.badge && (
                    <div className="vachat-plan-badge badge-popular">
                      <span className="badge-icon-star">★</span>
                      <span>{plan.badge}</span>
                    </div>
                  )
                )}

                {/* Plan Header */}
                <div className="vachat-plan-top">
                  <div className="vachat-plan-icon-wrap">
                    {getPlanHeaderIcon(plan.id)}
                  </div>
                  <div className="vachat-plan-title-wrap">
                    <h3 className="vachat-plan-name">{plan.name}</h3>
                    <p className="vachat-plan-sublabel">{plan.subtitle}</p>
                  </div>
                </div>

                {/* Price Display */}
                {plan.isFlexibleOption ? (
                  <div className="vachat-flexible-card-box">
                    <div className="vachat-flexible-header-label">Flexible Billing Options</div>

                    <div className="vachat-flexible-price-inner">
                      <div className="vachat-plan-price-row">
                        <span className="vachat-price-value">{plan.monthlyPrice}</span>
                        <span className="vachat-price-period">{plan.period}</span>
                      </div>
                      <div className="vachat-flexible-subtext">
                        Billed Monthly
                      </div>
                    </div>

                    <div className="vachat-flexible-lock-badge">
                      <div className="vachat-lock-icon-svg">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#008744" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                      </div>
                      <div className="vachat-lock-text-wrap">
                        <span className="vachat-lock-title">Plan locked for 2 months</span>
                        <span className="vachat-lock-desc">
                          ₹3,000 will be charged for 2 months (one-time)
                        </span>
                      </div>
                    </div>

                    {isDisabled && (
                      <div className="vachat-disabled-overlay-msg">
                        <span>Available on Monthly Billing only</span>
                      </div>
                    )}

                    <div className={`vachat-plan-pill ${plan.pillType === "teal" ? "pill-teal" : ""}`}>
                      <span>{plan.pillLabel}</span>
                    </div>
                  </div>
                ) : (
                  <div className="vachat-plan-price-box">
                    <div className="vachat-plan-price-row">
                      {isYearly && (
                        <span className="vachat-price-original">{plan.monthlyPrice}</span>
                      )}
                      <span className="vachat-price-value">{currentPrice}</span>
                      <span className="vachat-price-period">{plan.period}</span>
                    </div>

                    {isYearly ? (
                      <div className="vachat-plan-yearly-note">
                        <span className="yearly-note-dot">●</span>
                        <span>Billed annually at {plan.yearlyBilledTotal}/yr <strong className="yearly-savings-text">(Save {plan.yearlySavings}/yr)</strong></span>
                      </div>
                    ) : (
                      <div className="vachat-plan-monthly-note">
                        <span>Billed monthly</span>
                      </div>
                    )}

                    <div className={`vachat-plan-pill ${plan.pillType === "teal" ? "pill-teal" : ""}`}>
                      <span>{plan.pillLabel}</span>
                    </div>
                  </div>
                )}

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

                {/* Meta Conversation Charges */}
                <div className="vachat-rates-box">
                  <div className="vachat-rate-row">
                    <span className="vachat-rate-label">Utility</span>
                    <span className="vachat-rate-val">{plan.rates.utility}</span>
                  </div>
                  <div className="vachat-rate-row">
                    <span className="vachat-rate-label">Marketing</span>
                    <span className="vachat-rate-val">{plan.rates.marketing}</span>
                  </div>
                  <div className="vachat-rate-row">
                    <span className="vachat-rate-label">Authentication</span>
                    <span className="vachat-rate-val">{plan.rates.authentication}</span>
                  </div>
                </div>

                {/* CTA Action Button */}
                <div className="vachat-plan-action">
                  {isDisabled ? (
                    <button
                      type="button"
                      onClick={() => setBillingCycle("monthly")}
                      className="vachat-pricing-btn vachat-btn-disabled"
                      title="Switch to Monthly Billing to choose Super Starter"
                    >
                      <span>Monthly Plan Only</span>
                    </button>
                  ) : (
                    <a href={ctaUrl} className="vachat-pricing-btn">
                      <span>{plan.ctaText}</span>
                      <span className="vachat-btn-arrow">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#008744" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </span>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Trust Strip */}
        <div className="vachat-pricing-trust">
          {trustFeatures.map((item) => (
            <div key={item.id} className="vachat-trust-item">
              <div className="vachat-trust-icon">
                {item.icon}
              </div>
              <div className="vachat-trust-info">
                <span className="vachat-trust-title">{item.title}</span>
                <span className="vachat-trust-subtitle">{item.subtitle}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
