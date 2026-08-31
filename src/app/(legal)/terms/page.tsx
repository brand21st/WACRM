import type { Metadata } from "next";
import Link from "next/link";
import {
  LEGAL_APP,
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR,
  LegalChrome,
} from "../legal-chrome";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `Terms for using ${LEGAL_APP}, operated by ${LEGAL_OPERATOR}.`,
};

export default function TermsOfServicePage() {
  return (
    <LegalChrome
      title="Terms of Service"
      description={`These terms govern access to ${LEGAL_APP}, a WhatsApp Business CRM operated by ${LEGAL_OPERATOR}.`}
    >
      <h2>Agreement</h2>
      <p>
        By creating an account or using {LEGAL_APP} (the &quot;Service&quot;),
        you agree to these Terms of Service and our{" "}
        <Link href="/privacy">Privacy Policy</Link>. If you use the Service on
        behalf of a business, you represent that you have authority to bind that
        business.
      </p>

      <h2>The Service</h2>
      <p>
        {LEGAL_APP} lets authorized operators connect a WhatsApp Business phone
        number via Meta&apos;s Cloud API, receive and send messages, and manage
        related CRM features (contacts, inbox, templates, automations, optional
        store integrations). The Service is provided as-is for your business
        use.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>You must comply with Meta Platform Terms, WhatsApp Business policies, and applicable law (including anti-spam and privacy rules).</li>
        <li>You are responsible for content you send through WhatsApp and for obtaining any consent required to message customers.</li>
        <li>You must keep API tokens, webhook secrets, and login credentials confidential.</li>
        <li>You must not abuse the Service, probe it for unauthorized access, or use it to send unlawful or deceptive messages.</li>
      </ul>

      <h2>Meta and third-party services</h2>
      <p>
        WhatsApp delivery depends on Meta. Outages, policy enforcement, phone
        number quality holds, or API changes at Meta may affect the Service. We
        are not Meta and do not control WhatsApp. Optional integrations
        (Shopify, AI providers, and similar) are governed by those providers&apos;
        terms.
      </p>

      <h2>Accounts</h2>
      <p>
        You must provide accurate account information and are responsible for
        activity under your login. We may suspend access if we reasonably
        believe these terms, Meta policies, or the law have been violated.
      </p>

      <h2>Intellectual property</h2>
      <p>
        You retain rights to your customer content and templates. We retain
        rights to the Service software, branding, and documentation. You grant
        us a limited license to host and process your content solely to operate
        the Service.
      </p>

      <h2>Disclaimer</h2>
      <p>
        The Service is provided &quot;as is&quot; without warranties of
        uninterrupted or error-free operation. To the fullest extent permitted
        by law, {LEGAL_OPERATOR} is not liable for lost profits, lost data, or
        indirect damages arising from use of the Service or from Meta/WhatsApp
        platform behavior.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Service at any time. To delete your data, follow
        the <Link href="/data-deletion">data deletion instructions</Link>. We
        may terminate or limit access for breach of these terms.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. The date at the top of this page will change
        when we do. Continued use after an update constitutes acceptance.
      </p>

      <h2>Contact</h2>
      <p>
        Questions:{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </LegalChrome>
  );
}
