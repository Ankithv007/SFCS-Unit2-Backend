/**
 * SFCS RRH MES Station Registry
 * Canonical station definitions, route identities, and database table mappings.
 */

export type RouteType = 'ECN' | 'NON_ECN';

export type StationId =
    | 'INWARD'
    | 'IVI'
    | 'ECN_IPQC'
    | 'ECN_PROGRAMMING'
    | 'ECN_PRE_BURN_IN'
    | 'ECN_HIPOT'
    | 'ECN_POST_BURN_IN'
    | 'NON_ECN_POST_BURN_IN_INITIAL'
    | 'NON_ECN_PROGRAMMING'
    | 'NON_ECN_PRE_BURN_IN'
    | 'NON_ECN_HIPOT'
    | 'NON_ECN_POST_BURN_IN_FINAL';

export interface StationDefinition {
    id: StationId;
    name: string;
    route: RouteType | 'COMMON';
    stageOrder: number;
    isInitial: boolean;
    isFinal: boolean;
    sessionTable: string;
    inspectionTable: string;
    postBurnInType?: 'INITIAL' | 'FINAL';
    requiredPredecessorId?: StationId;
    description: string;
}

export const STATION_REGISTRY: Record<StationId, StationDefinition> = {
    INWARD: {
        id: 'INWARD',
        name: 'Inward Scan',
        route: 'COMMON',
        stageOrder: 1,
        isInitial: true,
        isFinal: false,
        sessionTable: 'rrh_inward_sessions',
        inspectionTable: 'rrh_inward_scans',
        description: 'First physical entry point of RRH units into MES'
    },
    IVI: {
        id: 'IVI',
        name: 'Inward Visual Inspection',
        route: 'COMMON',
        stageOrder: 2,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_ivi_sessions',
        inspectionTable: 'rrh_ivi_inspections',
        requiredPredecessorId: 'INWARD',
        description: 'Visual inspection where route determination (ECN vs Non-ECN) occurs'
    },

    // ─── ECN Route Stations ───────────────────────────────────────────────────
    ECN_IPQC: {
        id: 'ECN_IPQC',
        name: 'ECN In-Process Quality Control (IPQC)',
        route: 'ECN',
        stageOrder: 3,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_ipqc_sessions',
        inspectionTable: 'rrh_ipqc_inspections',
        requiredPredecessorId: 'IVI',
        description: 'ECN-only IPQC inspection. Non-ECN units must not enter this station.'
    },
    ECN_PROGRAMMING: {
        id: 'ECN_PROGRAMMING',
        name: 'ECN Programming',
        route: 'ECN',
        stageOrder: 4,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_programming_sessions',
        inspectionTable: 'rrh_programming_inspections',
        requiredPredecessorId: 'ECN_IPQC',
        description: 'Firmware programming following passed ECN IPQC'
    },
    ECN_PRE_BURN_IN: {
        id: 'ECN_PRE_BURN_IN',
        name: 'ECN Pre-Burn-In Test',
        route: 'ECN',
        stageOrder: 5,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_pre_burn_in_sessions',
        inspectionTable: 'rrh_pre_burn_in_inspections',
        requiredPredecessorId: 'ECN_PROGRAMMING',
        description: 'Pre-burn-in functional test for ECN units'
    },
    ECN_HIPOT: {
        id: 'ECN_HIPOT',
        name: 'ECN Hipot Test',
        route: 'ECN',
        stageOrder: 6,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_hipot_sessions',
        inspectionTable: 'rrh_hipot_inspections',
        requiredPredecessorId: 'ECN_PRE_BURN_IN',
        description: 'High-potential electrical insulation test for ECN units'
    },
    ECN_POST_BURN_IN: {
        id: 'ECN_POST_BURN_IN',
        name: 'ECN Post-Burn-In Test',
        route: 'ECN',
        stageOrder: 7,
        isInitial: false,
        isFinal: true,
        sessionTable: 'rrh_post_burn_in_sessions',
        inspectionTable: 'rrh_post_burn_in_inspections',
        postBurnInType: 'FINAL',
        requiredPredecessorId: 'ECN_HIPOT',
        description: 'Final post-burn-in test for ECN units prior to downstream packaging'
    },

    // ─── Non-ECN Route Stations ───────────────────────────────────────────────
    NON_ECN_POST_BURN_IN_INITIAL: {
        id: 'NON_ECN_POST_BURN_IN_INITIAL',
        name: 'Non-ECN Post-Burn-In Test (Initial)',
        route: 'NON_ECN',
        stageOrder: 3,
        isInitial: true, // initial testing stage for Non-ECN directly after IVI
        isFinal: false,
        sessionTable: 'rrh_post_burn_in_sessions',
        inspectionTable: 'rrh_post_burn_in_inspections',
        postBurnInType: 'INITIAL',
        requiredPredecessorId: 'IVI',
        description: 'Initial burn-in test for Non-ECN units directly after IVI, bypassing IPQC'
    },
    NON_ECN_PROGRAMMING: {
        id: 'NON_ECN_PROGRAMMING',
        name: 'Non-ECN Programming',
        route: 'NON_ECN',
        stageOrder: 4,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_programming_sessions',
        inspectionTable: 'rrh_programming_inspections',
        requiredPredecessorId: 'NON_ECN_POST_BURN_IN_INITIAL',
        description: 'Firmware programming for Non-ECN units following passed Initial Post-Burn-In'
    },
    NON_ECN_PRE_BURN_IN: {
        id: 'NON_ECN_PRE_BURN_IN',
        name: 'Non-ECN Pre-Burn-In Test',
        route: 'NON_ECN',
        stageOrder: 5,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_pre_burn_in_sessions',
        inspectionTable: 'rrh_pre_burn_in_inspections',
        requiredPredecessorId: 'NON_ECN_PROGRAMMING',
        description: 'Pre-burn-in functional test for Non-ECN units'
    },
    NON_ECN_HIPOT: {
        id: 'NON_ECN_HIPOT',
        name: 'Non-ECN Hipot Test',
        route: 'NON_ECN',
        stageOrder: 6,
        isInitial: false,
        isFinal: false,
        sessionTable: 'rrh_hipot_sessions',
        inspectionTable: 'rrh_hipot_inspections',
        requiredPredecessorId: 'NON_ECN_PRE_BURN_IN',
        description: 'High-potential electrical insulation test for Non-ECN units'
    },
    NON_ECN_POST_BURN_IN_FINAL: {
        id: 'NON_ECN_POST_BURN_IN_FINAL',
        name: 'Non-ECN Post-Burn-In Test (Final)',
        route: 'NON_ECN',
        stageOrder: 7,
        isInitial: false,
        isFinal: true,
        sessionTable: 'rrh_post_burn_in_sessions',
        inspectionTable: 'rrh_post_burn_in_inspections',
        postBurnInType: 'FINAL',
        requiredPredecessorId: 'NON_ECN_HIPOT',
        description: 'Final post-burn-in test for Non-ECN units prior to downstream packaging'
    }
};
