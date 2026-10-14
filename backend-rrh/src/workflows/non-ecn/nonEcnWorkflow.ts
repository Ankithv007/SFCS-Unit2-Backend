import { StationId } from '../common/stationRegistry';

export const NON_ECN_STATION_SEQUENCE: StationId[] = [
    'INWARD',
    'IVI',
    'NON_ECN_POST_BURN_IN_INITIAL',
    'NON_ECN_PROGRAMMING',
    'NON_ECN_PRE_BURN_IN',
    'NON_ECN_HIPOT',
    'NON_ECN_POST_BURN_IN_FINAL'
];

export const NON_ECN_WORKFLOW_DEFINITION = {
    route: 'NON_ECN' as const,
    name: 'RRH Non-ECN Manufacturing Route',
    description: 'Inward -> IVI -> Initial Post-Burn-In -> Programming -> Pre-Burn-In -> Hipot -> Final Post-Burn-In',
    sequence: NON_ECN_STATION_SEQUENCE,
    requiresIpqc: false, // Bypasses IPQC
    initialPostBurnInRequired: true // Requires Initial Post-Burn-In directly after IVI
};
