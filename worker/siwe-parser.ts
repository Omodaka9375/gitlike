// ---------------------------------------------------------------------------
// GitLike — SIWE Message Parser
// Parses EIP-4361 Sign-In with Ethereum messages.
// ---------------------------------------------------------------------------

/** Parsed SIWE message fields. */
export type SiweFields = {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
};

/** Parse a SIWE message string into its fields. */
export function parseSiweMessage(message: string): SiweFields | null {
  try {
    const lines = message.split('\n');

    const domain = lines[0]?.replace(/ wants you to sign in with your Ethereum account:$/, '');
    const address = lines[1]?.trim();

    // Find key fields by label
    const fieldMap = new Map<string, string>();
    for (const line of lines) {
      const match = line.match(/^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time):\s*(.+)$/);
      if (match) {
        fieldMap.set(match[1], match[2]);
      }
    }

    if (!domain || !address || !fieldMap.get('Nonce')) return null;

    // Find statement (lines between address and URI)
    const uriLineIdx = lines.findIndex((l) => l.startsWith('URI:'));
    let statement: string | undefined;
    if (uriLineIdx > 3) {
      statement = lines.slice(3, uriLineIdx).join('\n').trim();
    }

    return {
      domain,
      address,
      statement: statement || undefined,
      uri: fieldMap.get('URI') ?? '',
      version: fieldMap.get('Version') ?? '1',
      chainId: fieldMap.get('Chain ID') ?? '1',
      nonce: fieldMap.get('Nonce') ?? '',
      issuedAt: fieldMap.get('Issued At') ?? '',
      expirationTime: fieldMap.get('Expiration Time'),
    };
  } catch {
    return null;
  }
}
