import React from "react";
import Image from "next/image";

export default function AdvancedGrid() {
  return (
    <section id="automation" className="advanced-grid-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Advanced Features that Drive Conversions</h2>
          <p className="section-subtitle">3X Your revenues using WhatsApp Marketing &amp; Automation</p>
        </div>

        <div className="grid-cards">
          {/* Card 1 */}
          <div id="live-chat" className="feature-card">
            <div className="feature-card-header">
              <h3>Multiple Human Live Chat</h3>
              <p>
                Have multiple team members to drive Live Chat Support on the Same WhatsApp Business Number. Filter Chats according to tags, campaigns and attributes for Smart Agent Chat Routing.
              </p>
            </div>
            <div className="feature-card-media">
              <Image
                src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/j87yg4e58k0f6l57.gif?w=420&dpr=2"
                alt="Multi-agent live chat support demo"
                width={420}
                height={260}
                unoptimized
                style={{ width: "100%", height: "auto" }}
              />
            </div>
          </div>

          {/* Card 2 */}
          <div id="analytics" className="feature-card">
            <div className="feature-card-header">
              <h3>Real-Time Analytics</h3>
              <p>
                Track your campaign results in real-time. Monitor Read, Replied &amp; Clicked rates for each campaign and retarget smartly for higher conversions!
              </p>
            </div>
            <div className="feature-card-media">
              <Image
                src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/h85o5lk7uzt082ur.gif?w=650&dpr=2"
                alt="Click tracking & real-time analytics"
                width={650}
                height={380}
                unoptimized
                style={{ width: "100%", height: "auto" }}
              />
            </div>
          </div>

          {/* Card 3 */}
          <div id="ai-agents" className="feature-card">
            <div className="feature-card-header">
              <h3>Build no-code Chatbot in minutes</h3>
              <p>
                Build your Own Chatbot Flows your Way! Easy-to-use Chatbot &amp; Catalog Flow builder to build your conversational journeys seamlessly.
              </p>
            </div>
            <div className="feature-card-media">
              <Image
                src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/vub611jt4oy727h5.gif?w=630&dpr=2"
                alt="No-code Chatbot Builder Flow"
                width={630}
                height={380}
                unoptimized
                style={{ width: "100%", height: "auto" }}
              />
            </div>
          </div>

          {/* Card 4 */}
          <div className="feature-card">
            <div className="feature-card-header">
              <h3>Import &amp; Broadcast Instantly</h3>
              <p>
                Simply Import all your Contacts and Broadcast approved messages Instantly. See real-time analytics on the Platform for delivered, read rates and more.
              </p>
            </div>
            <div className="feature-card-media">
              <Image
                src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/i7e8twz7nl3trq39.gif?w=420&dpr=2"
                alt="Contact import and instant broadcast demo"
                width={420}
                height={260}
                unoptimized
                style={{ width: "100%", height: "auto" }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
