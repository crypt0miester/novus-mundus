export { ALLDOMAINS_API } from "./constants";
export {
  resolveDomainName,
  resolveDomainNamesBatched,
  getOwnedDomains,
} from "./resolver";
export {
  isWeb2Tld,
  requiresCosigner,
  isCosignerResult,
  checkDomainAvailability,
  fetchAllTlds,
  fetchMainDomain,
  fetchMainDomainsBatch,
  fetchUserDomainsForTld,
  createDomainPurchase,
  fetchDomainSuggestions,
} from "./api";
export type {
  DomainCheckResult,
  TldInfo,
  DomainPurchaseResult,
  CosignerPurchaseResult,
  MainDomainResult,
} from "./api";
