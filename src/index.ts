/**
 * Pelm SDK
 */

let pelmClientId: string;
let pelmSecret: string;

import fetch from "node-fetch";
import FormData from "form-data";

export namespace PelmTypes {
  export type PelmUsageInterval = {
    start: Date;
    end: Date;
    usage: number;
    ghg_emissions: number;
  };
  export interface AccountsResponse {
    id: string;
    account_number: string;
    address: string;
    available_meter_types: string[];
    usage_unit: UsageUnit;
    gas_usage_unit: "therm";
    ghg_emission_unit: "kg_co2e_per_kwh" | "kg_co2";
  }
  export type UsageUnit = "kwh" | "mwh" | "therm";
  export interface IntervalsResponse {
    utility: string;
    account: AccountsResponse;
    intervals: PelmUsageInterval[];
  }

  export interface PelmCharges {
    electric_charges: number;
    gas_charges: number;
    other_charges: number;
  }

  export interface PelmBill {
    id: string;
    account_id: string;
    start_date: string;
    end_date: string;
    statement_date: string;
    due_date: string;
    payment_date: string;
    total_amount_due: number;
    total_charges: number;
    charges: PelmCharges;
    electric_usage_kwh: number;
    gas_usage_therm: number;
  }

  export interface BillsResponse {
    account_id: string;
    bills: PelmBill[];
  }
}

/**
 * Grabs the initial Connect Token
 * @param pelmUserId ID specified by you to identify the user/utility account
 * @returns connect_token used for Auth Code generation
 */
const getConnectToken = async (pelmUserId: string): Promise<string> => {
  const response: any = await postRequest(
    "https://api.pelm.com/auth/connect-token",
    { user_id: pelmUserId },
    { accept: "application/json", "pelm-client-id": pelmClientId, "pelm-secret": pelmSecret }
  );
  const token: string = response.connect_token;
  return token;
};

const postRequest = async (url: string, body: { [key: string]: string }, headers?: any): Promise<any> => {
  const formData = new FormData();
  for (const key in body) {
    formData.append(key, body[key]);
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });
  return await response.json();
};

/**
 *
 * @param utilityProviderCode code provided by Pelm to identify utility Provider, see here: https://docs.pelm.com/reference/utilities
 * @param username username to login into the utility account
 * @param password password to login into the utility account
 * @param connectToken connect_token grabbed from getConnectToken()
 * @returns Auth Code for use in getting the access token
 */
const getAuthCode = async (
  utilityProviderCode: string,
  username: string,
  password: string,
  connectToken: string
): Promise<string> => {
  const response: any = await postRequest(
    "https://api.pelm.com/connect",
    {
      utility_id: utilityProviderCode,
      username: username,
      password: password,
    },
    { accept: "application/json", authorization: `Bearer ${connectToken}` }
  );
  const authCode: string = response.authorization_code;
  return authCode;
};

const getAccessToken = async (authCode: string): Promise<string> => {
  const response: any = await postRequest(
    "https://api.pelm.com/auth/token",
    { code: authCode },
    { accept: "application/json", "pelm-client-id": pelmClientId, "pelm-secret": pelmSecret }
  );
  const accessToken: string = response.access_token;

  return accessToken;
};

/**
 * Do this to initialize a new user into the Pelm system
 * 1) Grabs Connect Token
 * 2) Uses Connect token to get Auth Code
 * 3) Uses Auth Code to get permanent Access Token
 * @param providerCode code provided by Pelm to identify utility Provider, see here: https://docs.pelm.com/reference/utilities
 * @param pelmUserId the user ID you want associated with Pelm (this will be the direct link ID between you and pelm)
 * @param username the username for the utility account
 * @param password the password for the utility account
 * @returns access_token needed to authorize most requests. Save this in your DB as it does not expire.
 */
export const getOrCreatePelmToken = async (
  providerCode: string,
  pelmUserId: string,
  username: string,
  password: string
): Promise<string> => {
  const connectToken = await getConnectToken(pelmUserId);
  const authCode = await getAuthCode(providerCode, username, password, connectToken);
  const accessToken = await getAccessToken(authCode);
  return accessToken;
};

/**
 * Run this method before trying to find usage (as you need the account ids to grab the intervals)
 * Gets accounts found by Pelm that are associated with your utility account credentials
 * @param pelmUserId user/utility account id specified by you on initialization.
 * @returns accounts found by Pelm
 */
const getPelmAccounts = async (pelmAccessToken: string) => {
  const response: PelmTypes.AccountsResponse[] = await getRequest("https://api.pelm.com/accounts", {
    Authorization: `Bearer ${pelmAccessToken}`,
    "Pelm-Client-Id": pelmClientId,
    "Pelm-Secret": pelmSecret,
  });
  return response;
};

/**
 * Gets the Bills from a utility account using saved access token
 * @param pelmAccessToken your saved access token from initialization
 * @returns a list of bills from all accounts associated with the pelmUserId
 */
const getBillsPelm = async (pelmAccessToken: string): Promise<PelmTypes.BillsResponse[]> => {
  const response: PelmTypes.BillsResponse[] = await getRequest("https://api.pelm.com/bills", {
    Authorization: `Bearer ${pelmAccessToken}`,
    "Pelm-Client-Id": pelmClientId,
    "Pelm-Secret": pelmSecret,
  });
  return response;
};

/**
 * Gets the PDFs of the bills
 * @param pelmAccessToken your saved access token
 * @param pelmBillIds an array of strings matching the Pelm Bill ids (you can find those by calling getBills())
 * @returns pdfs of every bill id passed in
 */
const getBillPdfs = async (pelmAccessToken: string, pelmBillIds: string[]): Promise<any> => {
  const pdfs = await Promise.all(
    pelmBillIds.map(async (billId) => {
      const response = await getRequest(`https://api.pelm.com/bills/${billId}/pdf`, {
        accept: "application/pdf",
        authorization: `Bearer ${pelmAccessToken}`,
        "pelm-client-id": pelmClientId,
        "pelm-secret": pelmSecret,
      });
      return response;
    })
  );
  return pdfs;
};
const getRequest = async (url: string, headers?: any): Promise<any> => {
  const response = await fetch(url, {
    method: "GET",
    headers,
  });
  return await response.json();
};

/**
 * Gets a list of 15 minute usage intervals for a particular account
 * Must have already called getAccountsPelm() on this utilityAccountId
 * @param pelmAccountId the account Id you want to get usage intervals for (sometimes there are multiple properties with different meters per utility account login)
 * @param pelmToken your saved access token for a particular utility account
 * @param startDate - optional parameter, defaults to 3 months ago
 * @param endDate - optional parameter, defaults to now
 * @returns list of intervals based on a date frame for all the pelm accounts associated with the utility account
 */
const getPelmIntervals = async (
  pelmAccountId: string,
  pelmToken: string,
  startDate?: Date,
  endDate?: Date
): Promise<PelmTypes.IntervalsResponse> => {
  const start = startDate?.getTime() ? startDate.getTime() / 1000 : 0;
  const end = endDate?.getTime() ? endDate?.getTime() / 1000 : 0;

  return await getRequest("https://api.pelm.com/intervals", {
    account_id: pelmAccountId,
    start_date: start.toString(),
    end_date: end.toString(),
    authorization: `Bearer ${pelmToken}`,
    "pelm-client-id": pelmClientId,
    "pelm-secret": pelmSecret,
  });
};

interface TotalUandE {
  totalUsage: number;
  totalEmissions: number;
}

/**
 * Totals the usage intervals
 * @param accountsAndIntervals exact response taken from calling getPelmIntervals(), takes a specific interface so these functions were made to work together
 * @returns am object with a totaled usage amount and the total emissions amount
 */
const totalUsageIntervals = async (
  accountsAndIntervals: PelmTypes.IntervalsResponse
): Promise<TotalUandE> => {
  const totalUsage = accountsAndIntervals.intervals.reduce((accumulator, interval) => {
    return accumulator + interval.usage;
  }, 0);
  const totalEmissions = accountsAndIntervals.intervals.reduce((accumulator, interval) => {
    return accumulator + interval.ghg_emissions;
  }, 0);

  return { totalUsage, totalEmissions };
};

export const PelmSDK = (apiClientId: string, apiSecret: string) => {
  pelmClientId = apiClientId;
  pelmSecret = apiSecret;
  return {
    getConnectToken,
    getAuthCode,
    getAccessToken,
    getBillPdfs,
    getBillsPelm,
    getPelmAccounts,
    getPelmIntervals,
    totalUsageIntervals,
    getOrCreatePelmToken,
  };
};
