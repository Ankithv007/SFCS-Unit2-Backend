import { StationId } from '../common/stationRegistry';

export const ECN_STATION_SEQUENCE: StationId[] = [
    'INWARD',
    'IVI',
    'ECN_IPQC',
    'ECN_PROGRAMMING',
    'ECN_PRE_BURN_IN',
    'ECN_HIPOT',
    'ECN_POST_BURN_IN'
];

export const ECN_WORKFLOW_DEFINITION = {
    route: 'ECN' as const,
    name: 'RRH Standard ECN Manufacturing Route',
    description: 'Inward -> IVI -> IPQC -> Programming -> Pre-Burn-In -> Hipot -> Post-Burn-In',
    sequence: ECN_STATION_SEQUENCE,
    requiresIpqc: true,
    initialPostBurnInRequired: false
};
