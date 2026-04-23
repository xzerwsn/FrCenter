# Client Crypto

E2EE stays on the client side. The backend stores public keys and encrypted blobs only.

Current modules:

- `devices.ts`: creates a device keypair and encrypts the private key with the cloud password.
- `messages.ts`: encrypts/decrypts text payloads with a shared symmetric message key.
- `encoding.ts`: base64/text helpers for browser-safe crypto payloads.
