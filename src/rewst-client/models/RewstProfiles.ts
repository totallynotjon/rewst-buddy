
export interface RewstProfiles {

    [orgId: string]: RewstProfile
}

export default interface RewstProfile {
    orgId: string;
    loaded: boolean;
    label : string;
};// commands/index.ts
