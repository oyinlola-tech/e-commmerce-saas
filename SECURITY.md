# Security Policy

Proprietary software owned by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This repository is not free to use. Security reports should be shared privately.

## Supported Code Line

This repository is maintained as a single unreleased code line. Security fixes are applied to the latest repository snapshot only.

| Code line | Supported |
| --- | --- |
| Latest repository snapshot | Yes |
| Older local copies, forks, or exported archives | No |

## Reporting a Vulnerability

Do not open a public issue, pull request, or discussion for suspected security problems.

Report vulnerabilities privately to the repository owner through the contact methods listed on https://www.oyinlola.site/ and clearly label the message `Aisle Commerce SaaS security report`.

Please include:

- A short description of the issue and why it matters
- The affected service, route, file, or workflow
- Clear reproduction steps or a proof of concept
- Any setup assumptions, request samples, or logs needed to reproduce it

## High-Value Areas

Reports are especially helpful for issues involving:

- Authentication or authorization bypass in the gateway or downstream services
- Cross-tenant data exposure or store-isolation failures
- JWT handling, internal HMAC signing, or trust-boundary weaknesses
- SQL injection, SSRF, insecure deserialization, or other server-side injection risks
- Secret exposure, unsafe default credentials, or webhook verification gaps
- Payment, order, billing, or compliance workflow tampering

## Coordinated Disclosure

Please keep vulnerability details private until the issue has been reviewed and a fix or mitigation is available. Good-faith reports are welcome, but this repository does not currently advertise a bug bounty program or a formal response SLA.

## Testing Expectations

Please avoid:

- Accessing, modifying, or deleting data that you do not own
- Disrupting shared infrastructure, local development environments, or automation
- Social engineering, phishing, spam, or physical security attacks
- Public disclosure of secrets, exploit details, or unpatched vulnerabilities
