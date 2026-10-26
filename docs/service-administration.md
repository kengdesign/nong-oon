# Service owner and partner administrators

The existing owner can use their own verified LINE account; no extra test LINE
account is required. Platform administration is separate from patient ownership
and caregiver permissions. No patient grants are created by administrator APIs.

## Capabilities

- Owner: inspect operational health, invite up to five partner administrators,
  cancel pending invitations, revoke membership immediately and review audit.
- Partner administrator: inspect environment, delivery/scheduler switches and
  the latest maintenance counters. Cannot change delivery, settings, owner,
  invitations or membership, and receives no access to health records or secrets.
- Other authenticated users: view their own account identifier and accept an
  invitation explicitly bound to that identifier. No administrative data access.

The owner is configured server-side with `SERVICE_OWNER_ACTOR_ID`; no first-login
claim, email/name match or client-supplied role can establish ownership. Owner
rotation is an infrastructure change, not an application API. Previously granted
members are bound to their grantor and are invalid if owner configuration changes.

## Invitation flow

1. The partner logs in through the existing LINE Login flow and visits
   `/admin.html`, then privately supplies their displayed account identifier.
2. The owner verifies the intended partner, enters that identifier and confirms
   creating an invitation. Only an existing unblocked account can be invited.
3. The owner manually shares the displayed code with that partner. This code is
   shown once; only its SHA-256 digest is stored. It expires after 24 hours and
   cannot be accepted by any other account.
4. The partner logs in and explicitly accepts the code. Acceptance, grant and
   audit commit in one D1 batch. Concurrent/replayed acceptance fails closed.
5. The owner can revoke access or cancel an invitation from the same page.

No email or LINE message is sent by these actions. No credentials or invitation
codes are written to logs, GitHub or browser persistence. Expired invitations,
revoked memberships and audit use the existing bounded retention workflow.

## Deployment and activation

Apply migration `0008_service_admins.sql` before deploying code that purges the
new tables. Keep `SERVICE_ADMIN_ENABLED` absent/false until the designated owner
has been verified. Set the verified owner's identifier through Cloudflare secure
configuration, never in the repository, then enable the feature. An unconfigured
or disabled feature returns `ADMIN_DISABLED` and cannot grant any account access.

Activation of an actual service owner and grants to real partners require an
explicitly selected account. Tests use isolated synthetic identities only and do
not establish real partner LINE-login compatibility. No partner invitation has
been issued as part of implementation.
