import type { Metadata } from "next";
import Link from "next/link";
import {
  LEGAL_APP,
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR,
  LegalChrome,
} from "../legal-chrome";

export const metadata: Metadata = {
  title: "Data deletion instructions",
  description: `How to request deletion of personal data held by ${LEGAL_OPERATOR} in ${LEGAL_APP}.`,
};

export default function DataDeletionPage() {
  return (
    <LegalChrome
      title="Data deletion instructions"
      description={`${LEGAL_OPERATOR} provides this page so users can request deletion of data associated with ${LEGAL_APP}, including data received through Meta and WhatsApp Cloud API.`}
    >
      <h2>How to request deletion</h2>
      <p>Use one of the following methods. We treat each as a formal deletion request.</p>
      <ul>
        <li>
          Email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(`${LEGAL_APP} data deletion request`)}`}>
            {LEGAL_CONTACT_EMAIL}
          </a>{" "}
          with the subject &quot;{LEGAL_APP} data deletion request&quot;. Include
          the WhatsApp number, email, or Meta app-scoped user ID the request
          relates to.
        </li>
        <li>
          If you have an operator account, sign in to {LEGAL_APP} and ask an
          account admin to remove the relevant contacts, conversations, and —
          if you want the whole workspace removed — to request full account
          deletion via the same email.
        </li>
        <li>
          If you used Facebook to connect or manage the app, you may also
          remove the app under Facebook Settings → Apps and Websites and send a
          deletion request from there. We honor those requests as described
          below.
        </li>
      </ul>

      <h2>What we delete</h2>
      <p>Upon a valid request we delete or irreversibly anonymize, as applicable:</p>
      <ul>
        <li>Operator account profile data (name, email) for that user.</li>
        <li>WhatsApp contacts, conversation history, and inbound/outbound messages tied to the identified person or number.</li>
        <li>Media files stored for those conversations, where we host a copy.</li>
        <li>WhatsApp access tokens and webhook configuration if the request is for full account closure.</li>
        <li>Any Meta app-scoped identifiers we hold for that user.</li>
      </ul>
      <p>
        We may retain a minimal record of the request (date, identifier, and
        completion status) for compliance. We may also retain data we are
        legally required to keep, for the required period only.
      </p>

      <h2>Timing</h2>
      <p>
        We aim to complete deletion within 30 days of a verifiable request. You
        will receive an email confirmation with a reference code. If we cannot
        verify the requester, we will ask for additional information rather than
        delete another person&apos;s data.
      </p>

      <h2>WhatsApp customers</h2>
      <p>
        If you messaged a business that uses {LEGAL_APP} and want that business
        to erase your chat history, email {LEGAL_CONTACT_EMAIL} with the
        WhatsApp number you used. We will delete matching contact and message
        records we store. Deleting data from WhatsApp itself is controlled by
        Meta/WhatsApp, not by us.
      </p>

      <h2>Status of a request</h2>
      <p>
        After you email us we reply with a confirmation code. Reply to that
        thread anytime to check status. Typical states: received, verifying,
        completed, or declined (with the reason, for example we could not match
        the identifier).
      </p>

      <h2>Related policies</h2>
      <p>
        See our <Link href="/privacy">Privacy Policy</Link> and{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalChrome>
  );
}
