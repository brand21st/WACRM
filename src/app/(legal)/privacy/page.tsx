import type { Metadata } from "next";
import Link from "next/link";
import {
  LEGAL_APP,
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR,
  LegalChrome,
} from "../legal-chrome";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${LEGAL_OPERATOR} collects, uses, and stores data in ${LEGAL_APP}.`,
};

export default function PrivacyPolicyPage() {
  return (
    <LegalChrome
      title="Privacy Policy"
      description={`${LEGAL_OPERATOR} operates ${LEGAL_APP}, a WhatsApp Business CRM that connects to Meta's WhatsApp Cloud API so businesses can manage customer conversations.`}
    >
      <h2>Who we are</h2>
      <p>
        This policy applies to {LEGAL_APP} as operated by {LEGAL_OPERATOR}{" "}
        (the &quot;Service&quot;). Contact:{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>Data we collect</h2>
      <p>Depending on how the Service is used, we may process:</p>
      <ul>
        <li>
          Account data for operators who sign in (name, email, password hash,
          team membership).
        </li>
        <li>
          WhatsApp Business credentials you save (phone number ID, WhatsApp
          Business Account ID, access tokens, webhook verify token), stored
          encrypted.
        </li>
        <li>
          WhatsApp conversation data delivered by Meta webhooks: phone numbers,
          profile names, message content, media, delivery status, and template
          events.
        </li>
        <li>
          Optional integrations you connect (for example Shopify store data,
          AI provider keys) used only to run those features.
        </li>
        <li>
          Technical logs needed to operate the Service (request metadata, error
          logs).
        </li>
      </ul>

      <h2>How we use data</h2>
      <ul>
        <li>To provide the inbox, contacts, broadcasts, automations, and related CRM features.</li>
        <li>To send and receive WhatsApp messages through Meta&apos;s Cloud API on your behalf.</li>
        <li>To authenticate operators, secure the Service, and prevent abuse.</li>
        <li>To comply with law and Meta Platform Terms, including user data deletion requests.</li>
      </ul>

      <h2>Meta and WhatsApp</h2>
      <p>
        Message delivery uses Meta&apos;s WhatsApp Cloud API. Meta processes
        those events under its own terms. We receive webhook payloads Meta sends
        to the callback URL you configure. We do not sell personal data. We do
        not use WhatsApp customer content to advertise to those customers.
      </p>

      <h2>Sharing</h2>
      <p>
        We share data with processors required to run the Service (hosting,
        database, Meta/WhatsApp, and any third party you connect). We share data
        when required by law. We do not sell personal information.
      </p>

      <h2>Retention</h2>
      <p>
        We keep account and conversation data for as long as the operator
        account remains active, unless a shorter period is required or a valid
        deletion request is completed. Encrypted credentials remain until the
        operator disconnects WhatsApp or deletes the account.
      </p>

      <h2>Your choices</h2>
      <p>
        Operators can access and update account data after signing in. To
        request deletion of personal data, follow the instructions on our{" "}
        <Link href="/data-deletion">Data deletion</Link> page or email{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>Security</h2>
      <p>
        Access tokens and related secrets are encrypted at rest. Webhook
        payloads from Meta are verified with the app secret. No method of
        transmission or storage is completely secure.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy. The &quot;Last updated&quot; date at the top
        of this page will change when we do. Continued use of the Service after
        an update means you accept the revised policy.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions:{" "}
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </LegalChrome>
  );
}
