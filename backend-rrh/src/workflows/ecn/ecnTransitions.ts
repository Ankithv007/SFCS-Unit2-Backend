import { StationId } from '../common/stationRegistry';

export interface TransitionRule {
    from: StationId;
    to: StationId;
    acceptedStatuses: ('PASS' | 'COMPLETED')[];
}

export const ECN_TRANSITION_RULES: TransitionRule[] = [
    { from: 'INWARD', to: 'IVI', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'IVI', to: 'ECN_IPQC', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'ECN_IPQC', to: 'ECN_PROGRAMMING', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'ECN_PROGRAMMING', to: 'ECN_PRE_BURN_IN', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'ECN_PRE_BURN_IN', to: 'ECN_HIPOT', acceptedStatuses: ['PASS', 'COMPLETED'] },
    { from: 'ECN_HIPOT', to: 'ECN_POST_BURN_IN', acceptedStatuses: ['PASS', 'COMPLETED'] }
];
