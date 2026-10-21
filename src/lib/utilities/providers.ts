export type Provider = "lesco" | "wasa" | "sngpl";

export type ProviderInfo = {
  id: Provider;
  name: string;
  utility: "Electricity" | "Water" | "Gas";
  numberLabel: string;
  numberHint: string;
  pattern: RegExp;
  placeholder: string;
  fetches: boolean;
  siteUrl: string;
  categoryHint: RegExp;
};

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  lesco: {
    id: "lesco",
    name: "LESCO",
    utility: "Electricity",
    numberLabel: "Reference number",
    numberHint: "14 digits at the top of the bill",
    pattern: /^\d{14}$/,
    placeholder: "02 11711 0000000",
    fetches: true,
    siteUrl: "https://bill.pitc.com.pk/lescobill",
    categoryHint: /electric|wapda/i,
  },
  wasa: {
    id: "wasa",
    name: "WASA Lahore",
    utility: "Water",
    numberLabel: "Account number",
    numberHint: "The account number on the water bill",
    pattern: /^\d{4,15}$/,
    placeholder: "Account number",
    fetches: true,
    siteUrl: "https://cms.wasalhr.pk/DuplicateBill/searchBill",
    categoryHint: /water|wasa/i,
  },
  sngpl: {
    id: "sngpl",
    name: "SNGPL",
    utility: "Gas",
    numberLabel: "Consumer number",
    numberHint: "11 digits on the gas bill",
    pattern: /^\d{11}$/,
    placeholder: "00000000000",
    fetches: false,
    siteUrl: "https://www.sngpl.com.pk/login.jsp?mdids=85",
    categoryHint: /gas|sngpl|sui/i,
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

export function isProvider(v: string): v is Provider {
  return v in PROVIDERS;
}
