/**
 * Artifact Usage Prompt
 */

export const PROMPT_ARTIFACTS = `
ARTIFACTS — anything that delivers UTILITY. Active tools, not passive objects.

OWNERSHIP TIERS:
  Character-owned — controlled by one entity (wand, company, portfolio)
  Location-owned — bound to place (forge, library, courtroom). Must be present to use.
  World-owned (parentId: null) — universally accessible (internet, natural law, market)

OWNERSHIP TRANSFER: When an artifact changes hands, you MUST generate an ownershipMutation.
  {"artifactId": "A-XX", "fromId": "previous owner ID", "toId": "new owner ID"}
  Triggers: gift, purchase, theft, discovery, inheritance, seizure, trade.
  If a character ACQUIRES an artifact in the scene, there MUST be an ownershipMutation.
  No acquisition in summary/events without the corresponding ownershipMutation.

USAGE: When artifact delivers utility (not just mentioned), generate artifactUsage.
  Generate continuityMutations for BOTH artifact AND user.

VALUE: Characters scheme to acquire, protect, control, destroy.
COST: Power comes with consequences — depletion, corruption, dependency.
`;
