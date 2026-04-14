/**
 * Artifact Usage Prompt
 */

export const PROMPT_ARTIFACTS = `
ARTIFACTS — things you can USE or possess. Pick examples from the work's own palette; do not default to Western-fantasy or Western-academic tokens.
  ✓ Objects & tools: a ceremonial dagger, a jian, a talking drum, a rosary, a cultivation pill, a wax-seal, the One Ring, a family heirloom manuscript — things you wield or carry
  ✓ Research/work tools: GPT-4, TensorFlow, a WMT dataset, a P100 GPU, a spectrometer, a field notebook, an archival microfilm — software/hardware/instruments you USE
  ✗ "Magic", "swordsmanship", "qi cultivation" — concepts (system knowledge)
  ✗ "Transformer architecture", "dropout", "BLEU score", "thermodynamics" — techniques/metrics (system knowledge)
  ✗ "Figure 3", "Table 2", "footnote 14" — document references, NOT artifacts

OWNERSHIP: character, location, or null (world-owned for ubiquitous tools like AI, the internet, shared infrastructure).
TRANSFER: ownershipDelta when artifacts change hands.
USAGE: artifactUsage with the character (or author/investigator) who used it. Every usage needs a wielder.
`;
