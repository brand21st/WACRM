"use client";

import React, { useState } from "react";
import { PRODUCT_NAME } from "@/lib/brand";

interface FAQItem {
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    question: `What does ${PRODUCT_NAME} do?`,
    answer: `${PRODUCT_NAME} turns your WhatsApp conversations into Shopify sales with 24/7 AI customer conversations, AI WhatsApp calling, smart product recommendations, in-chat payments, and automated marketing workflows.`,
  },
  {
    question: "How does VaChat integrate with Shopify?",
    answer: "VaChat connects directly to your Shopify store in just a few clicks, syncing your product catalog, orders, and customer details so your AI can recommend products and process orders in real time.",
  },
  {
    question: "Is this built on official WhatsApp Business APIs?",
    answer: "Yes, the platform is built on official WhatsApp Business APIs, ensuring maximum delivery rates, zero risk of ban, and compliance with Meta's messaging policies.",
  },
  {
    question: "Does it offer a FREE trial or account?",
    answer: "Yes! You can get started with a free trial to explore all features, set up your WhatsApp Business account, and start engaging customers right away.",
  },
  {
    question: "Is there any WhatsApp Business API setup fee?",
    answer: "No. There is zero setup fee to connect your WhatsApp Business account. You only pay for your active subscription and standard Meta messaging rates.",
  },
  {
    question: "How is Customer Support handled?",
    answer: "We have dedicated live chat and email customer support ready to assist you with onboarding, number verification, broadcast campaigns, and custom workflows.",
  },
  {
    question: "What is the Cost of Broadcasting messages?",
    answer: "Broadcasting is charged at standard Meta WhatsApp Business API conversation rates for marketing and utility messages. Inbound service conversations and replies within the 24-hour window are free.",
  },
  {
    question: "How many messages can I broadcast per day?",
    answer: "Tier limits start at 2,000 messages/day and automatically scale up to 10,000, 100,000, and unlimited messages per day based on your message quality and sending volume.",
  },
];

export default function FAQ() {
  const [activeIndex, setActiveIndex] = useState<number | null>(0);

  const toggleFAQ = (index: number) => {
    setActiveIndex(activeIndex === index ? null : index);
  };

  return (
    <section id="faq" className="faq-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">FAQ</h2>
          <p className="section-subtitle">Frequently Asked Questions about {PRODUCT_NAME}</p>
        </div>

        <div className="faq-wrapper">
          {faqs.map((faq, index) => (
            <div
              className={`faq-item ${activeIndex === index ? "active" : ""}`}
              key={index}
            >
              <button
                type="button"
                className="faq-question"
                onClick={() => toggleFAQ(index)}
              >
                <span>{faq.question}</span>
                <span className="faq-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6"></path>
                  </svg>
                </span>
              </button>
              <div className="faq-answer">
                <p>{faq.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
