// ---------------------------------------------------------------------------
// GitLike — Core Data Model Types
// ---------------------------------------------------------------------------

/** Hex-encoded Ethereum address. */
type Address = `0x${string}`;

/** IPFS Content Identifier. */
type CID = string;

/** ISO-8601 timestamp string. */
type ISOTimestamp = string;

/** Pinata group identifier (UUID). */
type GroupId = string;

// ---------------------------------------------------------------------------
// Object Types — stored as JSON on IPFS
// ---------------------------------------------------------------------------

/** Discriminator for all GitLike objects pinned to IPFS. */
type ObjectType = 'tree' | 'commit' | 'manifest' | 'delegation';

/** Single entry within a Tree. */
type TreeEntry = {
  name: string;
  cid: CID;
  kind: 'blob' | 'tree';
  /** Byte size (blobs only). */
  size?: number;
};

/** Directory snapshot — list of named CID pointers. */
type Tree = {
  type: 'tree';
  entries: TreeEntry[];
};

/** Immutable commit object linking a tree snapshot to its parents. */
type Commit = {
  type: 'commit';
  /** CID of the root Tree. */
  tree: CID;
  /** Parent commit CID(s). Empty for initial commit. */
  parents: CID[];
  /** Wallet address of the author. */
  author: Address;
  /** Optional human-readable name (ENS, etc.). */
  authorName?: string;
  timestamp: ISOTimestamp;
  message: string;
  /** CID of a Delegation token, if committed by an agent. */
  delegation?: CID | null;
};

/** Actions an agent is permitted to perform. */
type DelegationAction = 'commit' | 'branch' | 'merge';

/** Scoped permissions for an agent delegation. */
type DelegationScope = {
  actions: DelegationAction[];
  /** Glob patterns restricting writable paths. "*" means unrestricted. */
  paths: string[];
};

/** Agent entry in the ACL. */
type AgentEntry = {
  key: Address;
  scope: DelegationScope;
  expires: ISOTimestamp;
};

/** Access-control list for a repository. */
type ACL = {
  owners: Address[];
  writers: Address[];
  /** Map of owner address → delegated agents. */
  agents: Record<Address, AgentEntry[]>;
};

/** Branch name → latest commit CID. */
type BranchRefs = Record<string, CID>;

/** Encryption configuration for a repository. */
type EncryptionConfig = {
  enabled: boolean;
  algorithm: 'AES-256-GCM';
  /** Current key epoch — incremented on key rotation. */
  currentEpoch: number;
  /** Encrypt tree entry names (file/folder names). */
  encryptTreeNames?: boolean;
};

/** Single epoch entry in the key bundle. */
type KeyBundleEpoch = {
  /** Hex-encoded secp256k1 public key of the repo owner. */
  ownerPublicKey: string;
  /** Address → base64 AES-KW-wrapped repo key. */
  wrappedKeys: Record<Address, string>;
  /** EIP-712 signature over the epoch data by the owner. */
  signature?: `0x${string}`;
  createdAt: ISOTimestamp;
};

/** Key bundle mapping epoch numbers to their key material. */
type KeyBundle = Record<number, KeyBundleEpoch>;

/** Top-level repository descriptor. */
type Manifest = {
  type: 'manifest';
  name: string;
  description: string;
  defaultBranch: string;
  branches: BranchRefs;
  /** Tag name → commit CID. */
  tags?: Record<string, CID>;
  /** CIDs of open pull request objects. */
  pullRequests?: CID[];
  /** Group ID of the repo this was forked from. */
  forkedFrom?: string;
  /** Branches that only owners can push/merge to. */
  protectedBranches?: string[];
  acl: ACL;
  /** Repo visibility — defaults to 'public' for backwards compatibility. */
  visibility?: 'public' | 'private';
  /** SPDX-like license identifier (e.g. 'MIT', 'Apache-2.0'). */
  license?: string;
  /** Incrementing version for optimistic concurrency. */
  version?: number;
  /** GitLike Pages config for static site hosting. */
  pages?: { enabled: boolean; branch?: string; slug: string; spa?: boolean; folder?: string };
  /** Client-side encryption config. */
  encryption?: EncryptionConfig;
  /** Wrapped repo keys per epoch for authorized addresses. */
  keyBundle?: KeyBundle;
  /** Upstream source for imported repos (e.g. "github:owner/repo@branch"). */
  importedFrom?: string;
  /** CIDs of issue objects. */
  issues?: CID[];
  /** Monotonic counter for issue numbers. */
  issueCount?: number;
};

/** Comment on an issue. */
type IssueComment = {
  author: Address;
  body: string;
  createdAt: ISOTimestamp;
};

/** Issue tracked in a repository. */
type Issue = {
  type: 'issue';
  number: number;
  title: string;
  body: string;
  author: Address;
  status: 'open' | 'closed';
  labels: string[];
  comments: IssueComment[];
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
};

/** Signed delegation granting an agent scoped access. */
type Delegation = {
  type: 'delegation';
  delegator: Address;
  agent: Address;
  repo: GroupId;
  scope: DelegationScope;
  expires: ISOTimestamp;
  /** EIP-191 signature by the delegator over the above fields. */
  signature: `0x${string}`;
};

/** Pull request stored as IPFS object. */
type PullRequest = {
  type: 'pullRequest';
  title: string;
  description: string;
  author: Address;
  sourceBranch: string;
  targetBranch: string;
  status: 'open' | 'merged' | 'closed';
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
};

// ---------------------------------------------------------------------------
// Pinata Metadata — keyvalues attached to pinned files
// ---------------------------------------------------------------------------

/** Keyvalues stored alongside every pinned object. */
type PinKeyValues = {
  type: ObjectType;
  repo: GroupId;
  /** Branch name (commits only). */
  branch?: string;
};

// ---------------------------------------------------------------------------
// Signature record returned by Pinata Signatures API
// ---------------------------------------------------------------------------

type SignatureRecord = {
  cid: CID;
  signature: `0x${string}`;
  address: Address;
};

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type {
  Address,
  CID,
  ISOTimestamp,
  GroupId,
  ObjectType,
  TreeEntry,
  Tree,
  Commit,
  DelegationAction,
  DelegationScope,
  AgentEntry,
  ACL,
  BranchRefs,
  Manifest,
  EncryptionConfig,
  KeyBundleEpoch,
  KeyBundle,
  PullRequest,
  Issue,
  IssueComment,
  Delegation,
  PinKeyValues,
  SignatureRecord,
};
