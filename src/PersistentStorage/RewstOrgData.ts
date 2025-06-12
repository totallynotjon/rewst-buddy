import FolderStructure from "@fs/models/FolderStructure.js";
import { CreateOrgVariableMutationVariables, OrgVariableCategory } from "graphql_sdk.js";
import RewstClient from "rewst-client/RewstClient.js";
import * as vscode from 'vscode';

export interface RewstOrgData {
    orgId: string;
    label?: string;
    templateFolderStructure?: FolderStructure
};


export default class PersistentStorage {
    key: string = 'RewstOrgData';

    constructor(private context: vscode.ExtensionContext) { }

    static serializeMap(myMap: Map<string, RewstOrgData>): string {
        return JSON.stringify(Array.from(myMap.entries()))
    }

    static deserializedMap(mapString: string): Map<string, RewstOrgData> {
        return new Map(JSON.parse(mapString));
    }

    getAllOrgData(): Map<string, RewstOrgData> {
        const mapString: string | undefined = this.context.globalState.get(this.key);
        if (mapString && mapString !== '{}') {
            return PersistentStorage.deserializedMap(mapString);
        } else {
            return new Map<string, RewstOrgData>();
        }
    }

    setRewstOrgData(data: RewstOrgData, client?: RewstClient): void {
        const allOrgData = this.getAllOrgData();
        allOrgData.set(data.orgId, data)
        const serializedMap = PersistentStorage.serializeMap(allOrgData);
        this.context.globalState.update(this.key, serializedMap);

        if (client) {

        }
    }


    getRewstOrgData(orgId: string): RewstOrgData {
        const allOrgData = this.getAllOrgData();
        return allOrgData.get(orgId) ?? { "orgId": orgId };
    }

    getAllOrgs(context: vscode.ExtensionContext): RewstOrgData[] {
        const allOrgData = this.getAllOrgData();
        return Array.from(allOrgData.values());
    }


    async upsertOrgVariable(client: RewstClient, value: string) {
        const input: CreateOrgVariableMutationVariables = {
            orgVariable: {
                cascade: false,
                category: OrgVariableCategory.General,
                id: undefined,
                name: "rewst-buddy-config",
                orgId: client.orgId,
                packConfigId: undefined,
                value: value
            }
        };

        const response = await client.sdk.createOrgVariable(input);
    }

    
}