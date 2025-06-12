import * as vscode from 'vscode';
import { GraphQLClient } from 'graphql-request';
import { getSdk, Sdk } from '../graphql_sdk.js';
import RewstProfile, { RewstProfiles } from './models/RewstProfiles.js';
import assert from 'assert';

function parseCookieString(cookieString: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieString.split(';').forEach(pair => {
    const [key, value] = pair.trim().split('=');
    cookies[key] = value;
  });
  return cookies;
}

export default class RewstClient {
  private static get endpoint(): string { return "https://api.rewst.io/graphql"; }
  private context: vscode.ExtensionContext;
  private secrets: vscode.SecretStorage;

  private constructor(context: vscode.ExtensionContext, public sdk: Sdk, public orgId: string, public label: string) {
    this.context = context;
    this.secrets = context.secrets;
    this.saveProfile();
  }

  static async create(context: vscode.ExtensionContext, orgId?: string, token?: string) {

    if (token === undefined) {
      if (orgId === undefined) {
        token = await RewstClient.promptToken();
      } else {
        token = await context.secrets.get(orgId);
      }
    }

    if (typeof token !== 'string') {
      throw new Error("Retrieved token somehow not string (Undefined)");
    }

    const sdk = RewstClient.newSdk(token);

    if (!await RewstClient.validateSdk(sdk)) {
      throw new Error("Error creating sdk from token");
    }

    const reponse = await sdk.UserOrganization();

    const org = reponse.userOrganization;


    if (typeof org?.id !== 'string') {
      throw new Error("Error getting orgId using token");
    }

    await context.secrets.store(org.id, token);

    const client = new RewstClient(context, sdk, org.id, org.name);

    client.refreshToken();

    return client;
  }

  static async LoadClients(context: vscode.ExtensionContext): Promise<RewstClient[]> {
    const profileObj = RewstClient.getSavedProfiles(context);
    const profiles = Object.values(profileObj);

    const resultsPromises = profiles.map(async (profile) => {
      try {
        return await RewstClient.create(context, profile.orgId);
      } catch (err) {
        console.log(`Failed to make client for ${profile.orgId} with eror: ${err}`);
        return undefined;
      }
    });

    const results = await Promise.all(resultsPromises);

    console.log(`loaded clients: ${results}`);

    const clients = results.filter(c => c !== undefined);
    return clients;
  }

  private saveProfile() {
    const profiles = this.getSavedProfiles();
    profiles[this.orgId] = this.getProfile();
    this.context.globalState.update('RewstProfiles', profiles);
  }

  private static getSavedProfiles(context: vscode.ExtensionContext): RewstProfiles {
    return context.globalState.get<RewstProfiles>('RewstProfiles') ?? {};
  }

  public static clearProfiles(context: vscode.ExtensionContext) {
    context.globalState.update('RewstProfiles', {});
  }

  private getSavedProfiles(): RewstProfiles {
    return RewstClient.getSavedProfiles(this.context);
  }

  private getProfile(): RewstProfile {
    return { "orgId": this.orgId, "loaded": false, "label": this.label };
  }


  private static newSdk(token: string): Sdk {
    const client = new GraphQLClient(RewstClient.endpoint, {
      errorPolicy: 'all',
      method: 'POST',
      headers: () => ({
        cookie: `appSession=${token}`
      }),
    });

    const sdk = getSdk(client);
    return sdk;
  }

  private static async validateSdk(sdk: Sdk): Promise<boolean> {

    const response = await sdk.UserOrganization();

    if (typeof response.userOrganization?.id !== 'string') {
      return false;
    }

    return true;
  }

  private static async promptToken(): Promise<string> {
    const token = await vscode.window.showInputBox({
      placeHolder: 'Enter your token',
      prompt: 'We need your token to proceed',
      password: true
    });

    return token ?? "";
  }



  private async refreshToken() {
    const oldToken = await this.getToken();

    const response = await fetch("https://app.rewst.io", {
      method: 'GET',
      headers: {
        cookie: `appSession=${oldToken}`
      }
    });

    const headers = response.headers;

    const cookieString = headers.get('set-cookie');

    if (cookieString === null) {
      throw new Error("Auth reponse didn't give back cookies");
    }

    const cookies = parseCookieString(cookieString);

    const appSession = cookies['appSession'];

    if (typeof appSession !== 'string') {
      throw new Error("AppSession was not a string, didn't refresh");

    }
    const sdk = RewstClient.newSdk(appSession);

    if (!await RewstClient.validateSdk(sdk)) {
      throw new Error("Error creating sdk from token");
    }

    await this.secrets.store(this.orgId, appSession);

    this.sdk = sdk;
    console.log(`Refreshed token and sdk for ${this.orgId}`);

  }




  private static async getToken(context: vscode.ExtensionContext, orgId: string): Promise<string> {
    const token = await context.secrets.get(orgId);
    if (typeof token !== 'string') {
      throw new Error(`Failed to grab token for orgId ${orgId}`);
    }
    return token;
  }

  async getToken(): Promise<string> {
    return await RewstClient.getToken(this.context, this.orgId);
  };
}